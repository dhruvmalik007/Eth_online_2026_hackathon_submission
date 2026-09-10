import { z } from 'zod';
import type { StructuredLlm } from './ruleParser.js';
import { parseJsonArray, parseJsonObject } from './jsonUtils.js';
import {
  ReadjustmentActionSchema,
  SynthesisMatrixSchema,
  type ConstraintSchemaT,
  type ReadjustmentAction,
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
  llm: StructuredLlm;
}): Promise<SynthesisMatrix> {
  const precomputed = precomputeProjectionRisk(input.projections);
  const user = [
    '## Extracted constraints (structured)',
    JSON.stringify(input.constraints, null, 1),
    '## TimesFM-3 projections (quantile steps)',
    JSON.stringify(input.projections, null, 1),
    '## Deterministically pre-computed risk (cite these numbers as-is)',
    JSON.stringify(precomputed, null, 1),
  ].join('\n\n');

  const prompt = `${user}

Task: intersect the constraints with the projections. Isolate constraint
violations and alpha. For every protocol, assess feasibility using the
pre-computed risk numbers EXACTLY as given — do not compute anything yourself.
Cite identifiers: violations cite a constraint id (c-*) and a projection id
(proj-*); alpha entries cite their projection id (proj-*).

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
- every entry cites the projection (proj-*) and constraint (c-*) ids it is
  grounded in
- parameters are transaction-ready fields only (rate_mode, target_ltv,
  min_acceptable_ex_rate, ...) — NEVER raw calldata
- if the synthesis shows unresolved violations, emit a single HOLD entry

Respond ONLY with a JSON array of those objects.`;

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
