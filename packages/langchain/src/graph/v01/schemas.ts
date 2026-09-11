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
  /**
   * The persisted forecast run this projection came from. Present whenever the
   * ledger write succeeded — it is the citation anchor that lets a synthesis
   * point at stored rows instead of restating numbers.
   */
  forecastRunId: z.string().min(1).optional(),
});

export type YieldProjection = z.infer<typeof YieldProjectionSchema>;

// ── Retrieval evidence (temporal vector search) ─────────────────────────────

/**
 * One retrieved chunk of historical data. `sourceIds` are the ids of the
 * database rows the chunk was serialized from — the citation guard verifies
 * these resolve, so ungrounded text can never enter the prompt.
 */
export const RetrievalEvidenceSchema = z.object({
  id: z.string().min(1),
  poolId: z.string().min(1),
  kind: z.enum(['metric_window', 'forecast_run', 'decision', 'performance_slice']),
  tsStart: z.string().min(1),
  tsEnd: z.string().min(1),
  score: z.number(),
  sourceIds: z.array(z.string().min(1)).min(1),
  content: z.string().min(1),
});

export type RetrievalEvidence = z.infer<typeof RetrievalEvidenceSchema>;

/**
 * Forecast reliability for one pool+metric, computed by SQL. The LLM may quote
 * these figures (they become citation targets) but never computes them.
 */
export const CalibrationSliceSchema = z.object({
  poolId: z.string().min(1),
  metric: z.string().min(1),
  samples: z.number().int().nonnegative(),
  /** Empirical share of actuals inside the q10–q90 band. */
  coverage: z.number(),
  meanPinballLoss: z.number(),
  meanAbsoluteError: z.number(),
  meanAbsolutePercentageError: z.number().nullable(),
});

export type CalibrationSlice = z.infer<typeof CalibrationSliceSchema>;

// ── Macro / governance risk context ─────────────────────────────────────────

/**
 * The derived risk parameters for one subject, as they enter agent state.
 *
 * This is a *snapshot of a derivation*, not a model output: every number was
 * computed by pure functions in the risk-analysis package from collected L2Beat
 * and governance data, and the `factors` array records the inputs behind each
 * one. Being able to see those inputs is the point — an agent quoting a
 * volatility multiplier should be able to say what produced it.
 */
export const RiskContextSchema = z.object({
  /** Citation id for this context, e.g. `risk-base`. Decisions cite this. */
  id: z.string().min(1),
  chain: z.string().min(1),
  chainName: z.string().min(1),
  /** The governance subject, when one was included. */
  protocol: z.string().min(1).nullable(),
  /** Market makers whose liquidity fed the score. */
  marketMakers: z.array(z.string().min(1)),
  /**
   * The five parameters the pricing math consumes. Ranges are asserted by the
   * guardrail rather than here, so a breach names itself as a guardrail failure
   * instead of a schema error.
   */
  adjustment: z.object({
    volatility: z.number(),
    riskFreeRate: z.number(),
    collateralHaircut: z.number(),
    pdLoad: z.number(),
    liquidityScore: z.number(),
  }),
  /** `realized` means measured from history; `fallback` is a documented constant. */
  volatilitySource: z.enum(['realized', 'fallback']),
  /** One entry per applied factor, with the inputs that produced it. */
  factors: z.array(
    z.object({
      name: z.string().min(1),
      value: z.number(),
      explanation: z.string().min(1),
    }),
  ),
  /** Requested subjects that had no snapshot — named, never treated as zero. */
  unresolved: z.array(z.string().min(1)),
});

export type RiskContext = z.infer<typeof RiskContextSchema>;

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

/**
 * A citation id.
 *
 * The contract is a plain id string (`proj-*` / `c-*`), but models frequently
 * express a citation as an object — `{ "projectionId": "proj-x" }` — instead.
 * Rejecting that would discard an otherwise valid, genuinely grounded decision
 * over a formatting difference, so the value is normalized to its id before
 * validation. The guardrail's actual job is unchanged: a decision must still
 * carry resolvable `proj-*` / `c-*` ids, and anything else is still rejected
 * (see `citationsGrounded`).
 */
const CitationIdSchema = z.preprocess((value) => {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ['projectionId', 'constraintId', 'id', 'citation', 'ref', 'sourceId']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
    }
    // Fall back to the first non-empty string the object carries.
    for (const candidate of Object.values(record)) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
    }
  }
  return value;
}, z.string().min(1));

export const ReadjustmentActionSchema = z.object({
  action: z.enum(['WITHDRAW_LIQUIDITY', 'SUPPLY_CAPITAL', 'DEPOSIT_LSD', 'HOLD']),
  protocol: z.string().min(1),
  amountPercentage: z.number().min(0).max(100),
  rationale: z.string().min(1),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  /** Traceability: projections + constraints this decision is grounded in. */
  citations: z.array(CitationIdSchema).min(1),
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
  /**
   * The chain the mandate targets, when the caller named one.
   *
   * Needed because the derived risk parameters are chain-scoped: a collateral
   * haircut is a property of the chain's safety regime, not of the portfolio.
   * Absent means no chain-level risk is derived, which the prompt states rather
   * than substituting a default.
   */
  chain: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
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
  /**
   * The forecast run persisted by node 3. Carried on the state so the
   * readjustment node and any downstream consumer can cite stored rows.
   */
  forecastRunId: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  /** Retrieved historical chunks, citation-guarded before they enter state. */
  evidence: Annotation<RetrievalEvidence[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  /** SQL-computed forecast reliability — quoted, never calculated by the LLM. */
  calibration: Annotation<CalibrationSlice | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  /**
   * Macro and governance risk for the mandate's subject, derived deterministically
   * before synthesis so the model conditions on risk it was *given* rather than
   * risk it inferred. Null when no risk snapshot was available, which the prompt
   * states explicitly instead of substituting a default.
   */
  riskProfile: Annotation<RiskContext | null>({
    reducer: (_a, b) => b,
    default: () => null,
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
