import {
  RetrievalEvidenceSchema,
  RiskContextSchema,
  type RetrievalEvidence,
  type RiskContext,
  type SynthesisMatrix,
  type YieldProjection,
} from './schemas.js';

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
 * Retrieval grounding guard — mirrors the citation rule applied to the LLM.
 *
 * A hit is admitted only if it re-validates against the schema AND every
 * `sourceId` is a non-empty, resolvable-looking row id. Retrieval is the one
 * place where text the model never wrote enters the prompt, so an ungrounded
 * or malformed chunk must be dropped rather than shown, otherwise the
 * citation guard downstream would be verifying claims against evidence that
 * itself has no provenance.
 */
export function validateRetrievalEvidence(evidence: readonly unknown[]): {
  admitted: RetrievalEvidence[];
  rejected: string[];
} {
  const admitted: RetrievalEvidence[] = [];
  const rejected: string[] = [];

  for (const [index, raw] of evidence.entries()) {
    const parsed = RetrievalEvidenceSchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push(`hit ${index}: schema invalid (${parsed.error.issues[0]?.message ?? 'unknown'})`);
      continue;
    }
    const hit = parsed.data;
    const unresolved = hit.sourceIds.filter((id) => id.trim().length === 0 || !isSourceId(id));
    if (unresolved.length > 0) {
      rejected.push(`hit ${index}: ${unresolved.length} unresolvable source id(s)`);
      continue;
    }
    if (hit.content.trim().length === 0) {
      rejected.push(`hit ${index}: empty content`);
      continue;
    }
    if (!Number.isFinite(hit.score)) {
      rejected.push(`hit ${index}: non-finite score`);
      continue;
    }
    admitted.push(hit);
  }

  return { admitted, rejected };
}

/** Source ids are namespaced row ids emitted by the timeseries serializer. */
function isSourceId(id: string): boolean {
  return /^(metric|forecast|decision|yield|calibration):/.test(id);
}

// ── Risk context grounding ───────────────────────────────────────────────────

/**
 * Ranges the derivation documents for its own outputs.
 *
 * These are the invariants asserted in the risk-analysis package: a collateral
 * haircut is a multiplier in `(0, 1]`, a probability-of-default load only ever
 * increases (`>= 1`), and the liquidity score is a `0..1` quality measure. A
 * value outside its range cannot have come from the derivation, so seeing one
 * means the payload was fabricated or corrupted.
 *
 * Finiteness is not re-checked here: `z.number()` rejects `NaN` and `Infinity`,
 * so the schema has already guaranteed it by the time these ranges are applied.
 */
const RISK_RANGES: Readonly<
  Record<string, { readonly min: number; readonly max: number; readonly exclusiveMin?: boolean }>
> = {
  volatility: { min: 0, max: Number.POSITIVE_INFINITY, exclusiveMin: true },
  riskFreeRate: { min: 0, max: Number.POSITIVE_INFINITY },
  collateralHaircut: { min: 0, max: 1, exclusiveMin: true },
  pdLoad: { min: 1, max: Number.POSITIVE_INFINITY },
  liquidityScore: { min: 0, max: 1 },
};

/**
 * Retrieval-grounding guard for the risk context.
 *
 * A risk payload enters the synthesis prompt, so it is held to the same standard
 * as retrieved evidence: it must re-validate against the schema *and* satisfy the
 * derivation's documented ranges. The second check is what makes this more than a
 * type check — a plausible-looking but invented multiplier would pass the schema
 * and fail the range, and the `factors` requirement means an adjustment with no
 * recorded inputs is rejected even when its numbers happen to be in range.
 *
 * @param raw - The unvalidated risk context.
 * @returns The admitted context, or null plus the reasons it was rejected.
 */
export function validateRiskContext(raw: unknown): {
  admitted: RiskContext | null;
  rejected: string[];
} {
  const rejected: string[] = [];
  const parsed = RiskContextSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      admitted: null,
      rejected: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    };
  }

  const context = parsed.data;

  for (const [name, bound] of Object.entries(RISK_RANGES)) {
    const value = context.adjustment[name as keyof typeof context.adjustment];
    const belowMin = bound.exclusiveMin === true ? value <= bound.min : value < bound.min;
    if (belowMin || value > bound.max) {
      rejected.push(
        `${name}=${value} is outside the derived range ` +
          `(${bound.exclusiveMin === true ? '(' : '['}${bound.min}, ${bound.max}]`,
      );
    }
  }

  // Every factor carries the inputs that produced it. An adjustment with no
  // factors did not come from the derivation, whatever its numbers look like.
  if (context.factors.length === 0) {
    rejected.push('adjustment carries no factors, so its inputs cannot be audited');
  }

  return { admitted: rejected.length === 0 ? context : null, rejected };
}

