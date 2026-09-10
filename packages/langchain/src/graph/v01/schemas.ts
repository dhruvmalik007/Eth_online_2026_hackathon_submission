import { Annotation } from '@langchain/langgraph';
import { z } from 'zod';
import type { TimesFMForecast } from '../../services/timesfm3/index.js';

/**
 * V0.1 agent state — the shared memory hub from
 * docs/timeseries-model-architecture.md: [Ingested Context] + [Agent
 * Processing Space], carried between the five nodes with zod-enforced
 * payloads.
 */

// ── Category A: unstructured textual parameters ─────────────────────────────

export const ProtocolRuleDocSchema = z.object({
  sector: z.enum(['staking', 'liquidity', 'lending']),
  protocol: z.string().min(1),
  /** Verbatim rule text — what the rule parser (node 2) reads. */
  text: z.string().min(1),
  source: z.string().min(1), // e.g. 'docs/protocols/aave-v3.md#risk'
});

export type ProtocolRuleDoc = z.infer<typeof ProtocolRuleDocSchema>;

// ── Node 2 output: structured constraint schema ──────────────────────────────

export const ConstraintSchema = z.object({
  id: z.string().min(1), // e.g. 'c-aave-v3-liquidation'
  protocol: z.string().min(1),
  sector: ProtocolRuleDocSchema.shape.sector,
  kind: z.enum(['lockup', 'slashing', 'fee', 'ltv', 'liquidation', 'hook', 'rate-mode', 'other']),
  /** Machine-readable boundary, e.g. { lockupHours: 168 } | { ltvMax: 0.8 }. */
  boundary: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  /** Human-readable rule statement, verbatim-ish from the source doc. */
  statement: z.string().min(1),
  source: z.string().min(1),
});

export type ConstraintSchemaT = z.infer<typeof ConstraintSchema>;

// ── Node 3 output: yield projections (from TimesFM-3) ────────────────────────

export const YieldProjectionSchema = z.object({
  id: z.string().min(1), // e.g. 'proj-0xpool-apy'
  poolId: z.string().min(1),
  target: z.enum(['apy', 'volume', 'tvl', 'utilization']),
  horizonDays: z.number().int().positive(),
  steps: z.array(
    z.object({
      day: z.number().int().positive(),
      q10: z.number(),
      q50: z.number(),
      q90: z.number(),
    }),
  ).min(1),
  model: z.string().min(1),
  inputsHash: z.string().min(1),
  /** Guardrail flags from the TimesFM client (§2.2 — scale sanity). */
  suspicious: z.boolean(),
});

export type YieldProjection = z.infer<typeof YieldProjectionSchema>;

// ── Node 4 output: synthesis matrix ─────────────────────────────────────────

export const SynthesisViolationSchema = z.object({
  id: z.string().min(1),
  protocol: z.string().min(1),
  constraintId: z.string().min(1),
  projectionId: z.string().min(1),
  statement: z.string().min(1),
});

export const SynthesisAlphaSchema = z.object({
  id: z.string().min(1),
  protocol: z.string().min(1),
  projectionId: z.string().min(1),
  thesis: z.string().min(1),
});

export const SynthesisMatrixSchema = z.object({
  violations: z.array(SynthesisViolationSchema),
  alpha: z.array(SynthesisAlphaSchema),
  feasibility: z.array(
    z.object({
      protocol: z.string().min(1),
      /** Deterministic pre-compute from quantilesToRisk — LLM cites, never computes. */
      risk: z.record(z.string(), z.number()),
      feasible: z.boolean(),
    }),
  ),
});

export type SynthesisMatrix = z.infer<typeof SynthesisMatrixSchema>;

// ── Node 5 output: readjustment decisions (execution matrix) ────────────────

export const ReadjustmentActionSchema = z.object({
  action: z.enum(['WITHDRAW_LIQUIDITY', 'SUPPLY_CAPITAL', 'DEPOSIT_LSD', 'HOLD']),
  protocol: z.string().min(1),
  amountPercentage: z.number().min(0).max(100),
  rationale: z.string().min(1),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  /** Traceability: projections + constraints this decision is grounded in. */
  citations: z.array(z.string().min(1)).min(1),
});

export type ReadjustmentAction = z.infer<typeof ReadjustmentActionSchema>;

// ── Deterministic risk assessment (guardrails) ───────────────────────────────

export const RiskAssessmentSchema = z.object({
  /** Force HOLD + one re-plan cycle when a guardrail breaches. */
  replanNeeded: z.boolean(),
  reasons: z.array(z.string()),
  suspiciousProjections: z.array(z.string()),
});

export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

export const AuditEntrySchema = z.object({
  at: z.string(), // ISO timestamp
  node: z.string(),
  detail: z.string(),
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/** Deterministic input for the TimesFM-3 conversion (pure, testable). */
export type ProjectionInput = Readonly<{
  poolId: string;
  target: YieldProjection['target'];
  forecast: TimesFMForecast;
}>;

// ── LangGraph state ──────────────────────────────────────────────────────────

export const V01Annotation = Annotation.Root({
  mandate: Annotation<string>,
  sectors: Annotation<string[]>,
  poolIds: Annotation<string[]>,
  rawProtocolRules: Annotation<ProtocolRuleDoc[]>,
  protocolConstraints: Annotation<ConstraintSchemaT[]>({
    reducer: (a, b) => b,
    default: () => [],
  }),
  yieldProjections: Annotation<YieldProjection[]>({
    reducer: (a, b) => b,
    default: () => [],
  }),
  synthesisPayload: Annotation<SynthesisMatrix | undefined>({
    reducer: (_a, b) => b,
    default: () => undefined,
  }),
  readjustmentDecisions: Annotation<ReadjustmentAction[]>({
    reducer: (a, b) => b,
    default: () => [],
  }),
  riskAssessment: Annotation<RiskAssessment>({
    reducer: (a, b) => b,
    default: () => ({ replanNeeded: false, reasons: [], suspiciousProjections: [] }),
  }),
  replanCount: Annotation<number>({
    reducer: (a, b) => b,
    default: () => 0,
  }),
  /** TimesFM/LLM synthesis cycles run — bounds the re-plan loop (≤ 2). */
  synthesisRuns: Annotation<number>({
    reducer: (a, b) => b,
    default: () => 0,
  }),
  audit: Annotation<AuditEntry[]>({
    reducer: (a, b) => b,
    default: () => [],
  }),
});

export type V01State = typeof V01Annotation.State;
