import { z } from 'zod';

/**
 * Canonical zod schemas for the official Uniswap v4 subgraph entities.
 * Field names mirror https://github.com/Uniswap/v4-subgraph/blob/main/schema.graphql
 * exactly. Moved here from packages/langchain so every consumer validates
 * against one definition.
 */

export const V4TokenRefSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string().optional(),
  decimals: z.union([z.string(), z.number()]).optional(),
});

export const V4PoolManagerSchema = z.object({
  id: z.string(),
  poolCount: z.string(),
  txCount: z.string(),
  totalVolumeUSD: z.string(),
  totalVolumeETH: z.string().optional(),
  totalFeesUSD: z.string().optional(),
  totalValueLockedUSD: z.string(),
  totalValueLockedETH: z.string().optional(),
  owner: z.string().optional(),
});

export const V4PoolSchema = z.object({
  id: z.string(),
  createdAtTimestamp: z.string().optional(),
  token0: V4TokenRefSchema,
  token1: V4TokenRefSchema,
  feeTier: z.string(),
  tickSpacing: z.string().optional(),
  hooks: z.string(),
  liquidity: z.string(),
  sqrtPrice: z.string(),
  token0Price: z.string().optional(),
  token1Price: z.string().optional(),
  tick: z.string().optional(),
  volumeToken0: z.string().optional(),
  volumeToken1: z.string().optional(),
  volumeUSD: z.string().optional(),
  feesUSD: z.string().optional(),
  txCount: z.string().optional(),
  totalValueLockedToken0: z.string().optional(),
  totalValueLockedToken1: z.string().optional(),
  totalValueLockedUSD: z.string().optional(),
  liquidityProviderCount: z.string().optional(),
});

export const V4PoolSummarySchema = z.object({
  id: z.string(),
  feeTier: z.string(),
  tickSpacing: z.string().optional(),
  hooks: z.string(),
  liquidity: z.string(),
  token0: V4TokenRefSchema,
  token1: V4TokenRefSchema,
  totalValueLockedUSD: z.string().optional(),
  volumeUSD: z.string().optional(),
  feesUSD: z.string().optional(),
  txCount: z.string().optional(),
});

export const V4PoolHourDataSchema = z.object({
  id: z.string(),
  periodStartUnix: z.number(),
  liquidity: z.string(),
  sqrtPrice: z.string(),
  token0Price: z.string().optional(),
  token1Price: z.string().optional(),
  tick: z.string().optional(),
  tvlUSD: z.string().optional(),
  volumeToken0: z.string().optional(),
  volumeToken1: z.string().optional(),
  volumeUSD: z.string().optional(),
  feesUSD: z.string().optional(),
  txCount: z.string().optional(),
  open: z.string().optional(),
  high: z.string().optional(),
  low: z.string().optional(),
  close: z.string().optional(),
});

export const V4PoolDayDataSchema = z.object({
  id: z.string(),
  date: z.number(),
  liquidity: z.string(),
  token0Price: z.string().optional(),
  token1Price: z.string().optional(),
  tvlUSD: z.string().optional(),
  volumeUSD: z.string().optional(),
  feesUSD: z.string().optional(),
  txCount: z.string().optional(),
  open: z.string().optional(),
  high: z.string().optional(),
  low: z.string().optional(),
  close: z.string().optional(),
});

export const V4TokenHourDataSchema = z.object({
  id: z.string(),
  periodStartUnix: z.number(),
  volume: z.string().optional(),
  volumeUSD: z.string().optional(),
  totalValueLocked: z.string().optional(),
  totalValueLockedUSD: z.string().optional(),
  priceUSD: z.string().optional(),
  feesUSD: z.string().optional(),
  open: z.string().optional(),
  high: z.string().optional(),
  low: z.string().optional(),
  close: z.string().optional(),
});

export const V4SwapSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  sender: z.string(),
  origin: z.string(),
  amount0: z.string(),
  amount1: z.string(),
  amountUSD: z.string().optional(),
  sqrtPriceX96: z.string().optional(),
  tick: z.string().optional(),
  pool: z
    .object({
      id: z.string(),
      token0: z.object({ symbol: z.string() }),
      token1: z.object({ symbol: z.string() }),
    })
    .optional(),
  transaction: z
    .object({
      id: z.string(),
      blockNumber: z.string(),
      gasUsed: z.string().optional(),
      gasPrice: z.string().optional(),
    })
    .optional(),
});

export const V4PositionSchema = z.object({
  id: z.string(),
  tokenId: z.string(),
  owner: z.string().optional(),
  origin: z.string().optional(),
  createdAtTimestamp: z.string().optional(),
  subscriptions: z
    .array(z.object({ id: z.string(), address: z.string().optional(), timestamp: z.string().optional() }))
    .optional(),
  unsubscriptions: z
    .array(z.object({ id: z.string(), address: z.string().optional(), timestamp: z.string().optional() }))
    .optional(),
  transfers: z
    .array(z.object({ id: z.string(), from: z.string(), to: z.string(), timestamp: z.string().optional() }))
    .optional(),
});

export type V4TokenRef = z.infer<typeof V4TokenRefSchema>;
export type V4PoolManager = z.infer<typeof V4PoolManagerSchema>;
export type V4Pool = z.infer<typeof V4PoolSchema>;
export type V4PoolSummary = z.infer<typeof V4PoolSummarySchema>;
export type V4PoolHourData = z.infer<typeof V4PoolHourDataSchema>;
export type V4PoolDayData = z.infer<typeof V4PoolDayDataSchema>;
export type V4TokenHourData = z.infer<typeof V4TokenHourDataSchema>;
export type V4Swap = z.infer<typeof V4SwapSchema>;
export type V4Position = z.infer<typeof V4PositionSchema>;
