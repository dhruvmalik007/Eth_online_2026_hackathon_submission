import { z } from 'zod';
import { defineQuery } from '../../query/QueryDefinition.js';
import {
  ZodAddress,
  ZodBigNumberString,
  ZodNonNegativeBigNumberString,
} from '../../query/scalars.js';

/** Uniswap V3 pool row — ordered by TVL by default. */
export const UniswapV3PoolSchema = z.object({
  id: z.string(),
  token0: z.object({ symbol: z.string(), decimals: z.number() }),
  token1: z.object({ symbol: z.string(), decimals: z.number() }),
  feeTier: z.string(),
  liquidity: ZodBigNumberString,
  sqrtPrice: ZodBigNumberString,
  tick: z.number(),
  totalValueLockedUSD: ZodNonNegativeBigNumberString,
  volumeUSD: ZodNonNegativeBigNumberString,
  feesUSD: ZodNonNegativeBigNumberString,
  txCount: z.string(),
});

export type UniswapV3Pool = z.infer<typeof UniswapV3PoolSchema>;

export const AddressSchema = ZodAddress;

/** Deep pools by TVL — the DEX execution-venue screen. */
export const dexUniswapV3Pools = defineQuery({
  id: 'the-graph.dex.uniswapV3Pools',
  operationName: 'UniswapV3Pools',
  sdl: `
    query UniswapV3Pools($first: Int!) {
      pools(first: $first, orderBy: totalValueLockedUSD, orderDirection: desc) {
        id
        token0 { symbol decimals }
        token1 { symbol decimals }
        feeTier
        liquidity
        sqrtPrice
        tick
        totalValueLockedUSD
        volumeUSD
        feesUSD
        txCount
      }
    }
  `,
  variables: z.object({ first: z.number().int().positive().max(1000) }),
  response: z.object({ pools: z.array(UniswapV3PoolSchema) }),
});

/** Probe variant used by test-data CLI: pair symbols + volume only. */
export const dexProbe = defineQuery({
  id: 'the-graph.dex.probe',
  operationName: 'DexProbe',
  sdl: `
    query DexProbe($first: Int!) {
      _meta { block { number } }
      pools(first: $first) {
        token0 { symbol }
        token1 { symbol }
        totalValueLockedUSD
        volumeUSD
      }
    }
  `,
  variables: z.object({ first: z.number().int().positive().max(100) }),
  response: z.object({
    _meta: z.object({ block: z.object({ number: z.number() }).nullable().optional() }).nullable().optional(),
    pools: z.array(
      z.object({
        token0: z.object({ symbol: z.string() }),
        token1: z.object({ symbol: z.string() }),
        totalValueLockedUSD: ZodNonNegativeBigNumberString,
        volumeUSD: ZodNonNegativeBigNumberString,
      }),
    ),
  }),
});

/**
 * Pools ordered by cumulative volumeUSD — the fee-APY ranking path
 * (volume, not TVL: TVL ordering surfaces vault-receipt pools).
 */
export const dexUniswapV3PoolsByVolume = defineQuery({
  id: 'the-graph.dex.uniswapV3PoolsByVolume',
  operationName: 'UniswapV3PoolsByVolume',
  sdl: `
    query UniswapV3PoolsByVolume($first: Int!) {
      pools(first: $first, orderBy: volumeUSD, orderDirection: desc) {
        id
        token0 { symbol }
        token1 { symbol }
        totalValueLockedUSD
        volumeUSD
        feesUSD
      }
    }
  `,
  variables: z.object({ first: z.number().int().positive().max(1000) }),
  response: z.object({
    pools: z.array(
      z.object({
        id: z.string(),
        token0: z.object({ symbol: z.string() }),
        token1: z.object({ symbol: z.string() }),
        totalValueLockedUSD: ZodNonNegativeBigNumberString,
        volumeUSD: ZodNonNegativeBigNumberString,
        feesUSD: ZodNonNegativeBigNumberString,
      }),
    ),
  }),
});

/** Aggregate metrics variant: _meta block + lean pool rows for rollups. */
export const dexUniswapV3Metrics = defineQuery({
  id: 'the-graph.dex.uniswapV3Metrics',
  operationName: 'UniswapV3Metrics',
  sdl: `
    query UniswapV3Metrics($first: Int!) {
      _meta { block { number } }
      pools(first: $first, orderBy: totalValueLockedUSD, orderDirection: desc) {
        token0 { symbol }
        token1 { symbol }
        totalValueLockedUSD
        volumeUSD
        feesUSD
      }
    }
  `,
  variables: z.object({ first: z.number().int().positive().max(1000) }),
  response: z.object({
    _meta: z.object({ block: z.object({ number: z.number() }).nullable().optional() }).nullable().optional(),
    pools: z.array(
      z.object({
        token0: z.object({ symbol: z.string() }),
        token1: z.object({ symbol: z.string() }),
        totalValueLockedUSD: ZodNonNegativeBigNumberString,
        volumeUSD: ZodNonNegativeBigNumberString,
        feesUSD: ZodNonNegativeBigNumberString,
      }),
    ),
  }),
});
