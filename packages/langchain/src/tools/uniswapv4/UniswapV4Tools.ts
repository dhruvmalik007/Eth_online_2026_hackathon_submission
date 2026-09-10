import { tool } from '@langchain/core/tools';
import * as z from 'zod';
import { GraphQLClient } from 'graphql-request';
import {
  SubgraphClient,
  GraphQLClientTransport,
} from '@ethonline2026/graph-fno-indexer';
import {
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
  V4_POOL_MANAGER_ID,
  V4_ZERO_HOOK,
} from '@ethonline2026/graph-fno-indexer';

/**
 * LangChain tools for Uniswap v4 subgraph queries.
 * Every query runs through the-graph query templates: variables validated
 * before send, responses validated after receive. No inline SDL lives here.
 */

export interface UniswapV4ClientOptions {
  /** Gateway API key for network-tier queries (mainnet v4 subgraph) */
  readonly gatewayApiKey?: string;
  /** Studio URL override for self-deployed Sepolia instances */
  readonly studioEndpoint?: string;
  /** Subgraph deployment ID (default: official Ethereum mainnet v4) */
  readonly subgraphId?: string;
}

/** Build the v4 subgraph client — gateway (mainnet) or Studio (self-deployed testnet). */
export function createV4SubgraphClient(opts: UniswapV4ClientOptions): SubgraphClient {
  let url: string;

  if (opts.studioEndpoint) {
    // Self-deployed Studio instance (e.g. Sepolia v4 subgraph)
    url = opts.studioEndpoint;
  } else if (opts.gatewayApiKey) {
    // Network-tier via gateway (official mainnet deployments)
    url = `https://gateway.thegraph.com/api/subgraphs/id/${opts.subgraphId}`;
  } else {
    throw new Error(
      'Uniswap v4 subgraph requires either UNISWAP_V4_STUDIO_ENDPOINT (self-deployed Sepolia) ' +
      'or GATEWAY_API_KEY (mainnet gateway access).',
    );
  }

  const graphqlClient = new GraphQLClient(url, {
    headers: opts.gatewayApiKey && !opts.studioEndpoint
      ? { authorization: `Bearer ${opts.gatewayApiKey}` }
      : {},
  });

  return new SubgraphClient(new GraphQLClientTransport(graphqlClient, 'uniswapV4'), 'uniswapV4');
}

/** Format big decimal strings as readable numbers in tool output. */
function fmt(value: string | undefined | null, decimals = 2): number | null {
  if (value === undefined || value === null) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? parseFloat(n.toFixed(decimals)) : null;
}

/** Parse-or-null helper for big-number counters surfaced in tool output. */
function intOrNull(value: string | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  const n = parseInt(value);
  return Number.isFinite(n) ? n : null;
}

// ─── Tool: poolManager (global protocol metrics) ──────────────────────────────

export const v4PoolManagerTool = (client: SubgraphClient) =>
  tool(
    async () => {
      const data = await client.executeTemplate(dexV4PoolManager, { manager: V4_POOL_MANAGER_ID });
      if (!data.poolManager) return JSON.stringify({ error: 'poolManager not found' });

      return JSON.stringify({
        poolCount: parseInt(data.poolManager.poolCount),
        txCount: parseInt(data.poolManager.txCount),
        totalVolumeUSD: fmt(data.poolManager.totalVolumeUSD),
        totalFeesUSD: fmt(data.poolManager.totalFeesUSD),
        totalValueLockedUSD: fmt(data.poolManager.totalValueLockedUSD),
      });
    },
    {
      name: 'v4PoolManager',
      description: 'Uniswap v4 protocol-wide metrics: pool count, transaction count, total volume, fees, and TVL (USD).',
      schema: z.object({}),
    },
  );

// ─── Tool: pool state ──────────────────────────────────────────────────────────

export const v4PoolStateTool = (client: SubgraphClient) =>
  tool(
    async (input: unknown) => {
      const { poolId } = input as { poolId: string };
      const data = await client.executeTemplate(dexV4PoolState, { pool: poolId });
      if (!data.pool) return JSON.stringify({ error: `Pool ${poolId} not found (pool IDs are bytes32 hashes in v4, not addresses)` });

      const p = data.pool;
      return JSON.stringify({
        id: p.id,
        token0: p.token0.symbol,
        token1: p.token1.symbol,
        feeTier: parseInt(p.feeTier) / 10000 + '%',
        hooks: p.hooks,
        liquidity: p.liquidity,
        tick: intOrNull(p.tick),
        priceToken0: fmt(p.token0Price, 8),
        priceToken1: fmt(p.token1Price, 8),
        volumeUSD: fmt(p.volumeUSD),
        feesUSD: fmt(p.feesUSD),
        tvlUSD: fmt(p.totalValueLockedUSD),
        txCount: intOrNull(p.txCount),
        liquidityProviderCount: intOrNull(p.liquidityProviderCount),
      });
    },
    {
      name: 'v4PoolState',
      description: 'Uniswap v4 pool state by pool ID (bytes32 hash): tokens, fee tier, tick, liquidity, prices, volume, TVL, hook address.',
      schema: z.object({
        poolId: z.string().describe('Pool ID as bytes32 hash (v4 pools are identified by hash, not address)'),
      }),
    },
  );

