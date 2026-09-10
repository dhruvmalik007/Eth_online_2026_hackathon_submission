import { z } from 'zod';
import { defineQuery } from '../../query/QueryDefinition.js';
import { ZodAddress, ZodBytes32 } from '../../query/scalars.js';
import {
  V4PoolManagerSchema,
  V4PoolSchema,
  V4PoolSummarySchema,
  V4PoolHourDataSchema,
  V4PoolDayDataSchema,
  V4TokenHourDataSchema,
  V4SwapSchema,
  V4PositionSchema,
} from './uniswapV4Schemas.js';

/**
 * Uniswap v4 query templates. Entity/field names follow the official v4
 * schema exactly. Key v4 differences from v3:
 * - poolManager replaces factory (global metrics)
 * - Pool IDs are bytes32 hashes of the pool key, not contract addresses
 * - Hooks are first-class (pool.hooks field)
 * - feeTier 8388608 (0x800000) is the dynamic-fee flag set by hooks at runtime
 */

export const V4_POOL_MANAGER_ID = '0x000000000004444c5dc75cb358380d2e3de08a90';

const ZERO_HOOK = '0x0000000000000000000000000000000000000000';

/** Protocol-wide metrics from the canonical v4 PoolManager. */
export const dexV4PoolManager = defineQuery({
  id: 'the-graph.dex.v4PoolManager',
  operationName: 'PoolManager',
  sdl: `
    query PoolManager($manager: Bytes!) {
      poolManager(id: $manager) {
        id
        poolCount
        txCount
        totalVolumeUSD
        totalVolumeETH
        totalFeesUSD
        totalValueLockedUSD
        totalValueLockedETH
        owner
      }
    }
  `,
  variables: z.object({ manager: ZodAddress }),
  response: z.object({ poolManager: V4PoolManagerSchema.nullable() }),
});

/** Full pool state by bytes32 pool ID (hash of the pool key). */
export const dexV4PoolState = defineQuery({
  id: 'the-graph.dex.v4PoolState',
  operationName: 'PoolState',
  sdl: `
    query PoolState($pool: Bytes!) {
      pool(id: $pool) {
        id
        createdAtTimestamp
        token0 { id symbol name decimals }
        token1 { id symbol name decimals }
        feeTier
        tickSpacing
        hooks
        liquidity
        sqrtPrice
        token0Price
        token1Price
        tick
        volumeToken0
        volumeToken1
        volumeUSD
        feesUSD
        txCount
        totalValueLockedToken0
        totalValueLockedToken1
        totalValueLockedUSD
        liquidityProviderCount
      }
    }
  `,
  variables: z.object({ pool: ZodBytes32 }),
  response: z.object({ pool: V4PoolSchema.nullable() }),
});

/**
 * Top pools ordered by cumulative volumeUSD — NOT TVL.
 * TVL ordering surfaces vault-receipt pools (ETH/1xETH-style with near-zero
 * trading and inflated accounting TVL); volume ordering surfaces the real
 * venues (ETH/USDC, ETH/USDT, USDC/USDT with $B-scale cumulative volume).
 */
export const dexV4TopPools = defineQuery({
  id: 'the-graph.dex.v4TopPools',
  operationName: 'TopPools',
  sdl: `
    query TopPools($first: Int!, $skip: Int!) {
      pools(first: $first, skip: $skip, orderBy: volumeUSD, orderDirection: desc) {
        id
        feeTier
        tickSpacing
        hooks
        liquidity
        token0 { id symbol decimals }
        token1 { id symbol decimals }
        totalValueLockedUSD
        volumeUSD
        txCount
      }
    }
  `,
  variables: z.object({
    first: z.number().int().positive().max(1000),
    skip: z.number().int().nonnegative(),
  }),
  response: z.object({ pools: z.array(V4PoolSummarySchema) }),
});

/**
 * Pools with a non-zero hooks address, ordered by cumulative volumeUSD.
 * The v4 PoolManager stores the hook contract in the pool key; feeTier
 * 8388608 (0x800000) means the hook sets the fee at runtime.
 */
export const dexV4HookedPools = defineQuery({
  id: 'the-graph.dex.v4HookedPools',
  operationName: 'HookedPools',
  sdl: `
    query HookedPools($first: Int!, $skip: Int!, $zeroHook: Bytes!) {
      pools(
        first: $first
        skip: $skip
        orderBy: volumeUSD
        orderDirection: desc
        where: { hooks_not: $zeroHook }
      ) {
        id
        feeTier
        hooks
        liquidity
        token0 { id symbol decimals }
        token1 { id symbol decimals }
        totalValueLockedUSD
        volumeUSD
        feesUSD
        txCount
      }
    }
  `,
  variables: z.object({
    first: z.number().int().positive().max(1000),
    skip: z.number().int().nonnegative(),
    zeroHook: ZodAddress,
  }),
  response: z.object({ pools: z.array(V4PoolSummarySchema) }),
});

