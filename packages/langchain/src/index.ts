/**
 * @ethonline2026/langchain-agent
 *
 * Agentic inference layer for The Graph protocol data.
 * Bloomberg-style risk analytics (Greeks, VaR, stress tests) via DeepAgents + LangGraph with Vertex AI.
 *
 * Integrates with @ethonline2026/graph-fno-indexer for all data fetching.
 */

// ─── Agents ───────────────────────────────────────────────────────────────────

export { DeepGraphAgent, type DeepGraphAgentConfig } from './agents/DeepGraphAgent.js';
export { LangGraphAgent, type LangGraphAgentConfig } from './agents/LangGraphAgent.js';

// ─── Uniswap v4 ───────────────────────────────────────────────────────────────

export {
  createUniswapV4Tools,
  createV4SubgraphClient,
  v4PoolManagerTool,
  v4PoolStateTool,
  v4TopPoolsTool,
  v4HookedPoolsTool,
  v4PoolHourDataTool,
  v4PoolDayDataTool,
  v4SwapsTool,
  v4TokenDataTool,
  v4PositionTool,
  type UniswapV4ClientOptions,
} from './tools/uniswapv4/UniswapV4Tools.js';

// ─── TimesFM-3 forecast service ───────────────────────────────────────────────

export {
  TimesFM3Client,
  FetchTimesFM3Http,
  TimesFM3HttpError,
  TimesFM3ValidationError,
  backtestForecast,
  type TimesFM3Http,
  type TimesFMForecast,
  type BacktestScore,
} from './services/timesfm3/index.js';

// ─── Config ───────────────────────────────────────────────────────────────────

export { loadEnv, type Env } from './config/env.js';

// ─── Multi-Category DeFi Tools ────────────────────────────────────────────────

export {
  createLendingTools,
  type LendingReserve,
  type LendingMarketSummary,
} from './tools/LendingDataTool.js';

export {
  createDexTools,
  type DexPool,
  type DexMarketSummary,
} from './tools/DexDataTool.js';

export {
  createPredictionTools,
  type PredictionCondition,
  type PredictionMarket,
  type PredictionRedemption,
  type PredictionMarketSummary,
} from './tools/PredictionDataTool.js';

export {
  createFixedIncomeTools,
  type FixedIncomeMetrics,
  type YieldOpportunity,
} from './tools/FixedIncomeStrategyTool.js';

export { v4FixedIncomeStrategyTool } from './tools/V4FixedIncomeStrategyTool.js';

export {
  createAcpTools,
  acpCreateJobTool,
  acpSetProviderTool,
  acpSetBudgetTool,
  acpFundJobTool,
  acpSubmitJobTool,
  acpCompleteJobTool,
  acpRejectJobTool,
  acpClaimRefundTool,
  acpJobStatusTool,
} from './tools/erc8183/AcpTools.js';

export { createArcSettlementTools, bridgeRouteTool } from './tools/arc/ArcSettlementTools.js';
export { bridgeRouteDecision } from './tools/arc/ArcSettlementTools.js';

export {
  createMathTools,
  calcRealizedVolTool,
  calcFeeApyTool,
  calcLvrTool,
  calcNetApyTool,
  calcVegaTool,
  calcEfficiencyRatioTool,
  calcAllocationTool,
} from './tools/mathTools.js';

export {
  realizedVolFromHourlyCloses,
  feeApyFromDayData,
  lvr,
  netApy,
  vega,
  volga,
  efficiencyRatio,
  allocateStrategy,
  type StrategyLeg,
  type StrategyLegResult,
  type StrategyResult,
} from './tools/fixedIncomeMath.js';

// ─── TimescaleDB tools (forecast ledger, evaluation, temporal retrieval) ──────

export {
  createTimeseriesTools,
  type TimeseriesToolDeps,
} from './tools/timeseries/TimeseriesTools.js';

// ─── Risk-profile tools (macro, governance, Black-Scholes/Merton inputs) ──────

export {
  ADJUSTMENT_READING,
  createRiskTools,
  type RiskToolDeps,
} from './tools/risk/RiskProfileTools.js';

// ─── V0.1 agent (5-node LangGraph cycle) ──────────────────────────────────────

export { runV01, buildV01Graph, type V01Deps, type V01Input } from './graph/v01/v01Graph.js';
export { buildV01Deps } from './graph/v01/wiring.js';
export {
  DEFAULT_BASE_RISK_FREE_RATE,
  buildRiskContext,
  riskContextId,
  type BuildRiskContextInput,
  type RiskContextReaders,
} from './graph/v01/riskContext.js';
export {
  V01Annotation,
  YieldProjectionSchema,
  RetrievalEvidenceSchema,
  CalibrationSliceSchema,
  RiskContextSchema,
  type V01State,
  type YieldProjection,
  type RetrievalEvidence,
  type CalibrationSlice,
  type RiskContext,
} from './graph/v01/schemas.js';
export {
  assessRisk,
  unresolvedRiskCitations,
  validateRetrievalEvidence,
  validateRiskContext,
  quantilesMonotonic,
  amountsSumTo100,
  citationsGrounded,
} from './graph/v01/guardrails.js';

// ─── Re-exports from the-graph package ────────────────────────────────────────

export {
  SubgraphRegistry,
  SubgraphClient,
  ProtocolRegistry,
  FnoDataExtractor,
  WalletSigner,
  loadEnv as loadGraphEnv,
} from '@ethonline2026/graph-fno-indexer';

export type {
  ProtocolSnapshot,
  FundingSnapshot,
  PositionRow,
  TokenFdvRow,
  DeltaRow,
  FnoView,
  WalletSession,
  Env as GraphEnv,
  TestnetChain,
} from '@ethonline2026/graph-fno-indexer';

// ─── Re-exports: templated GraphQL query surface ─────────────────────────────

export {
  defineQuery,
  QueryRegistry,
  type QueryDefinition,
  type AnyQueryDefinition,
  type PaginationSpec,
  type VarsOf,
  type DataOf,
  SubgraphValidationError,
  GraphQLClientTransport,
  SubgraphTransportError,
  type SubgraphTransport,
} from '@ethonline2026/graph-fno-indexer';

export {
  fnoProtocolSnapshot,
  fnoFunding,
  fnoOpenPositions,
  fnoFdvTokens,
  fnoDeltas,
  indexerMeta,
  lendingAaveV3Reserves,
  lendingAaveV3PoolMetrics,
  lendingProbe,
  dexUniswapV3Pools,
  dexProbe,
  dexV4PoolManager,
  dexV4PoolState,
  dexV4TopPools,
  dexV4HookedPools,
  dexV4PoolHourData,
  dexV4PoolDayData,
  dexV4TokenHourData,
  dexV4RecentSwaps,
  dexV4TokenData,
  dexV4Position,
  predictionPolymarketProbe,
  V4_POOL_MANAGER_ID,
  V4_ZERO_HOOK,
} from '@ethonline2026/graph-fno-indexer';

export type {
  ProtocolSnapshotResponse,
  FundingResponse,
  OpenPositionsResponse,
  FdvTokensResponse,
  DeltasResponse,
  AaveReserve,
  UniswapV3Pool,
  V4PoolManager,
  V4Pool,
  V4PoolSummary,
  V4PoolHourData,
  V4PoolDayData,
  V4TokenHourData,
  V4Swap,
  V4Position,
  Redemption,
} from '@ethonline2026/graph-fno-indexer';
