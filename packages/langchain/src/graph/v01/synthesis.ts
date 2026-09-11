import { z } from 'zod';
import type { StructuredLlm } from './ruleParser.js';
import { parseJsonArray, parseJsonObject } from './jsonUtils.js';
import {
  ReadjustmentActionSchema,
  SynthesisMatrixSchema,
  type CalibrationSlice,
  type ConstraintSchemaT,
  type ReadjustmentAction,
  type RetrievalEvidence,
  type RiskContext,
  type SynthesisMatrix,
  type YieldProjection,
} from './schemas.js';
import { quantilesToRisk } from '../../tools/fixedIncomeRisk.js';

/**
 * Node 4 — Quant Synthesis (LLM reasoning core) and
 * Node 5 — Readjustment Engine (LLM → deterministic execution matrix).
 * Guardrails: deterministic pre-compute (Strategy 1), citation trace-check,
 * one bounded re-ask, execution matrix zod-enforced (Σ ≈ 100, no raw calldata).
 */

// ── deterministic pre-compute (Strategy 1) ──────────────────────────────────

export interface PrecomputedRisk {
  readonly protocol: string;
  readonly projectionId: string;
  readonly downsideBandWidth: number;
  readonly bandVol: number;
  readonly trendSlope: number;
  readonly varDownside: number;
}

export function precomputeProjectionRisk(
  projections: readonly YieldProjection[],
): PrecomputedRisk[] {
  return projections.map((p) => {
    const risk = quantilesToRisk(p.steps.map((s) => ({ q10: s.q10, q50: s.q50, q90: s.q90 })));
    return {
      protocol: p.poolId,
      projectionId: p.id,
      downsideBandWidth: risk.downsideBandWidth,
      bandVol: risk.bandVol,
      trendSlope: risk.trendSlope,
      varDownside: risk.varDownside,
    };
  });
}

// ── node 4: synthesis ───────────────────────────────────────────────────────

export async function synthesize(input: {
  constraints: readonly ConstraintSchemaT[];
  projections: readonly YieldProjection[];
  /** Retrieved historical chunks, already provenance-validated. */
  evidence?: readonly RetrievalEvidence[];
  /** SQL-computed forecast reliability — quoted verbatim, never recomputed. */
  calibration?: CalibrationSlice | null;
  /**
   * Derived macro/governance risk, computed before the model runs. Offered as
   * given inputs: the model reasons about these parameters but never produces or
   * adjusts them, and may cite the context id.
   */
  riskProfile?: RiskContext | null;
  llm: StructuredLlm;
}): Promise<SynthesisMatrix> {
  const precomputed = precomputeProjectionRisk(input.projections);
  const sections = [
    '## Extracted constraints (structured)',
    JSON.stringify(input.constraints, null, 1),
    '## TimesFM-3 projections (quantile steps)',
    JSON.stringify(input.projections, null, 1),
    '## Deterministically pre-computed risk (cite these numbers as-is)',
    JSON.stringify(precomputed, null, 1),
  ];

  // Chain risk is provided, not inferred. The instruction is explicit because a
  // model handed a volatility number will otherwise try to justify recomputing
  // it, and any number it produces that way is unfalsifiable.
  if (input.riskProfile !== undefined && input.riskProfile !== null) {
    const risk = input.riskProfile;
    sections.push(
      '## Macro / governance risk (derived deterministically — do not recompute)',
      JSON.stringify(
        {
          id: risk.id,
          chain: risk.chain,
          volatility: risk.adjustment.volatility,
          riskFreeRate: risk.adjustment.riskFreeRate,
          collateralHaircut: risk.adjustment.collateralHaircut,
          pdLoad: risk.adjustment.pdLoad,
          liquidityScore: risk.adjustment.liquidityScore,
          volatilitySource: risk.volatilitySource,
        },
        null,
        1,
      ),
      `These parameters were computed from collected risk data before this prompt was ` +
        `built. Cite the id \`${risk.id}\` when a decision depends on them; do not restate ` +
        `or adjust the numbers, and do not derive new ones.` +
        (risk.volatilitySource === 'fallback'
          ? ' volatilitySource=fallback means no realized volatility was measured, so the ' +
            'documented constant was used — treat the volatility figure as an assumption ' +
            'rather than an observation.'
          : ''),
      risk.unresolved.length > 0
        ? `No snapshot was available for: ${risk.unresolved.join(', ')} — the corresponding ` +
          `risk term is absent, not zero.`
        : '',
    );
  }

  // Retrieved history is offered as grounded context. Each chunk carries the
  // row ids it was rendered from, so a claim built on it can be traced back.
  const evidence = input.evidence ?? [];
  if (evidence.length > 0) {
    sections.push(
      '## Retrieved historical context (grounded — each line is a stored row)',
      evidence
        .map((e) => `### ${e.kind} [${e.sourceIds.join(', ')}] (score ${e.score.toFixed(3)})\n${e.content}`)
        .join('\n\n'),
    );
  }

  const calibration = input.calibration ?? null;
  if (calibration !== null) {
    sections.push(
      '## Forecast reliability for this pool (SQL-computed — quote, do not recompute)',
      JSON.stringify(calibration, null, 1),
    );
  }

  const prompt = `${sections.join('\n\n')}

Task: intersect the constraints with the projections. Isolate constraint
violations and alpha. For every protocol, assess feasibility using the
pre-computed risk numbers EXACTLY as given — do not compute anything yourself.
Cite identifiers: violations cite a constraint id (c-*) and a projection id
(proj-*); alpha entries cite their projection id (proj-*). When you lean on
retrieved history, cite the row ids shown for that chunk. Treat the forecast
reliability figures as the confidence signal for these projections.${
    evidence.length === 0 && calibration === null
      ? ' No historical context or reliability figures were available for this run.'
      : ''
  }

Respond ONLY with JSON: { "violations": [{ "id": string, "protocol": string,
"constraintId": string, "projectionId": string, "statement": string }],
"alpha": [{ "id": string, "protocol": string, "projectionId": string,
"thesis": string }], "feasibility": [{ "protocol": string, "risk": object,
"feasible": boolean }] }`;

  return parseWithRetry<SynthesisMatrix>(
    input.llm,
    prompt,
    (text) => SynthesisMatrixSchema.parse(parseJsonObject(text)),
  );
}

