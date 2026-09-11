import { z } from 'zod';

/**
 * Row schemas for the EMS time-series store. Numeric columns round-trip as
 * strings over pg; validation enforces decimal-string shape so drift fails
 * at the boundary (same discipline as the-graph wire scalars).
 */

const NumericColumn = z
  .union([z.string().regex(/^-?\d+(\.\d+)?$/), z.number(), z.null()])
  .transform((v) => (v === null ? null : Number(v)));

/** Metric catalog — mirrors the columns of `pool_metrics_hourly`. */
export const METRIC_NAMES = ['apy', 'volume', 'tvl', 'utilization'] as const;
export const MetricNameSchema = z.enum(METRIC_NAMES);
export type MetricName = z.infer<typeof MetricNameSchema>;

/** Metric → physical column (the only place that mapping lives). */
export const METRIC_COLUMNS: Readonly<Record<MetricName, string>> = {
  apy: 'apy',
  volume: 'volume_usd',
  tvl: 'tvl_usd',
  utilization: 'utilization',
};

export const PoolMetricRowSchema = z.object({
  poolId: z.string().min(1),
  ts: z.date(),
  protocol: z.string().min(1),
  network: z.string().min(1),
  apy: z.number().nullable().optional(),
  volumeUsd: z.number().nullable().optional(),
  tvlUsd: z.number().nullable().optional(),
  utilization: z.number().nullable().optional(),
  vol: z.number().nullable().optional(),
  txCount: z.number().int().nullable().optional(),
});

export type PoolMetricRow = z.infer<typeof PoolMetricRowSchema>;

/**
 * Narrow wire shape for window reads. `getMetricWindow` projects a single
 * metric column aliased to `value`, so the row carries only what the window
 * needs — validating against the full row schema would demand columns that
 * were never selected.
 */
export const MetricWindowPointWireSchema = z.object({
  pool_id: z.string(),
  ts: z.date(),
  value: NumericColumn.nullable().optional(),
});

export type MetricWindowPointWire = z.infer<typeof MetricWindowPointWireSchema>;

/** Raw pg row shape (snake_case columns, numerics possibly as strings). */
export const PoolMetricWireSchema = z.object({
  pool_id: z.string(),
  ts: z.date(),
  protocol: z.string(),
  network: z.string(),
  apy: NumericColumn.nullable().optional(),
  volume_usd: NumericColumn.nullable().optional(),
  tvl_usd: NumericColumn.nullable().optional(),
  utilization: NumericColumn.nullable().optional(),
  vol: NumericColumn.nullable().optional(),
  tx_count: NumericColumn.nullable().optional(),
});

/** Wire row → the metric value for a single column, null-coalesced away. */
export const METRIC_WIRE_FIELD: Readonly<Record<MetricName, 'apy' | 'volume_usd' | 'tvl_usd' | 'utilization'>> = {
  apy: 'apy',
  volume: 'volume_usd',
  tvl: 'tvl_usd',
  utilization: 'utilization',
};

/** A metric window: the Category B matrix handed to TimesFM-3. */
export interface MetricWindow {
  readonly poolId: string;
  readonly metric: MetricName;
  readonly timestamps: readonly Date[];
  readonly values: readonly number[];
}

/** One time-bucket aggregate. `values` is keyed by the caller's metric aliases. */
export interface TimeBucketPoint {
  readonly bucketStart: Date;
  readonly values: Readonly<Record<string, number>>;
}

// ── Forecast ledger ─────────────────────────────────────────────────────────

/**
 * TimesFM-3 decodes nine quantiles per horizon step. Storing all of them (not
 * just q10/q50/q90) is what makes pinball loss and per-quantile coverage
 * computable later — the evaluation layer depends on the full vector.
 */
export const FORECAST_QUANTILE_COLUMNS = [
  'q10', 'q20', 'q30', 'q40', 'q50', 'q60', 'q70', 'q80', 'q90',
] as const;
export type ForecastQuantileColumn = (typeof FORECAST_QUANTILE_COLUMNS)[number];

/** Nominal levels, aligned by index with FORECAST_QUANTILE_COLUMNS. */
export const FORECAST_QUANTILE_LEVELS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] as const;

export const ForecastQuantilesSchema = z.object({
  q10: z.number(), q20: z.number(), q30: z.number(),
  q40: z.number(), q50: z.number(), q60: z.number(),
  q70: z.number(), q80: z.number(), q90: z.number(),
});

export type ForecastQuantiles = z.infer<typeof ForecastQuantilesSchema>;

/** The q10 ≤ q20 ≤ … ≤ q90 invariant every persisted step must satisfy. */
export function quantilesAreMonotonic(q: ForecastQuantiles): boolean {
  return FORECAST_QUANTILE_COLUMNS.every((column, i) => {
    if (i === 0) return true;
    const previous = q[FORECAST_QUANTILE_COLUMNS[i - 1]!];
    return previous <= q[column];
  });
}

