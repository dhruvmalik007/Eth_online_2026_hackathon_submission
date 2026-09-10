/**
 * riskGuardian — deterministic code-level risk gate for the desk session (NO AI).
 *
 * Implements the founder's compliance breakpoint (plan §9.2/§10): absolute VaR/ES
 * checks, concentration (HHI), and — critically — a β safety floor that is
 * NON-NEGOTIABLE. A trader override that breaches the floor is rejected
 * deterministically and routed back to research. Hallucination cannot buy its way
 * past compliance.
 *
 * Pure function over DeskState so it is unit-testable offline.
 */
import type { DeskState, Allocation, SessionPhase } from "../deskState.js";
import { phaseConstraints } from "../deskState.js";

export interface RiskGuardianResult {
  pass: boolean;
  reasons: string[];
}

export function evaluateRiskGuardian(state: DeskState): RiskGuardianResult {
  const reasons: string[] = [];
  const c = phaseConstraints(state.sessionPhase);

  // ── β floor (non-negotiable) ──────────────────────────────────────────
  if (state.proposedAllocation.beta < c.betaFloor) {
    reasons.push(
      `β ${state.proposedAllocation.beta.toFixed(2)} breaches ${state.sessionPhase} safety floor ${c.betaFloor} — defensive posture required`,
    );
  }

  // ── concentration (HHI) ───────────────────────────────────────────────
  const { alpha, beta, gamma } = state.proposedAllocation;
  const hhi = alpha * alpha + beta * beta + gamma * gamma;
  if (hhi > 0.6) {
    reasons.push(`concentration HHI ${hhi.toFixed(2)} exceeds 0.6 cap`);
  }
  if (alpha + beta > 0.98) {
    reasons.push("reserve cash leg < 2%");
  }

  // ── VaR limit ─────────────────────────────────────────────────────────
  if (state.riskMetrics.var95 !== undefined && state.riskMetrics.var95 > c.varLimitPct) {
    reasons.push(`VaR95 ${state.riskMetrics.var95.toFixed(2)}% exceeds ${state.sessionPhase} limit ${c.varLimitPct}%`);
  }

  // ── LVR deflection check (10:00–16:00) ───────────────────────────────
  if (state.riskMetrics.lvr !== undefined && state.riskMetrics.lvr > 1.0) {
    reasons.push(`retained LVR ${state.riskMetrics.lvr.toFixed(2)} bps — dynamic-fee deflection recommended`);
  }

  return { pass: reasons.length === 0, reasons };
}

/**
 * Apply a trader's manual override, but clamp it to the hardcoded floors.
 * Returns the (possibly clamped) allocation + whether the override was partially rejected.
 */
export function applyOverride(
  base: Allocation,
  overrides: Partial<Allocation>,
  phase: SessionPhase,
): { allocation: Allocation; rejected: string[] } {
  const c = phaseConstraints(phase);
  const rejected: string[] = [];
  const candidate: Allocation = { ...base, ...overrides };

  // Clamp β to the non-negotiable floor.
  if (candidate.beta < c.betaFloor) {
    rejected.push(`β override ${candidate.beta} clamped to floor ${c.betaFloor}`);
    candidate.beta = c.betaFloor;
  }
  // Normalize weights to ≤ 1.
  const total = candidate.alpha + candidate.beta;
  if (total > 0.99) {
    rejected.push(`weights sum ${total.toFixed(2)} exceeds 0.99 — scaling reserve to 1%`);
    const scale = 0.99 / total;
    candidate.alpha *= scale;
    candidate.beta *= scale;
  }
  return { allocation: candidate, rejected };
}
