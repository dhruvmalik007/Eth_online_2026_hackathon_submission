import { tool } from '@langchain/core/tools';
import * as z from 'zod';
import {
  ProtocolRegistry,
  loadEnv as loadGraphEnv,
  dexUniswapV3Pools,
  dexUniswapV3PoolsByVolume,
  dexUniswapV3Metrics,
} from '@ethonline2026/graph-fno-indexer';

/**
 * DEX pool data from Uniswap V3 subgraph.
 * All queries run through the-graph query templates — no inline SDL here.
 */

/**
 * DEX pool row (subset view over the-graph UniswapV3Pool schema output).
 */
export type DexPool = {
  readonly id: string;
  readonly token0: { symbol: string; decimals: number };
  readonly token1: { symbol: string; decimals: number };
  readonly feeTier: string;
  readonly totalValueLockedUSD: string;
  readonly volumeUSD: string;
  readonly feesUSD: string;
  readonly txCount: string;
};

/**
 * DEX market summary with computed metrics.
 */
export interface DexMarketSummary {
  readonly protocol: string;
  readonly network: string;
  readonly totalPools: number;
  readonly totalTVL: number;
  readonly totalVolume: number;
  readonly totalFees: number;
  readonly pools: DexPool[];
}

/**
 * Create LangChain tools for DEX data extraction.
 * Wraps ProtocolRegistry to query Uniswap V3 subgraphs.
 */
export function createDexTools() {
  /**
   * Get DEX pools from Uniswap V3 with TVL, volume, and fees.
   */
  const getDexPoolsTool = tool(
    async (input: unknown) => {
      const { network = 'ethereum', first = 10, minTVL = 0 } = input as {
        network?: string;
        first?: number;
        minTVL?: number;
      };

      try {
        const env = loadGraphEnv();
        const registry = ProtocolRegistry.fromEnv(env);
        const source = registry.getSource('uniswap-v3', network);

        if (!source) {
          return JSON.stringify({ error: `Uniswap V3 not configured for network: ${network}` });
        }

        const data = await source.client.executeTemplate(dexUniswapV3Pools, { first });

        const pools: readonly DexPool[] = data.pools;
        let filtered = [...pools];
        if (minTVL > 0) {
          filtered = filtered.filter((p) => Number(p.totalValueLockedUSD) >= minTVL);
        }

        // Compute summary metrics
        let totalTVL = 0;
        let totalVolume = 0;
        let totalFees = 0;

        for (const p of filtered) {
          totalTVL += Number(p.totalValueLockedUSD);
          totalVolume += Number(p.volumeUSD);
          totalFees += Number(p.feesUSD);
        }

        const summary: DexMarketSummary = {
          protocol: 'Uniswap V3',
          network,
          totalPools: filtered.length,
          totalTVL,
          totalVolume,
          totalFees,
          pools: filtered.slice(0, first),
        };

        return JSON.stringify(summary, null, 2);
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'getDexPools',
      description: 'Get DEX pools from Uniswap V3 with TVL, volume, fees, and transaction count',
      schema: z.object({
        network: z.enum(['ethereum']).optional().describe('Network to query (default: ethereum)'),
        first: z.number().optional().describe('Number of pools to return (default: 10)'),
        minTVL: z.number().optional().describe('Minimum TVL filter in USD (default: 0)'),
      }),
    }
  );

  /**
   * Get volume change analysis for DEX pools.
   */
  const getVolumeAnalysisTool = tool(
    async (input: unknown) => {
      const { network = 'ethereum', first = 10 } = input as {
        network?: string;
        first?: number;
      };

      try {
        const env = loadGraphEnv();
        const registry = ProtocolRegistry.fromEnv(env);
        const source = registry.getSource('uniswap-v3', network);

        if (!source) {
          return JSON.stringify({ error: `Uniswap V3 not configured for network: ${network}` });
        }

        // Get current pool data (volume-ordered)
        const currentData = await source.client.executeTemplate(dexUniswapV3PoolsByVolume, { first });

        const pools = currentData.pools;

        // Calculate fee APY for each pool (annualized)
        const poolAnalysis = pools.map((p) => {
          const tvl = Number(p.totalValueLockedUSD);
          const volume = Number(p.volumeUSD);
          const fees = Number(p.feesUSD);
          // Estimate daily fees as feesUSD / 30 (approximate)
          const dailyFees = fees / 30;
          // Annualized fee APY = (dailyFees * 365) / TVL * 100
          const feeAPY = tvl > 0 ? ((dailyFees * 365) / tvl) * 100 : 0;
          // Volume/TVL ratio indicates trading activity
          const volumeTVLRatio = tvl > 0 ? volume / tvl : 0;

          return {
            id: p.id,
            pair: `${p.token0?.symbol}/${p.token1?.symbol}`,
            tvl,
            volume,
            fees,
            feeAPY,
            volumeTVLRatio,
          };
        });

        // Sort by fee APY
        poolAnalysis.sort((a, b) => b.feeAPY - a.feeAPY);

        return JSON.stringify({
          network,
          poolCount: pools.length,
          totalTVL: poolAnalysis.reduce((sum, p) => sum + p.tvl, 0),
          totalVolume: poolAnalysis.reduce((sum, p) => sum + p.volume, 0),
          topPoolsByFeeAPY: poolAnalysis.slice(0, first),
        }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'getVolumeAnalysis',
      description: 'Analyze DEX pool volume, fees, and estimated fee APY',
      schema: z.object({
        network: z.enum(['ethereum']).optional().describe('Network to query'),
        first: z.number().optional().describe('Number of pools to analyze'),
      }),
    }
  );

  /**
   * Get DEX pool count and aggregate metrics.
   */
  const getDexMetricsTool = tool(
    async (input: unknown) => {
      const { network = 'ethereum' } = input as { network?: string };

      try {
        const env = loadGraphEnv();
        const registry = ProtocolRegistry.fromEnv(env);
        const source = registry.getSource('uniswap-v3', network);

        if (!source) {
          return JSON.stringify({ error: `Uniswap V3 not configured for network: ${network}` });
        }

        const data = await source.client.executeTemplate(dexUniswapV3Metrics, { first: 100 });

        const pools = data.pools;
        const blockNumber = data._meta?.block?.number;

        let totalTVL = 0;
        let totalVolume = 0;
        let totalFees = 0;

        for (const p of pools) {
          totalTVL += Number(p.totalValueLockedUSD);
          totalVolume += Number(p.volumeUSD);
          totalFees += Number(p.feesUSD);
        }

        return JSON.stringify({
          network,
          blockNumber,
          totalPools: pools.length,
          totalTVL,
          totalVolume,
          totalFees,
          avgTVL: pools.length > 0 ? totalTVL / pools.length : 0,
          topPools: pools.slice(0, 5).map((p) => ({
            pair: `${p.token0?.symbol}/${p.token1?.symbol}`,
            tvl: Number(p.totalValueLockedUSD),
            volume: Number(p.volumeUSD),
            fees: Number(p.feesUSD),
          })),
        }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'getDexMetrics',
      description: 'Get DEX pool count, total TVL, volume, and fee metrics',
      schema: z.object({
        network: z.enum(['ethereum']).optional().describe('Network to query'),
      }),
    }
  );

  return [getDexPoolsTool, getVolumeAnalysisTool, getDexMetricsTool];
}