// ─── Tool: top pools ───────────────────────────────────────────────────────────

export const v4TopPoolsTool = (client: SubgraphClient) =>
  tool(
    async (input: unknown) => {
      const { first = 10, skip = 0 } = (input ?? {}) as { first?: number; skip?: number };
      const data = await client.executeTemplate(dexV4TopPools, { first, skip });

      return JSON.stringify({
        count: data.pools.length,
        orderedBy: 'volumeUSD (cumulative) — TVL ordering surfaces vault-receipt pools, volume surfaces real venues',
        pools: data.pools.map((p) => ({
          id: p.id,
          pair: `${p.token0.symbol}/${p.token1.symbol}`,
          feeTier: parseInt(p.feeTier) / 10000 + '%',
          tvlUSD: fmt(p.totalValueLockedUSD),
          volumeUSD: fmt(p.volumeUSD),
          hooks: p.hooks,
          hooked: p.hooks !== V4_ZERO_HOOK,
        })),
      });
    },
    {
      name: 'v4TopPools',
      description: 'Top Uniswap v4 pools by cumulative volume with token pair, fee tier, TVL, and hook addresses. Use these pool IDs for hourly/swap analysis.',
      schema: z.object({
        first: z.number().optional().describe('Number of pools (max 1000, default 10)'),
        skip: z.number().optional().describe('Pagination offset (default 0)'),
      }),
    },
  );

// ─── Tool: hooked pools (v4 hooks are first-class) ─────────────────────────────

export const v4HookedPoolsTool = (client: SubgraphClient) =>
  tool(
    async (input: unknown) => {
      const { first = 10, skip = 0 } = (input ?? {}) as { first?: number; skip?: number };
      const data = await client.executeTemplate(dexV4HookedPools, {
        first,
        skip,
        zeroHook: V4_ZERO_HOOK,
      });

      // Aggregate per-hook stats across the returned page
      const byHook = new Map<string, { pools: number; volumeUSD: number; feesUSD: number }>();
      for (const p of data.pools) {
        const agg = byHook.get(p.hooks) ?? { pools: 0, volumeUSD: 0, feesUSD: 0 };
        agg.pools += 1;
        agg.volumeUSD += parseFloat(p.volumeUSD ?? '0') || 0;
        agg.feesUSD += parseFloat(p.feesUSD ?? '0') || 0;
        byHook.set(p.hooks, agg);
      }

      return JSON.stringify({
        count: data.pools.length,
        dynamicFeeFlag: 8388608,
        note: 'feeTier 8388608 (0x800000) = dynamic fee, set by the hook at runtime',
        pools: data.pools.map((p) => ({
          id: p.id,
          pair: `${p.token0.symbol}/${p.token1.symbol}`,
          feeTier: parseInt(p.feeTier),
          isDynamicFee: parseInt(p.feeTier) === 8388608,
          hook: p.hooks,
          tvlUSD: fmt(p.totalValueLockedUSD),
          volumeUSD: fmt(p.volumeUSD),
          feesUSD: fmt(p.feesUSD),
          txCount: intOrNull(p.txCount),
        })),
        hookLeaderboard: [...byHook.entries()]
          .sort((a, b) => b[1].volumeUSD - a[1].volumeUSD)
          .map(([hook, agg]) => ({
            hook,
            pools: agg.pools,
            volumeUSD: parseFloat(agg.volumeUSD.toFixed(2)),
            feesUSD: parseFloat(agg.feesUSD.toFixed(2)),
          })),
      });
    },
    {
      name: 'v4HookedPools',
      description: 'Uniswap v4 pools with non-zero hooks, ordered by volume. Returns per-pool hook addresses, dynamic-fee flags, and a per-hook volume/fee leaderboard.',
      schema: z.object({
        first: z.number().optional().describe('Number of hooked pools (default 10)'),
        skip: z.number().optional().describe('Pagination offset (default 0)'),
      }),
    },
  );

