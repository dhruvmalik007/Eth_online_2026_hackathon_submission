export { SubgraphClient } from './clients/SubgraphClient.js';
export type { SubgraphHealth } from './clients/SubgraphClient.js';
export {
  GraphQLClientTransport,
  SubgraphTransportError,
  type SubgraphTransport,
  type RequestOptions,
} from './clients/SubgraphTransport.js';
export { SubgraphRegistry } from './registry/SubgraphRegistry.js';
export { ProtocolRegistry } from './registry/ProtocolRegistry.js';
export type { ProtocolSource, ProtocolCategory } from './registry/ProtocolRegistry.js';
export { FnoDataExtractor } from './fno/FnoDataExtractor.js';
export type {
  ProtocolSnapshot,
  FundingSnapshot,
  PositionRow,
  TokenFdvRow,
  DeltaRow,
  FnoView,
} from './fno/FnoDataExtractor.js';
export { WalletSigner } from './wallet/WalletSigner.js';
export type { WalletSession } from './wallet/WalletSigner.js';
export * from './config/index.js';

// ─── Templated GraphQL query core ─────────────────────────────────────────────

export {
  defineQuery,
  validateDefinition,
  QueryDefinitionError,
  EveryVariableDeclaredError,
  type QueryDefinition,
  type AnyQueryDefinition,
  type DefinedQuery,
  type PaginationSpec,
} from './query/QueryDefinition.js';
export { QueryRegistry } from './query/QueryRegistry.js';
export type { VarsOf, DataOf } from './clients/SubgraphClient.js';
export { SubgraphValidationError } from './clients/SubgraphClient.js';

// ─── Query catalog (single source of truth for every GraphQL query) ──────────

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
  lendingAaveV3RiskParams,
  dexUniswapV3Pools,
  dexProbe,
  dexUniswapV3PoolsByVolume,
  dexUniswapV3Metrics,
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
  predictionPolymarketActivity,
  V4_POOL_MANAGER_ID,
  V4_ZERO_HOOK,
} from './queries/index.js';

export {
  FinancialMetricSchema,
  ProtocolSnapshotSchema,
  HourlySnapshotSchema,
  FundingSnapshotSchema,
  PositionRowSchema,
  TokenFdvRowSchema,
  DeltaRowSchema,
  FinancialMetric,
  HourlySnapshot,
} from './queries/fno/schemas.js';
export { AaveReserveSchema, type AaveReserve } from './queries/lending/aaveV3Reserves.js';
export { UniswapV3PoolSchema, type UniswapV3Pool } from './queries/dex/uniswapV3Pools.js';
export {
  V4TokenRefSchema,
  V4PoolManagerSchema,
  V4PoolSchema,
  V4PoolSummarySchema,
  V4PoolHourDataSchema,
  V4PoolDayDataSchema,
  V4TokenHourDataSchema,
  V4SwapSchema,
  V4PositionSchema,
  V4TokenRef,
  V4PoolManager,
  V4Pool,
  V4PoolSummary,
  V4PoolHourData,
  V4PoolDayData,
  V4TokenHourData,
  V4Swap,
  V4Position,
} from './queries/dex/uniswapV4Schemas.js';
export { RedemptionSchema, type Redemption } from './queries/prediction/polymarket.js';

// ─── Response types derived from the templates (never hand-written) ──────────

import type { ZodType, z } from 'zod';

type ResponseOf<Q> = Q extends { response: ZodType }
  ? z.output<Q['response']>
  : never;

import type {
  fnoProtocolSnapshot,
  fnoFunding,
  fnoOpenPositions,
  fnoFdvTokens,
  fnoDeltas,
  indexerMeta,
  lendingAaveV3Reserves,
  lendingAaveV3RiskParams,
  dexUniswapV3Pools,
  dexUniswapV3PoolsByVolume,
  dexUniswapV3Metrics,
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
  predictionPolymarketActivity,
} from './queries/index.js';

export type ProtocolSnapshotResponse = ResponseOf<typeof fnoProtocolSnapshot>;
export type FundingResponse = ResponseOf<typeof fnoFunding>;
export type OpenPositionsResponse = ResponseOf<typeof fnoOpenPositions>;
export type FdvTokensResponse = ResponseOf<typeof fnoFdvTokens>;
export type DeltasResponse = ResponseOf<typeof fnoDeltas>;
export type IndexerMetaResponse = ResponseOf<typeof indexerMeta>;
export type LendingReservesResponse = ResponseOf<typeof lendingAaveV3Reserves>;
export type LendingRiskParamsResponse = ResponseOf<typeof lendingAaveV3RiskParams>;
export type DexV3PoolsResponse = ResponseOf<typeof dexUniswapV3Pools>;
export type DexV3PoolsByVolumeResponse = ResponseOf<typeof dexUniswapV3PoolsByVolume>;
export type DexV3MetricsResponse = ResponseOf<typeof dexUniswapV3Metrics>;
export type V4PoolManagerResponse = ResponseOf<typeof dexV4PoolManager>;
export type V4PoolStateResponse = ResponseOf<typeof dexV4PoolState>;
export type V4TopPoolsResponse = ResponseOf<typeof dexV4TopPools>;
export type V4HookedPoolsResponse = ResponseOf<typeof dexV4HookedPools>;
export type V4PoolHourDataResponse = ResponseOf<typeof dexV4PoolHourData>;
export type V4PoolDayDataResponse = ResponseOf<typeof dexV4PoolDayData>;
export type V4TokenHourDataResponse = ResponseOf<typeof dexV4TokenHourData>;
export type V4RecentSwapsResponse = ResponseOf<typeof dexV4RecentSwaps>;
export type V4TokenDataResponse = ResponseOf<typeof dexV4TokenData>;
export type V4PositionResponse = ResponseOf<typeof dexV4Position>;
export type PolymarketProbeResponse = ResponseOf<typeof predictionPolymarketProbe>;
export type PolymarketActivityResponse = ResponseOf<typeof predictionPolymarketActivity>;
