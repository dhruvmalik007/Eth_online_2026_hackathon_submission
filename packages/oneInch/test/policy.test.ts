/**
 * The flight rule's truth table.
 *
 * Every case here is a claim the policy makes about the world, so each one is
 * asserted together with the *reason* — a decision that lands on the right action
 * for the wrong reason is a bug that will surface later, on a different input.
 *
 * The order tests matter most. "Volatility breached *and* yield is under the
 * floor" is a real state, and which reason is reported changes what an operator
 * does about it.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLIGHT_BUFFER_BPS,
  DEFAULT_FLIGHT_THRESHOLDS,
  decideFlight,
  deriveYieldFloorBps,
  thresholdsFor,
  type FlightInput,
  type VaultCandidate,
} from "../src/index.js";

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;
const VAULT = "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB" as const;

/**
 * A calm, healthy position.
 *
 * The on-chain guard matches `DEFAULT_FLIGHT_THRESHOLDS` (floor 250, vol cap
 * 1500), because a mismatch is itself a decision — `signal_desync` — and would
 * otherwise mask every other case.
 */
const HEALTHY: FlightInput = {
  chain: "ethereum",
  targetStable: USDC,
  yieldApyBps: 400,
  realisedVolBps: 800,
  liquidityDepthUsd: 500_000,
  currentWeightBps: 5_000,
  targetWeightBps: 5_000,
  onchain: { floorApyBps: 250, volCapBps: 1_500 },
};

function input(overrides: Partial<FlightInput> = {}): FlightInput {
  return { ...HEALTHY, ...overrides };
}

function vault(smoothedApyBps: number): VaultCandidate {
  return {
    ref: {
      address: VAULT,
      name: "Steakhouse USDC",
      asset: USDC,
      observedTotalAssetsUsdc: 67_827_752,
      observedApyPct: 4.09,
      source: "test fixture",
    },
    validity: {
      ok: true,
      readings: {
        address: VAULT,
        asset: USDC,
        shareDecimals: 18,
        totalAssets: 67_827_752_000_000n,
        totalSupply: 61_000_000_000_000n,
        oneShareToAssets: 1_100_000n,
      },
    },
    redeemable: true,
    smoothedApyBps,
  };
}

describe("decideFlight — the healthy case", () => {
  it("holds when everything is inside its band", () => {
    const decision = decideFlight(input());
    expect(decision.action).toBe("HOLD");
    expect(decision.reason).toBe("within_band");
    expect(decision.steps).toEqual([]);
    expect(decision.vault.chosen).toBeNull();
  });
});

describe("decideFlight — the two flight triggers", () => {
  it("flies on a volatility breach", () => {
    const decision = decideFlight(input({ realisedVolBps: 2_000 }), { vaults: [vault(409)] });
    expect(decision.action).toBe("FLIGHT_TO_STABLE");
    expect(decision.reason).toBe("vol_breach");
    expect(decision.steps).toEqual(["swapvm-take", "vault-deposit"]);
    expect(decision.vault.chosen).toBe(VAULT);
  });

  it("flies when yield falls under the floor", () => {
    const decision = decideFlight(input({ yieldApyBps: 100 }), { vaults: [vault(409)] });
    expect(decision.action).toBe("FLIGHT_TO_STABLE");
    expect(decision.reason).toBe("yield_below_floor");
  });

  it("reports the volatility breach when both triggers fire", () => {
    // Volatility is the sharper risk, so it is the one an operator should see.
    const decision = decideFlight(input({ realisedVolBps: 2_000, yieldApyBps: 100 }), {
      vaults: [vault(409)],
    });
    expect(decision.reason).toBe("vol_breach");
  });

  it("does not fly at exactly the cap or exactly the floor", () => {
    // Both comparisons are strict. A position sitting exactly on its bound is
    // inside it — the alternative makes a position flap in and out on a single bp.
    expect(decideFlight(input({ realisedVolBps: 1_500 })).action).toBe("HOLD");
    expect(decideFlight(input({ yieldApyBps: 250 })).action).toBe("HOLD");
  });
});

describe("decideFlight — preconditions that outrank the triggers", () => {
  it("holds on a signal desync even when a flight is otherwise warranted", () => {
    const decision = decideFlight(
      input({ realisedVolBps: 2_000, onchain: { floorApyBps: 250, volCapBps: 1_500 } }),
      // Off-chain floor raised to 535 by a higher stable yield, while the guard
      // on-chain still enforces 250. The instruction would reject the take.
      { stableApyBps: 460, vaults: [vault(460)] },
    );
    expect(decision.action).toBe("HOLD");
    expect(decision.reason).toBe("signal_desync");
    expect(decision.detail).toContain("535");
    expect(decision.detail).toContain("250");
    expect(decision.steps).toEqual([]);
  });

  it("holds on insufficient depth even when a flight is otherwise warranted", () => {
    const decision = decideFlight(input({ liquidityDepthUsd: 10_000, realisedVolBps: 2_000 }), {
      vaults: [vault(409)],
    });
    expect(decision.action).toBe("HOLD");
    expect(decision.reason).toBe("insufficient_depth");
  });

  it("ranks depth above the volatility trigger", () => {
    // A flight that eats its own slippage is not a risk reduction.
    const decision = decideFlight(input({ liquidityDepthUsd: 0, realisedVolBps: 9_999 }));
    expect(decision.reason).toBe("insufficient_depth");
  });

  it("ranks the desync check above everything", () => {
    const decision = decideFlight(
      input({ liquidityDepthUsd: 0, realisedVolBps: 9_999, onchain: { floorApyBps: 1, volCapBps: 1 } }),
    );
    expect(decision.reason).toBe("signal_desync");
  });
});

