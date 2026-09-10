/**
 * Query catalog — every GraphQL query the package can send, as templates.
 * Import and re-export here so consumers (extractors, CLI, tests) have one
 * module to enumerate the full surface.
 */

export * from './fno/schemas.js';
export { fnoProtocolSnapshot, fnoFunding } from './fno/protocolSnapshot.js';
export { fnoOpenPositions, fnoFdvTokens } from './fno/openPositions.js';
export { fnoDeltas } from './fno/deltas.js';
export { indexerMeta } from './health/indexerMeta.js';
export {
  AaveReserveSchema,
  lendingAaveV3Reserves,
  lendingAaveV3PoolMetrics,
  lendingProbe,
  lendingAaveV3RiskParams,
} from './lending/aaveV3Reserves.js';
export {
  UniswapV3PoolSchema,
  dexUniswapV3Pools,
  dexProbe,
  dexUniswapV3PoolsByVolume,
  dexUniswapV3Metrics,
} from './dex/uniswapV3Pools.js';
export * from './dex/uniswapV4Schemas.js';
export {
  V4_POOL_MANAGER_ID,
  V4_ZERO_HOOK,
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
} from './dex/uniswapV4.js';
export { RedemptionSchema, predictionPolymarketProbe, predictionPolymarketActivity } from './prediction/polymarket.js';