// ─── Tool: hourly pool data ────────────────────────────────────────────────────

export const v4PoolHourDataTool = (client: SubgraphClient) =>
  tool(
    async (input: unknown) => {
      const { poolId, hours = 24 } = input as { poolId: string; hours?: number };
      const startUnix = Math.floor(Date.now() / 1000) - hours * 3600;

      const data = await client.executeTemplate(dexV4PoolHourData, {
        pool: poolId,
        first: hours,
        startUnix,
      });

      const hours_data = data.poolHourDatas;
      const closes = hours_data.map((h) => fmt(h.close)).filter(Number.isFinite);

      // Simple realized volatility from hourly closes
      let volatility: number | null = null;
      if (closes.length > 2) {
        const rets: number[] = [];
        for (let i = 1; i < closes.length; i++) {
          if (closes[i - 1]! > 0) rets.push(Math.log(closes[i]! / closes[i - 1]!));
        }
        const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
        const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length || 1);
        volatility = Math.sqrt(variance) * Math.sqrt(24 * 365); // annualized
      }

      return JSON.stringify({
        hours: hours_data.length,
        volatilityAnnualized: volatility !== null ? parseFloat(volatility.toFixed(4)) : null,
        series: hours_data.slice(0, 48).map((h) => ({
          timestamp: h.periodStartUnix,
          price: fmt(h.close, 8),
          volumeUSD: fmt(h.volumeUSD),
          feesUSD: fmt(h.feesUSD),
          tvlUSD: fmt(h.tvlUSD),
          txCount: intOrNull(h.txCount),
        })),
      });
    },
    {
      name: 'v4PoolHourData',
      description: 'Hourly OHLC price, volume, fees, and TVL series for a v4 pool. Returns annualized realized volatility computed from hourly closes.',
      schema: z.object({
        poolId: z.string().describe('Pool ID (bytes32 hash)'),
        hours: z.number().optional().describe('Hours of history to fetch (default 24, max ~168 recommended)'),
      }),
    },
  );

// ─── Tool: daily pool data ─────────────────────────────────────────────────────

export const v4PoolDayDataTool = (client: SubgraphClient) =>
  tool(
    async (input: unknown) => {
      const { poolId, days = 10 } = input as { poolId: string; days?: number };
      const startDate = Math.floor(Date.now() / 1000) - days * 86400;

      const data = await client.executeTemplate(dexV4PoolDayData, {
        pool: poolId,
        first: days,
        startDate,
      });

      return JSON.stringify({
        days: data.poolDayDatas.length,
        series: data.poolDayDatas.map((d) => ({
          date: d.date,
          open: fmt(d.open, 8),
          high: fmt(d.high, 8),
          low: fmt(d.low, 8),
          close: fmt(d.close, 8),
          volumeUSD: fmt(d.volumeUSD),
          feesUSD: fmt(d.feesUSD),
          tvlUSD: fmt(d.tvlUSD),
        })),
      });
    },
    {
      name: 'v4PoolDayData',
      description: 'Daily aggregated OHLC, volume, fees, TVL for a v4 pool (PoolDayData entity).',
      schema: z.object({
        poolId: z.string().describe('Pool ID (bytes32 hash)'),
        days: z.number().optional().describe('Days of history (default 10)'),
      }),
    },
  );

// ─── Tool: swaps ───────────────────────────────────────────────────────────────

export const v4SwapsTool = (client: SubgraphClient) =>
  tool(
    async (input: unknown) => {
      const { poolId, first = 50 } = input as { poolId?: string; first?: number };
      const data = await client.executeTemplate(dexV4RecentSwaps, {
        pool: poolId ?? null,
        first,
        skip: 0,
      });

      const swaps = data.swaps;
      let totalVolumeUSD = 0;
      let zeroForOneCount = 0;
      for (const s of swaps) {
        totalVolumeUSD += fmt(s.amountUSD) || 0;
        // amount0 < 0 means token0 flowed out of pool => zeroForOne sell
        if (parseFloat(s.amount0) < 0) zeroForOneCount++;
      }

      return JSON.stringify({
        count: swaps.length,
        totalVolumeUSD: parseFloat(totalVolumeUSD.toFixed(2)),
        zeroForOneRatio: swaps.length > 0 ? parseFloat((zeroForOneCount / swaps.length).toFixed(4)) : null,
        swaps: swaps.slice(0, 25).map((s) => ({
          timestamp: s.timestamp,
          amountUSD: fmt(s.amountUSD),
          token0Delta: fmt(s.amount0, 6),
          token1Delta: fmt(s.amount1, 6),
          sender: s.sender,
          origin: s.origin,
          txHash: s.transaction?.id,
          blockNumber: s.transaction?.blockNumber,
        })),
      });
    },
    {
      name: 'v4Swaps',
      description: 'Recent swap events for a v4 pool (or all pools): amounts, USD value, sender/origin, direction ratio, tx details.',
      schema: z.object({
        poolId: z.string().optional().describe('Pool ID (bytes32 hash). Omit for swaps across all pools.'),
        first: z.number().optional().describe('Number of recent swaps (default 50, max 1000)'),
      }),
    },
  );

