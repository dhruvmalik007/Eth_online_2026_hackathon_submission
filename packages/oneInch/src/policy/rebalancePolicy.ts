/**
 * The flight rule — the custom routing the whole package exists to express.
 *
 * > "If the yield is generated under a certain foundation or it is very
 * > volatile, it will automatically execute a specific swap VM and then convert
 * > all the liquidity pairs into USDC."
 *
 * That sentence is two triggers and one action. This file is the deterministic
 * evaluation of it, and it is deliberately *pure*: no client, no clock, no
 * network. Everything it decides is a function of its arguments, which is what
 * makes the evidence reproducible and the truth table testable.
 *
 * ## Order is the specification
 *
 * The rules are evaluated in a fixed order and the first match wins. The order is
 * not arbitrary:
 *
 * 1. **Desync** first, because if the off-chain thresholds disagree with the
 *    guard deployed on-chain, the SwapVM instruction will reject the take at
 *    execution time. Attempting a flight we know will revert is worse than not
 *    attempting it — it burns gas and produces a failed step in the trace. This
 *    is the one rule that is about *us* rather than the market.
 * 2. **Depth** second, because a flight that eats its own slippage is not a risk
 *    reduction. Liquidity is a precondition for acting on any other signal.
 * 3. **Volatility**, then **yield** — the two flight triggers, ordered so the
 *    more urgent one is reported when both fire. Volatility is the sharper risk:
 *    a yield shortfall costs opportunity, whereas a volatility breach can breach
 *    the position's mandate.
 * 4. **Drift** last, because a weight that has drifted inside its risk band is a
 *    tidy-up, not a safety action.
 *
 * ## A flight with nowhere to land still flies
 *
 * If no vault qualifies, the decision is still `FLIGHT_TO_STABLE` with a single
 * step. The stablecoin lands in the wallet and the vault leg holds. The
 * alternative — suppressing the swap because the deposit cannot follow — would
 * keep funds in a position the policy has already judged unsafe, in order to
 * protect the completeness of a pipeline. That is the wrong trade, and the
 * `vault.rejected` list is how the operator sees why the second step is missing.
 */

import type { VaultCandidate } from "../morpho/vaults.js";
import { chooseVault } from "../morpho/vaults.js";
import { thresholdsFor, type FlightThresholds } from "./thresholds.js";
import {
  FlightInputSchema,
  type FlightDecision,
  type FlightInput,
  type FlightReason,
  type FlightStep,
  type RejectedVault,
} from "./types.js";

export interface FlightPolicyOptions {
  /** Pin or override any threshold. Overrides beat the derived floor. */
  readonly thresholds?: Partial<FlightThresholds>;
  /**
   * The destination's own trailing-mean yield, in bps.
   *
   * Supplied by the signal layer rather than looked up here, so this stays pure.
   * When absent the floor falls back to the conservative default — see
   * {@link thresholdsFor}.
   */
  readonly stableApyBps?: number;
  /** Vaults already read and judged, by `validateVault`. */
  readonly vaults?: readonly VaultCandidate[];
}

/**
 * Decide what to do with one leg.
 *
 * @throws {ZodError} when the input is malformed. This is a boundary, not an
 *   internal call: a `NaN` yield would otherwise flow into a signed order, and
 *   failing here is the last cheap moment to notice.
 */
