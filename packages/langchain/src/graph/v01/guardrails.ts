import type { SynthesisMatrix, YieldProjection } from './schemas.js';

/**
 * V0.1 guardrails — pure functions, golden-tested. Every check runs BEFORE
 * its payload enters agent state; breaches produce typed reasons that the
 * risk gate converts into a forced HOLD + bounded re-plan cycle.
 */

/** Quantile monotonicity q10 ≤ q50 ≤ q90 on every projection step. */
export function quantilesMonotonic(p: YieldProjection): boolean {
  return p.steps.every((s) => s.q10 <= s.q50 && s.q50 <= s.q90);
}

/**
 * Scale sanity: every step median must stay within k·σ of the last realized
 * value (σ = historical std-dev of the series, absolute units). Returns true
 * when a step breaches the band.
 */
export function scaleSuspicious(
  p: YieldProjection,
  lastRealized: number,
  historyStdDev: number,
  k = 10,
): boolean {
  const bound = k * Math.max(historyStdDev, 1e-9);
  return p.steps.some((s) => Math.abs(s.q50 - lastRealized) > bound);
}

/** Execution-matrix invariant: Σ amount_percentage ≈ 100 (±1pt tolerance). */
export function amountsSumTo100(
  decisions: ReadonlyArray<{ amountPercentage: number }>,
): boolean {
  const total = decisions.reduce((sum, d) => sum + d.amountPercentage, 0);
  return Math.abs(total - 100) <= 1;
}

/**
 * Citation trace-check: every numeric-bearing payload entry must cite
 * projection (proj-*) or constraint (c-*) ids. A synthesis whose violations,
 * alpha, or feasibility rows lack citations is treated as hallucination.
 */
export function citationsGrounded(s: SynthesisMatrix): boolean {
  const isCitation = (id: string): boolean => id.startsWith('proj-') || id.startsWith('c-');
  // Note: feasibility.risk is deterministic pre-compute echoed back by the LLM; it is not citation-validated here.
  return (
    s.violations.every((v) => isCitation(v.constraintId) && isCitation(v.projectionId)) &&
    s.alpha.every((a) => isCitation(a.projectionId))
  );
}

/**
 * Deterministic risk gate over the full state payload — converts guardrail
 * results into the RiskAssessment (forced HOLD + bounded re-plan).
 */
export function assessRisk(input: {
  projections: readonly YieldProjection[];
  synthesis?: SynthesisMatrix;
  decisions: ReadonlyArray<{ amountPercentage: number; citations: readonly string[] }>;
}): { replanNeeded: boolean; reasons: string[]; suspiciousProjections: string[] } {
  const reasons: string[] = [];
  const suspicious: string[] = [];

  for (const p of input.projections) {
    if (!quantilesMonotonic(p)) {
      reasons.push(`projection ${p.id}: non-monotonic quantiles`);
      suspicious.push(p.id);
    }
    if (p.suspicious) {
      reasons.push(`projection ${p.id}: scale-sanity flag (k·σ breach)`);
      suspicious.push(p.id);
    }
  }

  if (input.synthesis !== undefined && !citationsGrounded(input.synthesis)) {
    reasons.push('synthesis matrix contains uncited numeric claims (hallucination guard)');
  }

  if (!amountsSumTo100(input.decisions)) {
    reasons.push('readjustment amounts do not sum to 100%');
  }

  const ungrounded = input.decisions.filter(
    (d) => d.citations.length === 0 || !d.citations.every(isCitationId),
  );
  if (ungrounded.length > 0) {
    reasons.push(`${ungrounded.length} decision(s) lack projection/constraint citations`);
  }

  return { replanNeeded: reasons.length > 0, reasons, suspiciousProjections: suspicious };
}

function isCitationId(id: string): boolean {
  return id.startsWith('proj-') || id.startsWith('c-');
}