// ─── Tool: token data ──────────────────────────────────────────────────────────

export const v4TokenDataTool = (client: SubgraphClient) =>
  tool(
    async (input: unknown) => {
      const { tokenId, hours = 24 } = input as { tokenId: string; hours?: number };
      const startUnix = Math.floor(Date.now() / 1000) - hours * 3600;

      const [tokenRes, hourRes] = await Promise.all([
        client.executeTemplate(dexV4TokenData, { token: tokenId }),
        client.executeTemplate(dexV4TokenHourData, {
          token: tokenId, first: hours, startUnix,
        }),
      ]);

      if (!tokenRes.token) return JSON.stringify({ error: `Token ${tokenId} not found in any v4 pool` });
      const t = tokenRes.token;

      const prices = hourRes.tokenHourDatas.map((h) => fmt(h.close)).filter(Number.isFinite);
      const lastPrice = prices[0] ?? null;

      return JSON.stringify({
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        poolCount: parseInt(t.poolCount),
        volumeUSDAllTime: fmt(t.volumeUSD),
        tvlUSD: fmt(t.totalValueLockedUSD),
        derivedETH: t.derivedETH ? fmt(t.derivedETH, 8) : null,
        priceUSD: lastPrice !== null ? parseFloat(lastPrice.toFixed(8)) : null,
        hourlySeries: hourRes.tokenHourDatas.slice(0, 48).map((h) => ({
          timestamp: h.periodStartUnix,
          priceUSD: fmt(h.close, 8),
          volumeUSD: fmt(h.volumeUSD),
          tvlUSD: fmt(h.totalValueLockedUSD),
        })),
      });
    },
    {
      name: 'v4TokenData',
      description: 'Uniswap v4 token details (symbol, supply, volume, TVL, pool count) plus hourly price/TVL series aggregated across all v4 pools.',
      schema: z.object({
        tokenId: z.string().describe('Token contract address (0x...)'),
        hours: z.number().optional().describe('Hours of hourly price history (default 24)'),
      }),
    },
  );

// ─── Tool: position ────────────────────────────────────────────────────────────

export const v4PositionTool = (client: SubgraphClient) =>
  tool(
    async (input: unknown) => {
      const { tokenId } = input as { tokenId: string };
      const data = await client.executeTemplate(dexV4Position, { tokenId });

      if (!data.position) return JSON.stringify({ error: `Position ${tokenId} not found` });
      const p = data.position;

      return JSON.stringify({
        tokenId: p.tokenId,
        owner: p.owner,
        origin: p.origin,
        createdAt: p.createdAtTimestamp,
        subscriptionCount: p.subscriptions?.length ?? 0,
        transferCount: p.transfers?.length ?? 0,
        recentTransfers: p.transfers?.slice(0, 10).map((t) => ({
          from: t.from,
          to: t.to,
          timestamp: t.timestamp,
        })),
      });
    },
    {
      name: 'v4Position',
      description: 'Uniswap v4 LP position lifecycle by NFT tokenId: owner, origin, hook subscriptions, and transfer history (ERC-6909 positions).',
      schema: z.object({
        tokenId: z.string().describe('Position NFT tokenId'),
      }),
    },
  );

// ─── Factory: all v4 tools ─────────────────────────────────────────────────────

export function createUniswapV4Tools(opts: UniswapV4ClientOptions) {
  const client = createV4SubgraphClient(opts);

  return {
    client,
    tools: [
      v4PoolManagerTool(client),
      v4PoolStateTool(client),
      v4TopPoolsTool(client),
      v4HookedPoolsTool(client),
      v4PoolHourDataTool(client),
      v4PoolDayDataTool(client),
      v4SwapsTool(client),
      v4TokenDataTool(client),
      v4PositionTool(client),
    ],
  };
}

// Re-export for consumers that want the raw client handle
export { V4_POOL_MANAGER_ID };