describe("decideFlight — drift", () => {
  it("rebalances when weight drifts past the band", () => {
    const decision = decideFlight(input({ currentWeightBps: 4_000, targetWeightBps: 5_000 }));
    expect(decision.action).toBe("REBALANCE");
    expect(decision.reason).toBe("drift");
    // A rebalance takes the leg back to target; it does not re-choose the venue,
    // so a drift correction cannot silently migrate the book into a new vault.
    expect(decision.steps).toEqual(["swapvm-take"]);
    expect(decision.vault.chosen).toBeNull();
  });

  it("does not rebalance on drift inside the band", () => {
    expect(decideFlight(input({ currentWeightBps: 4_800, targetWeightBps: 5_000 })).action).toBe("HOLD");
  });

  it("flies rather than rebalances when a flight trigger also fires", () => {
    const decision = decideFlight(
      input({ currentWeightBps: 1_000, targetWeightBps: 5_000, realisedVolBps: 2_000 }),
      { vaults: [vault(409)] },
    );
    expect(decision.action).toBe("FLIGHT_TO_STABLE");
  });
});

describe("decideFlight — a flight with nowhere to land", () => {
  it("still takes the volatile leg when no vault is registered for the chain", () => {
    // The deliberate behaviour: suppressing the swap to protect the completeness
    // of the pipeline would keep funds in a position the policy has already
    // judged unsafe.
    const decision = decideFlight(input({ realisedVolBps: 2_000 }), { vaults: [] });
    expect(decision.action).toBe("FLIGHT_TO_STABLE");
    expect(decision.steps).toEqual(["swapvm-take"]);
    expect(decision.vault.chosen).toBeNull();
    expect(decision.vault.rejected[0]?.reason).toBe("protocol_absent_on_chain");
  });

  it("still takes the volatile leg when every candidate is unfit", () => {
    const unfit: VaultCandidate = {
      ...vault(2_979_958),
      ref: { ...vault(0).ref, address: "0xdd0f28e19C1780eb6396170735D45153D261490d" },
    };
    const decision = decideFlight(input({ realisedVolBps: 2_000 }), { vaults: [unfit] });
    expect(decision.steps).toEqual(["swapvm-take"]);
    expect(decision.vault.chosen).toBeNull();
    expect(decision.vault.rejected[0]?.reason).toBe("implausible_yield");
  });
});

describe("decideFlight — input validation", () => {
  it("refuses a non-finite yield instead of signing a price from it", () => {
    expect(() => decideFlight(input({ yieldApyBps: Number.NaN }))).toThrow();
  });

  it("refuses a negative volatility", () => {
    expect(() => decideFlight(input({ realisedVolBps: -1 }))).toThrow();
  });
});

describe("deriveYieldFloorBps", () => {
  it("sits above the destination's own yield, because parity is not worth the risk", () => {
    expect(deriveYieldFloorBps(460)).toBe(460 + DEFAULT_FLIGHT_BUFFER_BPS);
  });

  it("falls back to the conservative default when the destination is unmeasured", () => {
    // "We have not measured the alternative" must not read as "the alternative
    // pays nothing" — that would make every position look worth holding.
    expect(deriveYieldFloorBps(undefined)).toBe(DEFAULT_FLIGHT_THRESHOLDS.yieldFloorBps);
  });

  it("never returns a negative floor", () => {
    expect(deriveYieldFloorBps(0, -100)).toBe(0);
  });
});

describe("thresholdsFor", () => {
  it("moves the floor with the destination's yield", () => {
    expect(thresholdsFor({ stableApyBps: 500 }).yieldFloorBps).toBe(575);
  });

  it("lets an explicit override win over the derivation", () => {
    expect(thresholdsFor({ stableApyBps: 500, overrides: { yieldFloorBps: 300 } }).yieldFloorBps).toBe(300);
  });

  it("leaves the non-derived thresholds at their defaults", () => {
    const thresholds = thresholdsFor({ stableApyBps: 500 });
    expect(thresholds.volCapBps).toBe(DEFAULT_FLIGHT_THRESHOLDS.volCapBps);
    expect(thresholds.driftBps).toBe(DEFAULT_FLIGHT_THRESHOLDS.driftBps);
    expect(thresholds.minLiquidityDepthUsd).toBe(DEFAULT_FLIGHT_THRESHOLDS.minLiquidityDepthUsd);
  });

  it("drives a real decision through the derivation", () => {
    // The end-to-end version of the unit test above: with the floor derived from a
    // 460 bps destination, a 500 bps position is *under* the floor and flies.
    const decision = decideFlight(input({ yieldApyBps: 500, onchain: { floorApyBps: 535, volCapBps: 1_500 } }), {
      stableApyBps: 460,
      vaults: [vault(460)],
    });
    expect(decision.action).toBe("FLIGHT_TO_STABLE");
    expect(decision.reason).toBe("yield_below_floor");
  });
});
