import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEE_YIELD_THRESHOLDS,
  annualiseFeeYield,
  yieldOverRiskFree,
  type FeeYieldInput,
} from "../src/v4/yield.js";

function input(over: Partial<FeeYieldInput> = {}): FeeYieldInput {
  return {
    poolId: "0x83dfcb7b726c634c35776adb25f22ff54cd62e25593af523371fc22f3b4e7a2c",
    feesUsd: 100,
    liquidityUsd: 1_000_000,
    windowHours: 24,
    depthUsd: 5_000_000,
    ...over,
  };
}

describe("annualiseFeeYield", () => {
  it("annualises a measurement taken over a long enough window", () => {
    // 100 / 1e6 over 24h, extended to a year: 0.0001 * 365 = 3.65%.
    const reading = annualiseFeeYield(input());

    expect(reading.ok).toBe(true);
    if (!reading.ok) throw new Error("unreachable");
    expect(reading.apy).toBeCloseTo(0.0365, 6);
  });

  it("refuses a short window rather than multiplying one sample into a rate", () => {
    // The trap the floor exists for: one busy hour x 8,760 is not a year's income.
    const reading = annualiseFeeYield(input({ windowHours: 1, feesUsd: 500 }));

    expect(reading.ok).toBe(false);
    if (reading.ok) throw new Error("unreachable");
    expect(reading.reason).toBe("window_too_short");
    expect(reading.detail).toContain("multiply one sample by 8760");
  });

  it("accepts a window exactly at the floor", () => {
    const reading = annualiseFeeYield(input({ windowHours: DEFAULT_FEE_YIELD_THRESHOLDS.minWindowHours }));

    expect(reading.ok).toBe(true);
  });

  it("refuses to annualise against no liquidity", () => {
    const reading = annualiseFeeYield(input({ liquidityUsd: 0 }));

    expect(reading.ok).toBe(false);
    if (reading.ok) throw new Error("unreachable");
    expect(reading.reason).toBe("no_liquidity");
  });

  it("refuses a shallow pool, because fees in one cannot be taken cheaply", () => {
    const reading = annualiseFeeYield(input({ depthUsd: 1_000 }));

    expect(reading.ok).toBe(false);
    if (reading.ok) throw new Error("unreachable");
    expect(reading.reason).toBe("insufficient_depth");
    expect(reading.detail).toContain("cannot be exited cheaply");
  });

  it("refuses an implausible rate rather than clamping it", () => {
    // The Morpho-vault defect: a momentarily tiny liquidity figure makes the quotient enormous. A
    // clamped figure would be a fabricated one that happens to equal the ceiling.
    const reading = annualiseFeeYield(input({ feesUsd: 100_000, liquidityUsd: 1_000 }));

    expect(reading.ok).toBe(false);
    if (reading.ok) throw new Error("unreachable");
    expect(reading.reason).toBe("implausible");
    expect(reading.detail).toContain("refused rather than capped");
  });

  it("accepts a rate exactly at the ceiling", () => {
    // `apy` is a rate, not a percent: 0.05 is the 5% ceiling. The first version of this test asserted
    // `5`, which is the same confusion the module exists to avoid.
    const reading = annualiseFeeYield(input({ feesUsd: 136.986301369863, liquidityUsd: 1_000_000 }));

    expect(reading.ok).toBe(true);
    if (!reading.ok) throw new Error("unreachable");
    expect(reading.apy).toBeCloseTo(0.05, 9);
  });

  it("carries the depth on a successful reading, so a caller cannot use the yield without it", () => {
    const reading = annualiseFeeYield(input());

    expect(reading.ok).toBe(true);
    if (!reading.ok) throw new Error("unreachable");
    expect(reading.depthUsd).toBe(5_000_000);
  });

  it("names the pool on a rejection, so a caller can tell which leg it came from", () => {
    const reading = annualiseFeeYield(input({ windowHours: 1 }));

    expect(reading.poolId).toBe(input().poolId);
  });

  it("states the measured facts in the detail, so the number can be checked", () => {
    const reading = annualiseFeeYield(input());

    if (!reading.ok) throw new Error("unreachable");
    expect(reading.detail).toContain("$100 of fees");
    expect(reading.detail).toContain("24h");
  });
});

describe("yieldOverRiskFree", () => {
  it("is the comparison a fixed-income holder is actually making", () => {
    expect(yieldOverRiskFree(0.0365, 0.05)).toBeCloseTo(-0.0135, 6);
  });
});
