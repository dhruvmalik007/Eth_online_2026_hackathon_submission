import { tool } from '@langchain/core/tools';
import * as z from 'zod';
import {
  ProtocolRegistry,
  loadEnv as loadGraphEnv,
  lendingAaveV3Reserves,
  lendingAaveV3PoolMetrics,
  type AaveReserve,
  type ProtocolSource,
} from '@ethonline2026/graph-fno-indexer';

/**
 * Lending reserve data from Aave V3 subgraphs.
 * All queries run through the-graph query templates — no inline SDL here.
 */

/** Lending reserve row (the-graph AaveReserve schema output). */
export type LendingReserve = AaveReserve;

/**
 * Lending market summary with computed metrics.
 */
export interface LendingMarketSummary {
  readonly protocol: string;
  readonly network: string;
  readonly totalReserves: number;
  readonly totalTVL: number;
  readonly avgSupplyAPY: number;
  readonly avgBorrowAPY: number;
  readonly reserves: LendingReserve[];
}

/**
 * Create LangChain tools for lending data extraction.
 * Wraps ProtocolRegistry to query Aave V3 subgraphs across multiple chains.
 */
export function createLendingTools() {
  /**
   * Get lending reserves from Aave V3 for a specific network.
   */
  const getLendingReservesTool = tool(
    async (input: unknown) => {
      const { network = 'ethereum', first = 10 } = input as { network?: string; number?: number; first?: number };

      try {
        const env = loadGraphEnv();
        const registry = ProtocolRegistry.fromEnv(env);
        const source = registry.getSource('aave-v3', network);

        if (!source) {
          return JSON.stringify({ error: `Aave V3 not configured for network: ${network}` });
        }

        const data = await source.client.executeTemplate(lendingAaveV3Reserves, { first });
        const reserves = data.reserves;

        // Compute summary metrics
        let totalTVL = 0;
        let totalSupplyRate = 0;
        let totalBorrowRate = 0;

        for (const r of reserves) {
          const liquidity = Number(r.totalLiquidity) / Math.pow(10, r.decimals);
          totalTVL += liquidity;
          // Rates are in RAY units (1e27), convert to fraction
          totalSupplyRate += Number(r.liquidityRate) / 1e27;
          totalBorrowRate += Number(r.variableBorrowRate) / 1e27;
        }

        const summary: LendingMarketSummary = {
          protocol: 'Aave V3',
          network,
          totalReserves: reserves.length,
          totalTVL,
          avgSupplyAPY: reserves.length > 0 ? (totalSupplyRate / reserves.length) * 100 : 0,
          avgBorrowAPY: reserves.length > 0 ? (totalBorrowRate / reserves.length) * 100 : 0,
          reserves: reserves.slice(0, first),
        };

        return JSON.stringify(summary, null, 2);
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'getLendingReserves',
      description: 'Get lending reserves from Aave V3 with TVL, supply/borrow APY, and utilization rates',
      schema: z.object({
        network: z.enum(['ethereum', 'arbitrum', 'optimism']).optional().describe('Network to query (default: ethereum)'),
        first: z.number().optional().describe('Number of reserves to return (default: 10)'),
      }),
    }
  );

  /**
   * Compare yields across multiple lending protocols and networks.
   */
  const compareLendingYieldsTool = tool(
    async (input: unknown) => {
      const { networks = ['ethereum', 'arbitrum', 'optimism'], symbol } = input as {
        networks?: string[];
        symbol?: string;
      };

      try {
        const env = loadGraphEnv();
        const registry = ProtocolRegistry.fromEnv(env);
        const results: LendingMarketSummary[] = [];

        for (const network of networks) {
          const source = registry.getSource('aave-v3', network);
          if (!source) continue;

          const data = await source.client.executeTemplate(lendingAaveV3Reserves, { first: 50 });

          let reserves = data.reserves;
          if (symbol) {
            reserves = reserves.filter((r) => r.symbol.toUpperCase() === symbol.toUpperCase());
          }

          let totalTVL = 0;
          let totalSupplyRate = 0;
          let totalBorrowRate = 0;

          for (const r of reserves) {
            const liquidity = Number(r.totalLiquidity) / Math.pow(10, r.decimals);
            totalTVL += liquidity;
            totalSupplyRate += Number(r.liquidityRate) / 1e27;
            totalBorrowRate += Number(r.variableBorrowRate) / 1e27;
          }

          results.push({
            protocol: 'Aave V3',
            network,
            totalReserves: reserves.length,
            totalTVL,
            avgSupplyAPY: reserves.length > 0 ? (totalSupplyRate / reserves.length) * 100 : 0,
            avgBorrowAPY: reserves.length > 0 ? (totalBorrowRate / reserves.length) * 100 : 0,
            reserves: reserves.slice(0, 10),
          });
        }

        // Sort by best supply APY
        results.sort((a, b) => b.avgSupplyAPY - a.avgSupplyAPY);

        return JSON.stringify({
          comparison: results,
          bestYield: results[0]
            ? {
              network: results[0].network,
              supplyAPY: results[0].avgSupplyAPY,
              borrowAPY: results[0].avgBorrowAPY,
            }
            : null,
        }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'compareLendingYields',
      description: 'Compare lending yields across multiple networks (ethereum, arbitrum, optimism)',
      schema: z.object({
        networks: z.array(z.enum(['ethereum', 'arbitrum', 'optimism'])).optional().describe('Networks to compare'),
        symbol: z.string().optional().describe('Filter by token symbol (e.g., USDC, WETH)'),
      }),
    }
  );

  /**
   * Get lending pool count and aggregate metrics.
   */
  const getLendingPoolMetricsTool = tool(
    async (input: unknown) => {
      const { network = 'ethereum' } = input as { network?: string };

      try {
        const env = loadGraphEnv();
        const registry = ProtocolRegistry.fromEnv(env);
        const source = registry.getSource('aave-v3', network);

        if (!source) {
          return JSON.stringify({ error: `Aave V3 not configured for network: ${network}` });
        }

        const data = await source.client.executeTemplate(lendingAaveV3PoolMetrics, { first: 100 });
        const reserves = data.reserves;
        const activeReserves = reserves.filter((r) => r.isActive);

        let totalTVL = 0;
        let totalBorrowed = 0;
        let weightedUtilization = 0;

        for (const r of reserves) {
          const liquidity = Number(r.totalLiquidity) / Math.pow(10, r.decimals);
          const debt = Number(r.totalCurrentVariableDebt) / Math.pow(10, r.decimals);
          totalTVL += liquidity;
          totalBorrowed += debt;
          weightedUtilization += Number(r.utilizationRate) * liquidity;
        }

        const avgUtilization = totalTVL > 0 ? weightedUtilization / totalTVL : 0;

        return JSON.stringify({
          network,
          totalPools: reserves.length,
          activePools: activeReserves.length,
          totalTVL,
          totalBorrowed,
          avgUtilization,
          topAssets: reserves.slice(0, 5).map((r) => ({
            symbol: r.symbol,
            tvl: Number(r.totalLiquidity) / Math.pow(10, r.decimals),
            supplyAPY: (Number(r.liquidityRate) / 1e27) * 100,
            borrowAPY: (Number(r.variableBorrowRate) / 1e27) * 100,
          })),
        }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'getLendingPoolMetrics',
      description: 'Get lending pool count, TVL, and aggregate utilization metrics',
      schema: z.object({
        network: z.enum(['ethereum', 'arbitrum', 'optimism']).optional().describe('Network to query'),
      }),
    }
  );

  return [getLendingReservesTool, compareLendingYieldsTool, getLendingPoolMetricsTool];
}

export type { ProtocolSource };