/** One horizon step of a persisted forecast run. */
export const ForecastStepSchema = z.object({
  targetTs: z.date(),
  horizonStep: z.number().int().positive(),
  point: z.number(),
  quantiles: ForecastQuantilesSchema,
});

export type ForecastStep = z.infer<typeof ForecastStepSchema>;

/**
 * An append-only forecast run. `issuedAt` is the hypertable time column
 * (monotonic event time); `targetTs` is the value being predicted and is a
 * plain indexed column, which is what lets calibration be a SQL join.
 */
export const ForecastRunSchema = z.object({
  runId: z.string().uuid(),
  poolId: z.string().min(1),
  metric: MetricNameSchema,
  issuedAt: z.date(),
  modelVersion: z.string().min(1),
  contextHash: z.string().min(1),
  latencyMs: z.number().nonnegative().nullable().optional(),
  steps: z.array(ForecastStepSchema).min(1),
});

export type ForecastRun = z.infer<typeof ForecastRunSchema>;

/** Raw wire row of `ts_forecasts` (one quantile column per level). */
export const ForecastWireSchema = z.object({
  run_id: z.string(),
  issued_at: z.date(),
  target_ts: z.date(),
  pool_id: z.string(),
  metric: z.string(),
  horizon_step: z.coerce.number().int(),
  point: NumericColumn,
  q10: NumericColumn, q20: NumericColumn, q30: NumericColumn,
  q40: NumericColumn, q50: NumericColumn, q60: NumericColumn,
  q70: NumericColumn, q80: NumericColumn, q90: NumericColumn,
  model_version: z.string(),
  context_hash: z.string(),
  latency_ms: NumericColumn.nullable().optional(),
});

export type ForecastWire = z.infer<typeof ForecastWireSchema>;

/** Rebuild the quantile vector from a validated wire row. */
export function quantilesFromWire(row: ForecastWire): ForecastQuantiles {
  return ForecastQuantilesSchema.parse({
    q10: row.q10, q20: row.q20, q30: row.q30,
    q40: row.q40, q50: row.q50, q60: row.q60,
    q70: row.q70, q80: row.q80, q90: row.q90,
  });
}

// ── Decision ledger ─────────────────────────────────────────────────────────

export const DECISION_ACTIONS = [
  'WITHDRAW_LIQUIDITY', 'SUPPLY_CAPITAL', 'DEPOSIT_LSD', 'HOLD',
] as const;
export const DecisionActionSchema = z.enum(DECISION_ACTIONS);
export type DecisionAction = z.infer<typeof DecisionActionSchema>;

export const DecisionRecordSchema = z.object({
  decisionId: z.string().uuid(),
  decidedAt: z.date(),
  poolId: z.string().min(1),
  action: DecisionActionSchema,
  sizeUsd: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  /** Forecast rows this decision was grounded in — the audit trail. */
  citedForecastIds: z.array(z.string().min(1)),
  citedMetricIds: z.array(z.string().min(1)),
  rationale: z.string().min(1),
  stateSnapshot: z.json(),
  modelVersions: z.record(z.string(), z.string()),
});

export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;

// ── Evaluation layer ────────────────────────────────────────────────────────

/** One scored forecast step: forecast joined to the realized observation. */
export const CalibrationRowSchema = z.object({
  runId: z.string(),
  poolId: z.string(),
  metric: z.string(),
  targetTs: z.date(),
  horizonStep: z.number().int(),
  forecastQ10: z.number(),
  forecastQ50: z.number(),
  forecastQ90: z.number(),
  actual: z.number(),
  signedError: z.number(),
  absoluteError: z.number(),
  /** Pinball loss of the median quantile (level 0.5). */
  pinballLoss: z.number(),
  /** True when the realized value fell inside the q10–q90 band. */
  covered: z.boolean(),
  modelVersion: z.string(),
});

export type CalibrationRow = z.infer<typeof CalibrationRowSchema>;

/** Realized yield over a time bucket — the performance reference series. */
export const RealizedYieldRowSchema = z.object({
  poolId: z.string(),
  bucketStart: z.date(),
  avgApy: z.number(),
  minApy: z.number(),
  maxApy: z.number(),
  avgTvl: z.number().nullable(),
  samples: z.number().int(),
});

export type RealizedYieldRow = z.infer<typeof RealizedYieldRowSchema>;

/** A past decision scored against the yield that actually materialized. */
export const DecisionOutcomeRowSchema = z.object({
  decisionId: z.string(),
  poolId: z.string(),
  action: z.string(),
  sizeUsd: z.number(),
  decidedAt: z.date(),
  horizonEnd: z.date(),
  realizedApy: z.number(),
  baselineApy: z.number().nullable(),
  /** realized − baseline; positive means the call beat holding. */
  outcomeScore: z.number().nullable(),
});