export function decideFlight(input: FlightInput, options: FlightPolicyOptions = {}): FlightDecision {
  // Parse, so the typed fields below are the validated ones. The schema's job is
  // to reject a non-finite number before it can reach a price.
  const parsed = FlightInputSchema.parse(input);
  const thresholds = thresholdsFor({
    ...(options.stableApyBps === undefined ? {} : { stableApyBps: options.stableApyBps }),
    ...(options.thresholds === undefined ? {} : { overrides: options.thresholds }),
  });
  const vaults = options.vaults ?? [];

  // ── 1. The guard we would execute against must be the guard we reasoned about.
  if (
    parsed.onchain.floorApyBps !== thresholds.yieldFloorBps ||
    parsed.onchain.volCapBps !== thresholds.volCapBps
  ) {
    return hold(
      "signal_desync",
      `Off-chain thresholds (floor ${thresholds.yieldFloorBps} bps, vol cap ${thresholds.volCapBps} bps) ` +
        `differ from the guard deployed on-chain (floor ${parsed.onchain.floorApyBps} bps, ` +
        `vol cap ${parsed.onchain.volCapBps} bps). The SwapVM instruction would reject the take, ` +
        `so no flight is attempted until the guard is updated.`,
    );
  }

  // ── 2. Can we exit without moving the price?
  if (parsed.liquidityDepthUsd < thresholds.minLiquidityDepthUsd) {
    return hold(
      "insufficient_depth",
      `Exit depth $${Math.round(parsed.liquidityDepthUsd).toLocaleString("en-US")} is below the ` +
        `$${thresholds.minLiquidityDepthUsd.toLocaleString("en-US")} minimum. ` +
        `A flight at this size would pay its own slippage, so holding is the cheaper risk.`,
    );
  }

  // ── 3. Volatility breach — the sharper of the two flight triggers.
  if (parsed.realisedVolBps > thresholds.volCapBps) {
    return flight(
      "vol_breach",
      `Realised volatility ${parsed.realisedVolBps} bps exceeds the ${thresholds.volCapBps} bps cap. ` +
        `The position has stopped behaving like fixed income, so the volatile leg is taken to ` +
        `${parsed.targetStable}.`,
      vaults,
    );
  }

  // ── 4. Yield below the floor — the opportunity-cost trigger.
  if (parsed.yieldApyBps < thresholds.yieldFloorBps) {
    return flight(
      "yield_below_floor",
      `Realised yield ${parsed.yieldApyBps} bps is under the ${thresholds.yieldFloorBps} bps floor ` +
        `(derived from the destination's own yield plus the switching buffer). ` +
        `The capital is no longer being paid for its duration or credit risk.`,
      vaults,
    );
  }

  // ── 5. Drift — a tidy-up, once nothing sharper has fired.
  const driftBps = Math.abs(parsed.currentWeightBps - parsed.targetWeightBps);
  if (driftBps > thresholds.driftBps) {
    return {
      action: "REBALANCE",
      reason: "drift",
      detail:
        `Weight has drifted ${driftBps} bps from target, above the ${thresholds.driftBps} bps band. ` +
        `This is a rebalance rather than a flight — the risk posture is unchanged, so it takes the ` +
        `volatile leg back to target and leaves the destination venue as it is.`,
      // A rebalance returns the leg to target; re-choosing the *destination* is
      // the flight path's job. Keeping that split means a drift correction cannot
      // silently migrate the book into a different vault.
      steps: ["swapvm-take"],
      vault: { chosen: null, rejected: [] },
    };
  }

  // ── 6. Nothing to do.
  return hold(
    "within_band",
    `Yield ${parsed.yieldApyBps} bps is at or above the ${thresholds.yieldFloorBps} bps floor, ` +
      `volatility ${parsed.realisedVolBps} bps is within the ${thresholds.volCapBps} bps cap, and ` +
      `weight is ${driftBps} bps from target. Nothing to correct.`,
  );
}

/** A hold, with no steps and no vault consideration. */
function hold(reason: FlightReason, detail: string): FlightDecision {
  return { action: "HOLD", reason, detail, steps: [], vault: { chosen: null, rejected: [] } };
}

/**
 * A flight, with its destination resolved.
 *
 * When `vaults` is empty the rejection says so explicitly rather than leaving an
 * empty list, because "the venue is absent on this chain" and "all candidates
 * were judged unfit" are different operator realities — the first is a registry
 * gap, the second a market condition.
 */
function flight(
  reason: FlightReason,
  detail: string,
  vaults: readonly VaultCandidate[],
): FlightDecision {
  const steps: FlightStep[] = ["swapvm-take"];

  if (vaults.length === 0) {
    const rejected: RejectedVault[] = [
      {
        address: "-",
        reason: "protocol_absent_on_chain",
        detail:
          "No vault is registered for this chain, so the flight has no destination. The take still " +
          "executes and the stablecoin remains in the wallet — suppressing the swap to protect an " +
          "incomplete pipeline would keep funds in a position the policy has already judged unsafe.",
      },
    ];
    return { action: "FLIGHT_TO_STABLE", reason, detail, steps, vault: { chosen: null, rejected } };
  }

  const choice = chooseVault(vaults);
  // `chooseVault` is total: `null` means nothing qualified, not that something
  // went wrong. Either way the take proceeds; only the deposit step is conditional.
  if (choice.chosen !== null) steps.push("vault-deposit");

  const rejected: RejectedVault[] = choice.rejected.map((entry) => ({
    address: entry.address,
    reason: entry.reason,
    detail: entry.detail,
  }));

  if (choice.chosen === null && rejected.length === 0) {
    rejected.push({
      address: "-",
      reason: "protocol_absent_on_chain",
      detail: "No vault candidate was supplied for this chain.",
    });
  }

  return {
    action: "FLIGHT_TO_STABLE",
    reason,
    detail,
    steps,
    vault: { chosen: choice.chosen?.ref.address ?? null, rejected },
  };
}