/**
 * Verify that every risk citation resolves to the context in state.
 *
 * A decision may be grounded in macro risk instead of a projection, so `risk-*`
 * ids are admissible citations — but only against the context actually present.
 * An id with no matching context is unresolvable, and treating it as grounded
 * would let a model cite a risk profile that was never derived.
 *
 * @param citations - The cited ids, from one or more decisions.
 * @param context - The risk context in state, or null when none was derived.
 * @returns The unresolvable risk ids, empty when every one resolves.
 */
export function unresolvedRiskCitations(
  citations: readonly string[],
  context: RiskContext | null,
): string[] {
  return citations.filter((id) => {
    if (!id.startsWith('risk-')) return false;
    return context === null || context.id !== id;
  });
}

/**
 * Deterministic risk gate over the full state payload — converts guardrail
 * results into the RiskAssessment (forced HOLD + bounded re-plan).
 */
export function assessRisk(input: {
  projections: readonly YieldProjection[];
  synthesis?: SynthesisMatrix;
  decisions: ReadonlyArray<{ amountPercentage: number; citations: readonly string[] }>;
  evidence?: readonly RetrievalEvidence[];
  riskProfile?: RiskContext | null;
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
    // Name the offending values: a count alone tells an operator the model
    // strayed but not what it cited, which is what the fix depends on.
    const offenders = ungrounded
      .flatMap((d) => d.citations.filter((c) => !isCitationId(c)))
      .slice(0, 5)
      .map((c) => (c.length > 40 ? `${c.slice(0, 40)}…` : c));
    reasons.push(
      `${ungrounded.length} decision(s) lack projection/constraint citations` +
        (offenders.length > 0 ? ` (got: ${offenders.join(', ')})` : ''),
    );
  }

  // Evidence that reached state must itself be grounded; a rejection here
  // means an unverifiable chunk slipped past retrieval.
  if (input.evidence !== undefined && input.evidence.length > 0) {
    const { rejected } = validateRetrievalEvidence(input.evidence);
    if (rejected.length > 0) {
      reasons.push(`${rejected.length} retrieved chunk(s) failed provenance validation`);
    }
  }

  // A risk context that reached state must satisfy the derivation's own ranges.
  // Checked here as well as at ingestion because state can be rehydrated from a
  // checkpoint, which is not a path the ingestion guard sees.
  if (input.riskProfile !== undefined && input.riskProfile !== null) {
    const { rejected } = validateRiskContext(input.riskProfile);
    if (rejected.length > 0) {
      reasons.push(`risk context failed derivation checks (${rejected.join('; ')})`);
    }
  }

  // A decision may cite macro risk instead of a projection, but only against the
  // context actually present — otherwise the citation resolves to nothing.
  const riskCitations = input.decisions.flatMap((d) =>
    d.citations.filter((c) => c.startsWith('risk-')),
  );
  if (riskCitations.length > 0) {
    const unresolved = unresolvedRiskCitations(riskCitations, input.riskProfile ?? null);
    if (unresolved.length > 0) {
      reasons.push(
        `${unresolved.length} decision(s) cite an unavailable risk context ` +
          `(got: ${[...new Set(unresolved)].join(', ')})`,
      );
    }
  }

  return { replanNeeded: reasons.length > 0, reasons, suspiciousProjections: suspicious };
}

/**
 * Citation ids a decision may carry.
 *
 * `risk-` is admitted alongside projections and constraints because a decision
 * can legitimately be grounded in macro risk rather than in a yield projection —
 * "hold because the chain's exit window is closing". Admitting the prefix does
 * not weaken the guard: {@link unresolvedRiskCitations} still requires a risk id
 * to match the context actually in state, so the prefix is a necessary condition
 * and never a sufficient one.
 */
function isCitationId(id: string): boolean {
  return id.startsWith('proj-') || id.startsWith('c-') || id.startsWith('risk-');
}