export type DecisionOutcomeRow = z.infer<typeof DecisionOutcomeRowSchema>;

/** Aggregate calibration summary (coverage + mean pinball loss). */
export const CalibrationSummarySchema = z.object({
  poolId: z.string(),
  metric: z.string(),
  samples: z.number().int(),
  coverage: z.number(),
  meanPinballLoss: z.number(),
  meanAbsoluteError: z.number(),
  meanAbsolutePercentageError: z.number().nullable(),
});

export type CalibrationSummary = z.infer<typeof CalibrationSummarySchema>;

// ── Temporal vector layer ───────────────────────────────────────────────────

/**
 * What kind of real-world object an embedding chunk was serialized from.
 *
 * The first four are the pool-metric families the forecast pipeline produces. The
 * last four are contributed by the risk-data pipeline: governance proposals,
 * security incidents, chain risk profiles and market-maker profiles. Widening
 * this list requires a migration, because `ts_embeddings.kind` carries a CHECK
 * constraint — `embeddingKindCheckStatements` rewrites it.
 */
export const EMBEDDING_KINDS = [
  'metric_window',
  'forecast_run',
  'decision',
  'performance_slice',
  'governance_proposal',
  'security_incident',
  'chain_risk',
  'market_maker',
] as const;
export const EmbeddingKindSchema = z.enum(EMBEDDING_KINDS);
export type EmbeddingKind = z.infer<typeof EmbeddingKindSchema>;

export const EMBEDDING_DIMENSION = 768;

// ── Risk-data history ────────────────────────────────────────────────────────
//
// Temporal rows contributed by `@ethonline2026/risk-analysis-data-pipeline`. The
// *current* risk snapshot lives in GCS; these shapes carry its history, which is
// what a TimesFM-3 covariate needs.
//
// Each carries `raw` alongside the parsed columns, applying the same
// retain-the-source rule the scraper uses: a classifier change stays auditable
// against what the upstream published at that instant.

/** A point on a chain's risk profile timeline. */
export const ChainRiskHistoryRowSchema = z.object({
  /** Observation instant. */
  ts: z.date(),
  chainSlug: z.string().min(1),
  stage: z.string().min(1),
  stateValidation: z.string().min(1),
  dataAvailability: z.string().min(1),
  exitWindow: z.string().min(1),
  sequencerFailure: z.string().min(1),
  proposerFailure: z.string().min(1),
  challengePeriodDays: z.number().nullable(),
  exitWindowDays: z.number().nullable(),
  sequencerDelayHours: z.number().nullable(),
  valueSecuredUsd: z.number().nullable(),
  compositeScore: z.number().min(0).max(1),
  /** Verbatim dimension strings, for audit. */
  raw: z.record(z.string(), z.json()),
});
export type ChainRiskHistoryRow = z.infer<typeof ChainRiskHistoryRowSchema>;

/** A point on a protocol's governance timeline. */
export const ProtocolGovernanceHistoryRowSchema = z.object({
  observedAt: z.date(),
  protocolSlug: z.string().min(1),
  proposalCount: z.number().int().nonnegative(),
  openCount: z.number().int().nonnegative(),
  recentCount: z.number().int().nonnegative(),
  riskProposalCount: z.number().int().nonnegative(),
  activityScore: z.number().min(0).max(1),
  participationScore: z.number().min(0).max(1),
  riskActivityScore: z.number().min(0).max(1),
  compositeScore: z.number().min(0).max(1),
  raw: z.record(z.string(), z.json()),
});
export type ProtocolGovernanceHistoryRow = z.infer<typeof ProtocolGovernanceHistoryRowSchema>;

/** A point on a market maker's metrics timeline. */
export const MarketMakerMetricsRowSchema = z.object({
  ts: z.date(),
  marketMaker: z.string().min(1),
  grade: z.string().min(1),
  compositeScore: z.number(),
  rank: z.number().int().nullable(),
  depthUsd: z.number().nullable(),
  spreadPct: z.number().nullable(),
  volumeUsd: z.number().nullable(),
  tradingKpis: z.number().nullable(),
  trust: z.number().nullable(),
  coverageCapabilities: z.number().nullable(),
  uptime: z.number().nullable(),
  integrationLevel: z.number().nullable(),
  activeEngagements: z.number().int().nullable(),
  fdvUsd: z.number().nullable(),
  raw: z.record(z.string(), z.json()),
});
export type MarketMakerMetricsRow = z.infer<typeof MarketMakerMetricsRowSchema>;

