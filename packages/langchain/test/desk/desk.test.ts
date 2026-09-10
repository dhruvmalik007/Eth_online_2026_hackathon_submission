import { describe, it, expect } from "vitest";
import { evaluateRiskGuardian, applyOverride } from "../../src/desk/nodes/riskGuardian.js";
import { reconcile } from "../../src/desk/nodes/reconciliation.js";
import { initialDeskState, phaseConstraints } from "../../src/desk/deskState.js";
import { clampOverride } from "../../src/desk/hitl.js";
import type { DeskState } from "../../src/desk/deskState.js";

const baseState = (over: Partial<DeskState> = {}): DeskState => ({
  ...initialDeskState("2020-01-01", "dry"),
  ...over,
});

describe("evaluateRiskGuardian", () => {
  it("passes a compliant ALPHA_CAPTURE allocation", () => {
    const gate = evaluateRiskGuardian(
      baseState({
        sessionPhase: "ALPHA_CAPTURE",
        proposedAllocation: { alpha: 0.2, beta: 0.7, gamma: 0.003 },
        riskMetrics: { var95: 3, hhi: 0.5, lvr: 0.5 },
      }),
    );
    expect(gate.pass).toBe(true);
    expect(gate.reasons).toEqual([]);
  });

  it("rejects when β breaches the FRI defensive floor", () => {
    const gate = evaluateRiskGuardian(
      baseState({
        sessionPhase: "FRI_DEFENSIVE",
        proposedAllocation: { alpha: 0.1, beta: 0.5, gamma: 0.003 }, // β=0.5 < 0.8 floor
        riskMetrics: {},
      }),
    );
    expect(gate.pass).toBe(false);
    expect(gate.reasons.join(" ")).toMatch(/β.*floor/i);
  });

  it("rejects excessive concentration (HHI)", () => {
    const gate = evaluateRiskGuardian(
      baseState({
        sessionPhase: "ALPHA_CAPTURE",
        proposedAllocation: { alpha: 0.6, beta: 0.6, gamma: 0.003 }, // HHI > 0.6
        riskMetrics: {},
      }),
    );
    expect(gate.pass).toBe(false);
    expect(gate.reasons.join(" ")).toMatch(/HHI/i);
  });

  it("rejects VaR over the phase limit", () => {
    const gate = evaluateRiskGuardian(
      baseState({
        sessionPhase: "FRI_DEFENSIVE",
        proposedAllocation: { alpha: 0.05, beta: 0.85, gamma: 0.003 },
        riskMetrics: { var95: 5 }, // > FRI limit of 2%
      }),
    );
    expect(gate.pass).toBe(false);
    expect(gate.reasons.join(" ")).toMatch(/VaR95/i);
  });
});

describe("applyOverride (floor clamping)", () => {
  it("clamps a β override below the FRI floor back up to the floor", () => {
    const { allocation, rejected } = applyOverride(
      { alpha: 0.05, beta: 0.85, gamma: 0.003 },
      { beta: 0.3 },
      "FRI_DEFENSIVE",
    );
    expect(allocation.beta).toBe(0.8);
    expect(rejected.length).toBeGreaterThan(0);
  });

  it("permits an override above the floor", () => {
    const { allocation, rejected } = applyOverride(
      { alpha: 0.05, beta: 0.7, gamma: 0.003 },
      { beta: 0.6 },
      "ALPHA_CAPTURE",
    );
    expect(allocation.beta).toBe(0.6);
    expect(rejected).toEqual([]);
  });

  it("clampOverride (HITL helper) delegates correctly", () => {
    const { allocation } = clampOverride(
      { alpha: 0.05, beta: 0.85, gamma: 0.003 },
      { beta: 0.2 },
      "FRI_DEFENSIVE",
    );
    expect(allocation.beta).toBe(0.8);
  });
});

describe("phaseConstraints", () => {
  it("FRI enforces a higher β floor than ALPHA", () => {
    expect(phaseConstraints("FRI_DEFENSIVE").betaFloor).toBeGreaterThan(
      phaseConstraints("ALPHA_CAPTURE").betaFloor,
    );
  });

  it("FRI suggests a γ fee bump for LVR deflection", () => {
    expect(phaseConstraints("FRI_DEFENSIVE").gammaFeeBumpBps).toBe(15);
    expect(phaseConstraints("ALPHA_CAPTURE").gammaFeeBumpBps).toBe(0);
  });
});

describe("reconciliation", () => {
  it("computes the P&L identity", () => {
    const { realizedPnlUsd, notes } = reconcile(baseState(), {
      stakingRewardsUsd: 100,
      creditSpreadsUsd: 200,
      feesCapturedUsd: 50,
      lvrUsd: 30,
      gasUsd: 20,
    });
    expect(realizedPnlUsd).toBe(300); // 100+200+50-30-20
    expect(notes.join(" ")).toMatch(/300/);
  });

  it("is a no-op (zero P&L) in dry mode without readbacks", () => {
    const { realizedPnlUsd } = reconcile(baseState(), {});
    expect(realizedPnlUsd).toBe(0);
  });
});

describe("initialDeskState session-phase detection", () => {
  it("detects Monday as MON_MACRO", () => {
    // 2026-09-07 is a Monday
    expect(initialDeskState("2026-09-07", "dry").sessionPhase).toBe("MON_MACRO");
  });
  it("detects Friday as FRI_DEFENSIVE", () => {
    // 2026-09-11 is a Friday
    expect(initialDeskState("2026-09-11", "dry").sessionPhase).toBe("FRI_DEFENSIVE");
  });
  it("detects Tuesday as ALPHA_CAPTURE", () => {
    // 2026-09-08 is a Tuesday
    expect(initialDeskState("2026-09-08", "dry").sessionPhase).toBe("ALPHA_CAPTURE");
  });
});