/** Hourly OHLC/TVL/fees series for one pool since a unix timestamp. */
export const dexV4PoolHourData = defineQuery({
  id: 'the-graph.dex.v4PoolHourData',
  operationName: 'PoolHourData',
  sdl: `
    query PoolHourData($pool: Bytes!, $first: Int!, $startUnix: Int!) {
      poolHourDatas(
        first: $first
        orderBy: periodStartUnix
        orderDirection: desc
        where: { pool: $pool, periodStartUnix_gte: $startUnix }
      ) {
        id
        periodStartUnix
        liquidity
        sqrtPrice
        token0Price
        token1Price
        tick
        tvlUSD
        volumeToken0
        volumeToken1
        volumeUSD
        feesUSD
        txCount
        open
        high
        low
        close
      }
    }
  `,
  variables: z.object({
    pool: ZodBytes32,
    first: z.number().int().positive().max(1000),
    startUnix: z.number().int().nonnegative(),
  }),
  response: z.object({ poolHourDatas: z.array(V4PoolHourDataSchema) }),
});

/** Daily aggregated OHLC/TVL/fees series for one pool since a unix date. */
export const dexV4PoolDayData = defineQuery({
  id: 'the-graph.dex.v4PoolDayData',
  operationName: 'PoolDayData',
  sdl: `
    query PoolDayData($pool: Bytes!, $first: Int!, $startDate: Int!) {
      poolDayDatas(
        first: $first
        orderBy: date
        orderDirection: desc
        where: { pool: $pool, date_gte: $startDate }
      ) {
        id
        date
        liquidity
        token0Price
        token1Price
        tvlUSD
        volumeUSD
        feesUSD
        txCount
        open
        high
        low
        close
      }
    }
  `,
  variables: z.object({
    pool: ZodBytes32,
    first: z.number().int().positive().max(1000),
    startDate: z.number().int().nonnegative(),
  }),
  response: z.object({ poolDayDatas: z.array(V4PoolDayDataSchema) }),
});

/** Hourly price/TVL series aggregated across all v4 pools for one token. */
export const dexV4TokenHourData = defineQuery({
  id: 'the-graph.dex.v4TokenHourData',
  operationName: 'TokenHourData',
  sdl: `
    query TokenHourData($token: Bytes!, $first: Int!, $startUnix: Int!) {
      tokenHourDatas(
        first: $first
        orderBy: periodStartUnix
        orderDirection: desc
        where: { token: $token, periodStartUnix_gte: $startUnix }
      ) {
        id
        periodStartUnix
        volume
        volumeUSD
        totalValueLocked
        totalValueLockedUSD
        priceUSD
        feesUSD
        open
        high
        low
        close
      }
    }
  `,
  variables: z.object({
    token: ZodAddress,
    first: z.number().int().positive().max(1000),
    startUnix: z.number().int().nonnegative(),
  }),
  response: z.object({ tokenHourDatas: z.array(V4TokenHourDataSchema) }),
});

/** Recent swap events — pool filter optional (omit for cross-pool feed). */
export const dexV4RecentSwaps = defineQuery({
  id: 'the-graph.dex.v4RecentSwaps',
  operationName: 'RecentSwaps',
  sdl: `
    query RecentSwaps($pool: Bytes, $first: Int!, $skip: Int!) {
      swaps(
        first: $first
        skip: $skip
        orderBy: timestamp
        orderDirection: desc
        where: { pool: $pool }
      ) {
        id
        timestamp
        sender
        origin
        amount0
        amount1
        amountUSD
        sqrtPriceX96
        tick
        pool { id token0 { symbol } token1 { symbol } }
        transaction { id blockNumber gasUsed gasPrice }
      }
    }
  `,
  variables: z.object({
    pool: ZodBytes32.nullable(),
    first: z.number().int().positive().max(1000),
    skip: z.number().int().nonnegative(),
  }),
  response: z.object({ swaps: z.array(V4SwapSchema) }),
});

/** Token details aggregated across all v4 pools. */
export const dexV4TokenData = defineQuery({
  id: 'the-graph.dex.v4TokenData',
  operationName: 'TokenData',
  sdl: `
    query TokenData($token: Bytes!) {
      token(id: $token) {
        id
        symbol
        name
        decimals
        totalSupply
        volume
        volumeUSD
        feesUSD
        txCount
        poolCount
        totalValueLocked
        totalValueLockedUSD
        derivedETH
      }
    }
  `,
  variables: z.object({ token: ZodAddress }),
  response: z.object({
    token: z
      .object({
        id: z.string(),
        symbol: z.string(),
        name: z.string().nullable(),
        decimals: z.string(),
        totalSupply: z.string(),
        volumeUSD: z.string(),
        feesUSD: z.string(),
        txCount: z.string(),
        poolCount: z.string(),
        totalValueLockedUSD: z.string(),
        derivedETH: z.string().nullable(),
      })
      .nullable(),
  }),
});

/** LP position lifecycle by ERC-6909 NFT tokenId. */
export const dexV4Position = defineQuery({
  id: 'the-graph.dex.v4Position',
  operationName: 'PositionData',
  sdl: `
    query PositionData($tokenId: BigInt!) {
      position(id: $tokenId) {
        id
        tokenId
        owner
        origin
        createdAtTimestamp
        subscriptions { id address timestamp }
        unsubscriptions { id address timestamp }
        transfers { id from to timestamp }
      }
    }
  `,
  variables: z.object({ tokenId: z.string() }),
  response: z.object({ position: V4PositionSchema.nullable() }),
});

export { ZERO_HOOK as V4_ZERO_HOOK };
