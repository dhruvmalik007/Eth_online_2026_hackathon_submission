/**
 * @ethonline2026/timeseries
 *
 * TimescaleDB store for the Agentic EMS: pool-metric hypertables, the
 * TimesFM-3 forecast ledger, the decision audit trail, SQL-computed
 * performance evaluation, and a temporal vector index for agent retrieval.
 *
 * Layering: this package owns all storage I/O and exposes typed repositories
 * over an injectable `SqlRunner` port. `@ethonline2026/langchain-agent` wires
 * these in as thin tool adapters — it never issues SQL itself.
 */

// ─── Transport ────────────────────────────────────────────────────────────────

export {
  PgSqlRunner,
  TimeseriesRunnerError,
  TimeseriesEnvSchema,
  TIMESERIES_DEFAULT_ENV_KEYS,
  loadTimeseriesEnv,
  resolveConnectionSpec,
  resolveSsl,
  stripSslParams,
  isLocalHost,
  toPoolConfig,
  closeAllPools,
  type SqlRunner,
  type TimeseriesEnv,
  type PgConnectionSpec,
  type SslSetting,
} from './runner.js';

// ─── Migration ────────────────────────────────────────────────────────────────

export {
  migrate,
  probeCapabilities,
  assertVectorLayer,
  splitStatements,
  embeddingIndexStatements,
  DEFAULT_DECISION_HORIZON,
  type MigrateOptions,
  type MigrationReport,
  type VectorMode,
} from './migrate.js';

// ─── Metric store ─────────────────────────────────────────────────────────────

export { TimeseriesClient, type StoreCoverage } from './client.js';

// ─── Ledgers ──────────────────────────────────────────────────────────────────

export {
  ForecastRepository,
  ForecastValidationError,
  type LatestForecast,
  type ForecastRunSummary,
} from './forecasts.js';

export { DecisionRepository } from './decisions.js';

export { PerformanceRepository } from './performance.js';

// ─── Temporal vector layer ────────────────────────────────────────────────────

export {
  VectorRepository,
  type TemporalSearchInput,
  type VectorUpsertResult,
} from './vector.js';

export {
  VertexEmbeddingService,
  EmbeddingError,
  type EmbeddingService,
  type EmbeddingTask,
  type VertexEmbeddingOptions,
} from './embeddings.js';

export {
  serializeMetricWindow,
  serializeForecastRun,
  serializeDecision,
  serializePerformanceSlice,
  hashChunk,
  formatNumber,
  metricPointId,
  forecastStepId,
  type SerializedChunk,
  type MetricPoint,
} from './serializer.js';

// ─── Schemas and types ────────────────────────────────────────────────────────

export {
  // metric store
  PoolMetricRowSchema,
  PoolMetricWireSchema,
  MetricWindowPointWireSchema,
  MetricNameSchema,
  METRIC_NAMES,
  METRIC_COLUMNS,
  METRIC_WIRE_FIELD,
  type PoolMetricRow,
  type MetricName,
  type MetricWindow,
  type TimeBucketPoint,
  // forecast ledger
  ForecastRunSchema,
  ForecastStepSchema,
  ForecastQuantilesSchema,
  ForecastWireSchema,
  FORECAST_QUANTILE_COLUMNS,
  FORECAST_QUANTILE_LEVELS,
  quantilesAreMonotonic,
  quantilesFromWire,
  type ForecastRun,
  type ForecastStep,
  type ForecastQuantiles,
  type ForecastQuantileColumn,
  type ForecastWire,
  // decision ledger
  DecisionRecordSchema,
  DecisionActionSchema,
  DECISION_ACTIONS,
  type DecisionRecord,
  type DecisionAction,
  // evaluation
  CalibrationRowSchema,
  CalibrationSummarySchema,
  RealizedYieldRowSchema,
  DecisionOutcomeRowSchema,
  type CalibrationRow,
  type CalibrationSummary,
  type RealizedYieldRow,
  type DecisionOutcomeRow,
  // vector layer
  EmbeddingRowSchema,
  EmbeddingKindSchema,
  RetrievalHitSchema,
  EMBEDDING_KINDS,
  EMBEDDING_DIMENSION,
  type EmbeddingRow,
  type EmbeddingKind,
  type RetrievalHit,
  // capabilities
  CapabilityReportSchema,
  PROBED_EXTENSIONS,
  VectorUnavailableError,
  type CapabilityReport,
  type ProbedExtension,
  // backtests
  BacktestRunSchema,
  type BacktestRun,
} from './types.js';

// ─── Wire coercion helpers (shared by adapters) ───────────────────────────────

export { asNumber, asDate, asString, asStringArray, asJsonObject } from './wire.js';
