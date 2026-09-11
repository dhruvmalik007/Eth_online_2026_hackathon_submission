/**
 * `@ethonline2026/risk-analysis-data-pipeline` — public surface.
 *
 * The package collects macro chain risk (L2Beat), protocol governance (Discourse)
 * and market-maker liquidity (DefiLlama) into validated snapshots, keeps their
 * temporal history in TimescaleDB for TimesFM-3 covariates, and derives
 * Black-Scholes/Merton parameters deterministically.
 *
 * Three layers, each with one job:
 *
 *  - **Contract** (`types`, `units`, `errors`) — the shapes and the typed
 *    failures. The Python worker mirrors this contract; a drift test keeps the
 *    two honest.
 *  - **Derivation** (`derive`) — pure functions turning risk records into model
 *    parameters. No I/O, no clock, no model, so results are reproducible.
 *  - **Read path** (`store`, `repository`, `registry`) — the ports and their
 *    adapters. Consumers depend on the ports; the composition root picks the
 *    concrete store.
 *
 * The collection itself is a Python worker (`scraper/`), because Camoufox is a
 * Firefox-based browser and cannot run in a Node serverless function.
 */

// ─── Contract ────────────────────────────────────────────────────────────────

export {
  CHAIN_STAGES,
  MANIFEST_KEY,
  MARKET_MAKER_GRADES,
  PROPOSAL_STAGES,
  PROPOSAL_STATUSES,
  SNAPSHOT_KINDS,
  SOURCE_STATES,
  ChainRiskProfileSchema,
  ChainStageSchema,
  GovernanceScoresSchema,
  GovernanceSourceSchema,
  IsoTimestampSchema,
  ManifestSchema,
  MarketMakerDetailBreakdownsSchema,
  MarketMakerDetailSchema,
  MarketMakerDetailScoresSchema,
  MarketMakerGradeSchema,
  MarketMakerMetricRowSchema,
  MarketMakerMetricsSchema,
  MarketMakerProfileSchema,
  MarketMakerStandingSchema,
  MarketMakerStandingsSchema,
  MarketMakerSubScoresSchema,
  MarketMakerSummarySchema,
  ProposalSchema,
  ProposalStageSchema,
  ProposalStatusSchema,
  ProtocolGovernanceProfileSchema,
  ProvenanceSchema,
  RiskScoreSchema,
  SourceStateSchema,
  snapshotKey,
  type ChainDimensions,
  type ChainRiskProfile,
  type ChainRiskScores,
  type ChainStage,
  type GovernanceScores,
  type GovernanceSource,
  type Manifest,
  type ManifestSource,
  type ManifestTemporal,
  type MarketMakerDetail,
  type MarketMakerDetailBreakdowns,
  type MarketMakerDetailScores,
  type MarketMakerGrade,
  type MarketMakerMetricRow,
  type MarketMakerMetrics,
  type MarketMakerProfile,
  type MarketMakerStanding,
  type MarketMakerStandings,
  type MarketMakerSubScores,
  type MarketMakerSummary,
  type Proposal,
  type ProposalStage,
  type ProposalStatus,
  type ProtocolGovernanceProfile,
  type Provenance,
  type SnapshotKind,
  type SourceState,
} from './types.js';

export {
  ParseError,
  CovariateAlignmentError,
  RiskPipelineError,
  SnapshotContractError,
  SourceError,
  StoreError,
  TemporalWriteError,
  ValidationError,
} from './errors.js';

export {
  bps,
  bpsToRate,
  days,
  pct,
  pctToRate,
  rate,
  rateToPct,
  unbrand,
  usd,
  type Bps,
  type Days,
  type DecimalRate,
  type Pct,
  type Usd,
} from './units.js';

// ─── Derivation ──────────────────────────────────────────────────────────────

export {
  countRiskRelevantProposals,
  isRiskRelevantProposal,
} from './proposals.js';

export {
  COMPOSITE_WEIGHTS,
  FALLBACK_VOLATILITY,
  chainRiskPremium,
  collateralHaircut,
  compositeChainScore,
  deriveRiskAdjustment,
  liquidityScore,
  pdLoad,
  recoverableCollateral,
  volatilityMultiplier,
  type RiskAdjustment,
  type RiskDerivationInput,
  type RiskFactor,
} from './derive.js';

// ─── Registry ────────────────────────────────────────────────────────────────

export {
  PROTOCOL_TRANSPORTS,
  ProtocolTargetSchema,
  ProtocolTransportSchema,
  RosterSchema,
  ChainTargetSchema,
  loadRoster,
  scrapableProtocols,
  type ChainTarget,
  type ProtocolTarget,
  type ProtocolTransport,
  type Roster,
} from './registry.js';

// ─── Storage ─────────────────────────────────────────────────────────────────

export {
  GcsStore,
  LocalDirStore,
  type GcsBucketLike,
  type RiskStore,
  type StoredObject,
} from './store.js';

export {
  RiskProfileRepository,
  type ChainRiskReader,
  type Loaded,
  type MarketMakerReader,
  type ProtocolGovernanceReader,
  type RiskProfileReader,
  type RunManifestReader,
  type SchemaLike,
} from './repository.js';

export {
  DEFAULT_RISK_PREFIX,
  createRiskProfileReader,
  createRiskStore,
  type RiskReaderConfig,
} from './reader.js';

// ─── Temporal history ────────────────────────────────────────────────────────

export {
  EMPTY_TEMPORAL_REPORT,
  chainRowFromProfile,
  governanceRowFromProfile,
  marketMakerRowFromProfile,
  riskHistoryRepository,
  writeRiskHistory,
  type TemporalWriteReport,
  type WriteRiskHistoryInput,
} from './temporal.js';

// ─── Embeddings ──────────────────────────────────────────────────────────────

export {
  chainRiskId,
  hashRiskChunk,
  marketMakerId,
  proposalId,
  serializeChainRisk,
  serializeGovernanceSummary,
  serializeIncident,
  serializeMarketMaker,
  serializeProposal,
  type IncidentInput,
} from './serializer.js';

export {
  buildChunks,
  embedRiskRecords,
  embeddingModelName,
  vectorLayerAvailable,
  type EmbeddingReport,
  type RiskRecordsInput,
} from './embeddings.js';

// ─── TimesFM-3 covariates ────────────────────────────────────────────────────

export {
  DEFAULT_LEADING_FILL,
  alignToGrid,
  assertCovariatesAligned,
  buildPastCovariates,
  cumulativeIncidentSeries,
  emptyCovariateMatrix,
  loadRiskCovariates,
  type CovariateCoverage,
  type CovariateMatrix,
  type CovariatePoint,
  type CovariateSource,
  type LeadingFill,
} from './covariates.js';
