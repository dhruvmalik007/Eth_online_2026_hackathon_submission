/**
 * The fee-yield signal for a v4 LP position.
 *
 * ## Why this is a signal and not an APY
 *
 * An LP position's fee income is realised only if the position can be exited, so a yield quoted
 * without the pool's depth is a number about a trade nobody can make. Every reading here therefore
 * carries the window it was measured over and is rejected when the pool cannot be left — the
 * distinction between a yield and an unrealisable one being the whole point of the signal.
 *
 * ## Three ways a fee yield lies
 *
 * 1. **A short window, annualised.** One busy hour × 8,760 is not a year's income; it is one hour's
 *    noise with a multiplier. A minimum window is enforced rather than left to the caller.
 * 2. **An implausible rate.** Fee income is divided by liquidity, and a pool whose liquidity figure is
 *    momentarily tiny produces an enormous quotient. The same defect that made a Morpho vault report
 *    a 297,995% APY — so the same ceiling applies, and rejects rather than clamps. Clamping would
 *    present a fabricated number as a measured one that happens to equal the ceiling.
 * 3. **Income with no exit.** High fees in a pool you cannot withdraw from are not income.
 *
 * A rejection is a value, not an exception: "this cannot be measured" is a normal answer, and a
 * caller routing on yield needs to distinguish it from "this yields nothing".
 */

export const YIELD_REJECTIONS = [
  "window_too_short",
  "no_liquidity",
  "implausible",
  "insufficient_depth",
] as const;
export type YieldRejection = (typeof YIELD_REJECTIONS)[number];

export interface FeeYieldThresholds {
  /** Below this, the sample is noise whatever it annualises to. */
  readonly minWindowHours: number;
  /** Above this, the quotient is a symptom rather than a measurement. */
  readonly maxApy: number;
  /** Below this, the fees cannot realistically be taken. */
  readonly minDepthUsd: number;
}

export const DEFAULT_FEE_YIELD_THRESHOLDS: FeeYieldThresholds = {
  // Six hours spans more than one block and more than one fee regime, and is short enough to refresh
  // within a trading session.
  minWindowHours: 6,
  maxApy: 5,
  minDepthUsd: 100_000,
};

export interface FeeYieldInput {
  readonly poolId: string;
  /** Fees earned by `liquidityUsd` over `windowHours`, in USD. */
  readonly feesUsd: number;
  /** The liquidity that earned them, in USD. */
  readonly liquidityUsd: number;
  readonly windowHours: number;
  /** Liquidity available to exit into, in USD. */
  readonly depthUsd: number;
}

export type FeeYieldReading =
  | {
      readonly ok: true;
      readonly poolId: string;
      /** Annualised, as a rate: `0.041` is 4.1%. */
      readonly apy: number;
      readonly feesUsd: number;
      readonly windowHours: number;
      /** Carried so a caller cannot use the yield without also being able to show the depth. */
      readonly depthUsd: number;
      readonly detail: string;
    }
  | {
      readonly ok: false;
      readonly poolId: string;
      readonly reason: YieldRejection;
      readonly detail: string;
    };

const HOURS_PER_YEAR = 8_760;

/**
 * Annualise measured fee income, or refuse to.
 *
 * @param input - the measurement and the pool's depth.
 * @param thresholds - overridable so a caller can be stricter, never looser than the plausibility
 *   ceiling — a ceiling a caller can raise is not a ceiling.
 */
export function annualiseFeeYield(
  input: FeeYieldInput,
  thresholds: FeeYieldThresholds = DEFAULT_FEE_YIELD_THRESHOLDS,
): FeeYieldReading {
  const reject = (reason: YieldRejection, detail: string): FeeYieldReading => ({
    ok: false,
    poolId: input.poolId,
    reason,
    detail,
  });

  if (input.windowHours < thresholds.minWindowHours) {
    return reject(
      "window_too_short",
      `Measured over ${input.windowHours}h, below the ${thresholds.minWindowHours}h floor. Annualising ` +
        `this would multiply one sample by ${(HOURS_PER_YEAR / input.windowHours).toFixed(0)} and report ` +
        `the result as a rate.`,
    );
  }

  if (input.liquidityUsd <= 0) {
    return reject(
      "no_liquidity",
      "No liquidity was measured in the pool, so there is no capital for the fee income to be a return on.",
    );
  }

  if (input.depthUsd < thresholds.minDepthUsd) {
    return reject(
      "insufficient_depth",
      `Only $${input.depthUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} of depth against a ` +
        `$${thresholds.minDepthUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} floor. ` +
        `Fees in a pool this shallow are earned by a position that cannot be exited cheaply.`,
    );
  }

  const windowReturn = input.feesUsd / input.liquidityUsd;
  const apy = windowReturn * (HOURS_PER_YEAR / input.windowHours);

  if (apy > thresholds.maxApy) {
    return reject(
      "implausible",
      `Annualises to ${(apy * 100).toFixed(1)}%, above the ${(thresholds.maxApy * 100).toFixed(0)}% ceiling. ` +
        `A rate this high usually means the liquidity figure is momentarily tiny rather than that the pool ` +
        `is paying it, so the reading is refused rather than capped — a capped figure would be a ` +
        `fabricated one that happens to equal the ceiling.`,
    );
  }

  return {
    ok: true,
    poolId: input.poolId,
    apy,
    feesUsd: input.feesUsd,
    windowHours: input.windowHours,
    depthUsd: input.depthUsd,
    detail:
      `$${input.feesUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} of fees on ` +
      `$${input.liquidityUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} of liquidity over ` +
      `${input.windowHours}h, annualised to ${(apy * 100).toFixed(2)}%.`,
  };
}

/** The chain's risk-free comparison, so a caller can judge whether the yield is worth the exposure. */
export function yieldOverRiskFree(apy: number, riskFreeRate: number): number {
  return apy - riskFreeRate;
}