/** Which kind of entity an incident concerns. */
export const INCIDENT_SUBJECT_KINDS = ['chain', 'protocol', 'market_maker'] as const;
export const IncidentSubjectKindSchema = z.enum(INCIDENT_SUBJECT_KINDS);
export type IncidentSubjectKind = z.infer<typeof IncidentSubjectKindSchema>;

/** How severe an incident was judged to be. */
export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const IncidentSeveritySchema = z.enum(INCIDENT_SEVERITIES);
export type IncidentSeverity = z.infer<typeof IncidentSeveritySchema>;

/**
 * A security incident on a chain, protocol or market maker.
 *
 * Modelled and storable now, but **no collector populates it yet**: the incident
 * feed is an open question in the plan (whether to scrape DeFiLlama's hacks
 * endpoint or take it out of v0.1 scope). The table exists so the schema is
 * complete and a collector can be added without a migration.
 */
export const SecurityIncidentRowSchema = z.object({
  occurredAt: z.date(),
  incidentId: z.string().min(1),
  subject: z.string().min(1),
  subjectKind: IncidentSubjectKindSchema,
  incidentKind: z.string().min(1),
  severity: IncidentSeveritySchema,
  amountUsd: z.number().nullable(),
  summary: z.string().min(1),
  sourceUrl: z.string().nullable(),
  raw: z.record(z.string(), z.json()),
});
export type SecurityIncidentRow = z.infer<typeof SecurityIncidentRowSchema>;

/** The four risk history table names, for manifest/verification reporting. */
export const RISK_HISTORY_TABLES = [
  'chain_risk_history',
  'protocol_governance_history',
  'market_maker_metrics',
  'security_incidents',
] as const;
export type RiskHistoryTable = (typeof RISK_HISTORY_TABLES)[number];

/** A row of `ts_embeddings` — a citation-tagged chunk of *real* data. */
export const EmbeddingRowSchema = z.object({
  id: z.string().uuid(),
  tsStart: z.date(),
  tsEnd: z.date(),
  poolId: z.string().min(1),
  kind: EmbeddingKindSchema,
  /** Ids of the metric/forecast/decision rows this text was rendered from. */
  sourceIds: z.array(z.string().min(1)).min(1),
  content: z.string().min(1),
  embedding: z.array(z.number()).length(EMBEDDING_DIMENSION),
  model: z.string().min(1),
  /** sha256 of (kind|poolId|tsStart|tsEnd|content) — makes upserts idempotent. */
  contentHash: z.string().min(1),
});

export type EmbeddingRow = z.infer<typeof EmbeddingRowSchema>;

/** A retrieval result: the row plus its cosine similarity. */
export const RetrievalHitSchema = z.object({
  id: z.string().uuid(),
  poolId: z.string(),
  kind: EmbeddingKindSchema,
  tsStart: z.date(),
  tsEnd: z.date(),
  sourceIds: z.array(z.string()),
  content: z.string(),
  score: z.number(),
});

export type RetrievalHit = z.infer<typeof RetrievalHitSchema>;

// ── Backtest runs (unchanged, still written by the strategy pipeline) ───────

export const BacktestRunSchema = z.object({
  poolId: z.string().min(1),
  windowDays: z.number().int().positive(),
  strategy: z.string().min(1),
  hitRate: z.number().nullable().optional(),
  mape: z.number().nullable().optional(),
  pnlVsHodl: z.number().nullable().optional(),
});

export type BacktestRun = z.infer<typeof BacktestRunSchema>;

// ── Capability probe ────────────────────────────────────────────────────────

export const PROBED_EXTENSIONS = ['timescaledb', 'vector', 'vectorscale', 'pg_textsearch'] as const;
export const ProbedExtensionSchema = z.enum(PROBED_EXTENSIONS);
export type ProbedExtension = z.infer<typeof ProbedExtensionSchema>;

/**
 * What the connected server actually offers. Recorded by `migrate()` so
 * features degrade from evidence rather than assumption.
 */
export const CapabilityReportSchema = z.object({
  /** extension name → installed version, for extensions present. */
  installed: z.record(z.string(), z.string()),
  /** extension name → version available to install. */
  available: z.record(z.string(), z.string()),
  postgresVersion: z.string(),
  timescaleVersion: z.string().nullable(),
  vectorEnabled: z.boolean(),
  vectorscaleEnabled: z.boolean(),
});

export type CapabilityReport = z.infer<typeof CapabilityReportSchema>;

export class VectorUnavailableError extends Error {
  constructor(detail: string) {
    super(
      `Temporal vector layer unavailable: ${detail}. Install the 'vector' extension ` +
        '(and optionally \'vectorscale\') or use a Tiger Cloud plan that provides it.',
    );
    this.name = 'VectorUnavailableError';
  }
}
