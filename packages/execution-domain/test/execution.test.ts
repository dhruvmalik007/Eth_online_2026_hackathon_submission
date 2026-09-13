/**
 * The contract itself: fee semantics, and the two corrections that let it
 * describe a *live* execution rather than only the simulated one.
 */
import { describe, expect, it } from "vitest";
import {
  ExecutionPlanSchema,
  ExecutionStepSchema,
  ExecutionStepStateSchema,
  FeeTierSchema,
  QuoteSchema,
  sumWalletCost,
} from "../src/index.js";
import type { FeeLine } from "../src/index.js";

function cost(id: string, amountUsd: number, included = false): FeeLine {
  return { id, label: id, tier: "cost", amountUsd, included };
}

function nonCost(id: string, tier: "bound" | "market", amountUsd: number): FeeLine {
  return { id, label: id, tier, amountUsd };
}

describe("sumWalletCost", () => {
  it("sums the costs that actually leave the wallet", () => {
    expect(sumWalletCost([cost("gas", 1.25), cost("bridge", 0.5)])).toBeCloseTo(1.75, 10);
  });

  it("excludes a cost already netted into the quote", () => {
    // LI.FI reports `included: true` for costs taken out of the quoted output;
    // summing those would double-count them.
    expect(sumWalletCost([cost("gas", 1), cost("protocol", 5, true)])).toBeCloseTo(1, 10);
  });

  it("never sums a slippage bound or a price impact", () => {
    // A `bound` is a maximum the user accepts, not a charge; a `market` effect
    // is a consequence of their own size.
    const fees = [cost("gas", 2), nonCost("slippage", "bound", 40), nonCost("impact", "market", 12)];
    expect(sumWalletCost(fees)).toBeCloseTo(2, 10);
  });

  it("is zero for no fees", () => {
    expect(sumWalletCost([])).toBe(0);
  });
});

describe("the fee tiers", () => {
  it("are exactly cost, bound and market", () => {
    expect(FeeTierSchema.options).toEqual(["cost", "bound", "market"]);
  });

  it("rejects a tier outside the three", () => {
    expect(FeeTierSchema.safeParse("gas").success).toBe(false);
  });
});

describe("a quote keeps the three stages of a cross-chain step", () => {
  it("parses tracking with only the source leg filled in", () => {
    const quote = QuoteSchema.parse({
      legId: "leg-1",
      provider: "lifi",
      venue: "LI.FI · Stargate",
      fees: [cost("gas", 0.2), cost("bridge", 0.4)],
      slippageBoundPct: 0.5,
      priceImpactPct: 0.02,
      estimatedSeconds: 900,
    });
    expect(quote.estimatedSeconds).toBe(900);
  });
});

describe("the contract can now describe a live execution", () => {
  it("accepts simulated: false", () => {
    // The original SPA type hard-coded `simulated: true`, so a live plan was
    // literally unrepresentable.
    const plan = ExecutionPlanSchema.parse({
      id: "plan-1",
      createdAt: 1_700_000_000_000,
      legs: [],
      quotes: [],
      steps: [],
      batchDigest: "0x",
      batchIntent: "",
      totals: { notionalUsd: 0, costUsd: 0, boundUsd: 0 },
      mode: "batch",
      signing: "safe-batch",
      simulated: false,
    });
    expect(plan.simulated).toBe(false);
  });

  it("parses a step in the bridging state, which is its own state", () => {
    // The step vocabulary moved out of a React component, so a server can use it.
    expect(ExecutionStepStateSchema.parse("bridging")).toBe("bridging");
    const step = ExecutionStepSchema.parse({
      id: "step-1",
      legId: "leg-1",
      kind: "bridge",
      label: "Bridge to Base",
      intent: "Bridge 1,000 USDC from Polygon to Base",
      tx: { to: "0x0000000000000000000000000000000000000001", value: "0", data: "0x", operation: 0 },
      state: "bridging",
      tracking: { srcTxHash: "0xabc", guid: "0xdef" },
    });
    expect(step.state).toBe("bridging");
    expect(step.tracking?.guid).toBe("0xdef");
  });
});
