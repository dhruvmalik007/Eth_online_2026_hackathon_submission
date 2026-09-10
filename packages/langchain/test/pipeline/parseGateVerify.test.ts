import { describe, it, expect } from "vitest";
import { parseMandate } from "../../src/pipeline/nodes/parseMandate.js";
import { evaluateRiskGate } from "../../src/pipeline/nodes/riskGate.js";
import { verifyResults, summarizeChecks } from "../../src/pipeline/nodes/verifyResults.js";
import type { StrategyResult, StrategyLeg } from "../../src/tools/fixedIncomeMath.js";
import type { StrategyState } from "../../src/pipeline/state.js";

describe("parseMandate", () => {
  it("applies defaults for an empty mandate", () => {
    const intent = parseMandate("");
    expect(intent.sizeUsd).toBe(10_000_000);
    expect(intent.minAprPercent).toBe(6);
    expect(intent.vegaBudget).toBe(0.5);
    expect(intent.asset).toBe("USDC");
    expect(intent.chains).toEqual(["ethereum", "arbitrum", "optimism", "polygon"]);
  });

  it("parses $-amounts with unit suffixes", () => {
    expect(parseMandate("$25M USDC").sizeUsd).toBe(25_000_000);
    expect(parseMandate("$1.5 billion").sizeUsd).toBe(1_500_000_000);
    expect(parseMandate("$500k").sizeUsd).toBe(500_000);
    expect(parseMandate("$42 USD").sizeUsd).toBe(42);
  });

  it("parses APR / vega / asset / chains clauses", () => {
    const intent = parseMandate("APR ≥ 8%, vega ≤ 0.3, asset USDT, chains: eth, arb");
    expect(intent.minAprPercent).toBe(8);
    expect(intent.vegaBudget).toBe(0.3);
    expect(intent.asset).toBe("USDT");
    expect(intent.chains).toEqual(["ethereum", "arbitrum"]);
  });

  it("detects hooked-only", () => {
    expect(parseMandate("hooked only").hookedOnly).toBe(true);
    expect(parseMandate("normal mandate").hookedOnly).toBe(false);
  });
});

const leg = (poolId: string, over: Partial<StrategyLeg> = {}): StrategyLeg => ({
  poolId,
  pair: "USDC/ETH",
  hook: null,
  sigma: 0.4,
  leverage: 1,
  feeApy: 0.1,
  feeSlopeK: 0.2,
  idleFraction: 0,
  lendingApy: 0.05,
  volumeUsd: 5_000_000,
  ...over,
});

const result = (over: Partial<StrategyResult> = {}): StrategyResult => ({
  legs: [],
  achievedApr: 0.08,
  portfolioVega: 0.3,
  maxConcentration: 0.4,
  sizeUsd: 10_000_000,
  minApr: 0.06,
  vegaBudget: 0.5,
  meetsAprTarget: true,
  withinVegaBudget: true,
  excluded: [],
  ...over,
});

describe("evaluateRiskGate", () => {
  it("passes a compliant allocation", () => {
    const gate = evaluateRiskGate({
      strategy: result(),
      legs: [leg("p1")],
      minAprPercent: 6,
      vegaBudget: 0.5,
    });
    expect(gate.passed).toBe(true);
    expect(gate.reasons).toEqual([]);
  });

  it("rejects when achieved APR is below mandate", () => {
    const gate = evaluateRiskGate({
      strategy: result({ achievedApr: 0.04 }),
      legs: [leg("p1")],
      minAprPercent: 6,
      vegaBudget: 0.5,
    });
    expect(gate.passed).toBe(false);
    expect(gate.reasons.join(" ")).toMatch(/APR/);
  });

  it("rejects when vega exceeds budget", () => {
    const gate = evaluateRiskGate({
      strategy: result({ portfolioVega: 0.8 }),
      legs: [leg("p1")],
      minAprPercent: 6,
      vegaBudget: 0.5,
    });
    expect(gate.passed).toBe(false);
    expect(gate.reasons.join(" ")).toMatch(/vega/i);
  });

  it("rejects concentration over the cap", () => {
    const gate = evaluateRiskGate({
      strategy: result({ maxConcentration: 0.7 }),
      legs: [leg("p1")],
      minAprPercent: 6,
      vegaBudget: 0.5,
      maxConcentrationPct: 50,
    });
    expect(gate.passed).toBe(false);
    expect(gate.reasons.join(" ")).toMatch(/concentration/i);
  });

  it("rejects a stress (σ×1.5) that drives APY negative", () => {
    // High leverage + high sigma → LVR explodes under 1.5σ stress. The stress loop
    // iterates over strategy.legs (weighted), so the result must carry a weighted leg.
    const gate = evaluateRiskGate({
      strategy: result({
        achievedApr: 0.08,
        portfolioVega: 1, // large so the vega check doesn't trip first
        legs: [{ poolId: "p1", pair: "USDC/ETH", hook: null, weight: 1, netApy: 0.08, lvr: 0.05, vega: 1, efficiency: 2, notionalUsd: 10_000_000 }],
      }),
      legs: [leg("p1", { leverage: 20, sigma: 0.9, feeApy: 0.1, feeSlopeK: 0.05 })],
      minAprPercent: 6,
      vegaBudget: 5, // large so vega doesn't trip first
    });
    expect(gate.passed).toBe(false);
    expect(gate.reasons.join(" ")).toMatch(/stress/i);
  });
});

describe("verifyResults (dry)", () => {
  const baseState = (over: Partial<StrategyState> = {}): StrategyState => ({
    mandate: "test",
    mode: "dry",
    plan: [{ seq: 1, kind: "v4-mint", label: "Mint", chain: "ethereum", notionalUsd: 10_000_000, poolId: "p1", pair: "USDC/ETH" }],
    results: [
      { seq: 1, kind: "v4-mint", label: "Mint", simulated: true, data: "0x1234abcd" },
    ],
    verification: { checks: [], passed: false },
    errors: [],
    intent: { sizeUsd: 10_000_000, minAprPercent: 6, vegaBudget: 0.5, chains: ["ethereum"], hookedOnly: false, asset: "USDC", maxCandidates: 6, leverageStable: 20, leverageVolatile: 1, idleFractionHooked: 0.3, minVolumeUsd: 1_000_000, feeSlopeMode: "estimated" },
    ...over,
  });

  it("passes a consistent dry run", () => {
    const checks = verifyResults(baseState());
    expect(summarizeChecks(checks)).toBe(true);
  });

  it("flags a missing leg result", () => {
    const checks = verifyResults(baseState({ results: [] }));
    const missing = checks.find((c) => c.name === "all-legs-accounted");
    expect(missing?.passed).toBe(false);
  });

  it("flags a notional drift > 2%", () => {
    const checks = verifyResults(
      baseState({ plan: [{ seq: 1, kind: "v4-mint", label: "Mint", chain: "ethereum", notionalUsd: 8_000_000, poolId: "p1", pair: "USDC/ETH" }] }),
    );
    const drift = checks.find((c) => c.name === "notional-consistency");
    expect(drift?.passed).toBe(false);
  });

  it("flags malformed calldata", () => {
    const checks = verifyResults(
      baseState({ results: [{ seq: 1, kind: "v4-mint", label: "Mint", simulated: true, data: "not-hex" }] }),
    );
    const calldata = checks.find((c) => c.name === "calldata-well-formed");
    expect(calldata?.passed).toBe(false);
  });
});