// ── node 5: readjustment engine ─────────────────────────────────────────────

export async function generateReadjustment(input: {
  synthesis: SynthesisMatrix;
  llm: StructuredLlm;
}): Promise<ReadjustmentAction[]> {
  const prompt = `## Synthesis matrix
${JSON.stringify(input.synthesis, null, 1)}

Task: emit the optimal reallocation matrix (execution-ready). Rules:
- actions: WITHDRAW_LIQUIDITY | SUPPLY_CAPITAL | DEPOSIT_LSD | HOLD
- amount_percentage across all entries must sum to 100 (±1)
- citations MUST be an array of id STRINGS, e.g.
  "citations": ["proj-0xpool-apy", "c-aave-v3-0-ltv"]
- cite ONLY these two kinds of id, copied verbatim from the matrix above:
    * the \`projectionId\` values (they start with "proj-")
    * the \`constraintId\` values (they start with "c-")
  Do NOT cite a violation's or alpha entry's own \`id\`, and do not invent
  labels or prefixes of your own — a citation that is not one of those exact
  strings is treated as ungrounded and forces a re-plan.
- parameters are transaction-ready fields only (rate_mode, target_ltv,
  min_acceptable_ex_rate, ...) — NEVER raw calldata
- if the synthesis shows unresolved violations, emit a single HOLD entry

Respond ONLY with a JSON array of those objects, and nothing else.`;

  return parseWithRetry<ReadjustmentAction[]>(
    input.llm,
    prompt,
    (text) => z.array(ReadjustmentActionSchema).parse(parseJsonArray(text)),
  );
}

// ── shared: bounded-retry JSON parsing (1 re-ask) ───────────────────────────

async function parseWithRetry<T>(
  llm: StructuredLlm,
  prompt: string,
  parse: (text: string) => T,
): Promise<T> {
  const first = await llm.invoke({ system: '', user: prompt });
  try {
    return parse(first);
  } catch (err) {
    const retry = await llm.invoke({
      system: '',
      user: `${prompt}\n\nYour previous response failed validation:\n${(err as Error).message}\n\nRespond again with strictly valid JSON.`,
    });
    return parse(retry);
  }
}
