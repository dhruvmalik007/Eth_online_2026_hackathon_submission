import { tool } from '@langchain/core/tools';
import * as z from 'zod';
import {
  ProtocolRegistry,
  loadEnv as loadGraphEnv,
  predictionPolymarketProbe,
  predictionPolymarketActivity,
} from '@ethonline2026/graph-fno-indexer';

/**
 * Polymarket condition data.
 */
export interface PredictionCondition {
  readonly id: string;
}

/**
 * Polymarket fixed product market maker.
 */
export interface PredictionMarket {
  readonly id: string;
}

/**
 * Polymarket redemption data (payout-ordered probe path — includes redeemer).
 */
export interface PredictionRedemption {
  readonly id: string;
  readonly payout: string;
  readonly redeemer: string;
  readonly timestamp: string;
}

/**
 * Prediction market summary.
 */
export interface PredictionMarketSummary {
  readonly protocol: string;
  readonly network: string;
  readonly totalConditions: number;
  readonly totalMarkets: number;
  readonly totalRedemptions: number;
  readonly totalPayoutVolume: number;
  readonly recentRedemptions: PredictionRedemption[];
}

/**
 * Create LangChain tools for prediction market data extraction.
 * Wraps ProtocolRegistry to query Polymarket subgraphs.
 * All queries run through the-graph query templates — no inline SDL here.
 */
export function createPredictionTools() {
  /**
   * Get Polymarket active conditions and markets.
   */
  const getPredictionMarketsTool = tool(
    async (input: unknown) => {
      const { network = 'polygon', first = 10 } = input as {
        network?: string;
        first?: number;
      };

      try {
        const env = loadGraphEnv();
        const registry = ProtocolRegistry.fromEnv(env);
        const source = registry.getSource('polymarket', network);

        if (!source) {
          return JSON.stringify({ error: `Polymarket not configured for network: ${network}` });
        }

        const data = await source.client.executeTemplate(predictionPolymarketProbe, { first });

        const conditions = data.conditions;
        const markets = data.fixedProductMarketMakers;
        const redemptions = data.redemptions;

        // Calculate total payout volume
        let totalPayoutVolume = 0;
        for (const r of redemptions) {
          totalPayoutVolume += Number(r.payout) / 1e6; // USDC has 6 decimals
        }

        const summary: PredictionMarketSummary = {
          protocol: 'Polymarket',
          network,
          totalConditions: conditions.length,
          totalMarkets: markets.length,
          totalRedemptions: redemptions.length,
          totalPayoutVolume,
          recentRedemptions: redemptions.slice(0, first),
        };

        return JSON.stringify(summary, null, 2);
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'getPredictionMarkets',
      description: 'Get Polymarket active conditions, markets, and redemption data',
      schema: z.object({
        network: z.enum(['polygon']).optional().describe('Network to query (default: polygon)'),
        first: z.number().optional().describe('Number of results to return (default: 10)'),
      }),
    }
  );

  /**
   * Get prediction market volume and activity metrics.
   */
  const getPredictionVolumeTool = tool(
    async (input: unknown) => {
      const { network = 'polygon', first = 20 } = input as {
        network?: string;
        first?: number;
      };

      try {
        const env = loadGraphEnv();
        const registry = ProtocolRegistry.fromEnv(env);
        const source = registry.getSource('polymarket', network);

        if (!source) {
          return JSON.stringify({ error: `Polymarket not configured for network: ${network}` });
        }

        const data = await source.client.executeTemplate(predictionPolymarketActivity, {
          window: 100,
          first,
        });

        const conditions = data.conditions;
        const markets = data.fixedProductMarketMakers;
        const positions = data.positions;
        const redemptions = data.redemptions;
        const blockNumber = data._meta?.block?.number;

        // Calculate metrics
        let totalPayout = 0;
        let largestPayout = 0;
        for (const r of redemptions) {
          const payout = Number(r.payout) / 1e6;
          totalPayout += payout;
          if (payout > largestPayout) largestPayout = payout;
        }

        return JSON.stringify({
          network,
          blockNumber,
          activeConditions: conditions.length,
          activeMarkets: markets.length,
          totalPositions: positions.length,
          totalRedemptions: redemptions.length,
          totalPayoutVolume: totalPayout,
          largestPayout,
          avgPayout: redemptions.length > 0 ? totalPayout / redemptions.length : 0,
          recentActivity: redemptions.slice(0, 5).map((r) => ({
            payout: Number(r.payout) / 1e6,
            timestamp: Number(r.timestamp),
            date: new Date(Number(r.timestamp) * 1000).toISOString(),
          })),
        }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'getPredictionVolume',
      description: 'Get Polymarket volume, payout, and activity metrics',
      schema: z.object({
        network: z.enum(['polygon']).optional().describe('Network to query'),
        first: z.number().optional().describe('Number of results to analyze'),
      }),
    }
  );

  /**
   * Get prediction market count and aggregate metrics.
   */
  const getPredictionMetricsTool = tool(
    async (input: unknown) => {
      const { network = 'polygon' } = input as { network?: string };

      try {
        const env = loadGraphEnv();
        const registry = ProtocolRegistry.fromEnv(env);
        const source = registry.getSource('polymarket', network);

        if (!source) {
          return JSON.stringify({ error: `Polymarket not configured for network: ${network}` });
        }

        const data = await source.client.executeTemplate(predictionPolymarketActivity, {
          window: 200,
          first: 200,
        });

        const conditions = data.conditions;
        const markets = data.fixedProductMarketMakers;
        const positions = data.positions;
        const redemptions = data.redemptions;
        const blockNumber = data._meta?.block?.number;

        let totalPayout = 0;
        for (const r of redemptions) {
          totalPayout += Number(r.payout) / 1e6;
        }

        return JSON.stringify({
          network,
          blockNumber,
          totalConditions: conditions.length,
          totalMarkets: markets.length,
          totalPositions: positions.length,
          totalRedemptions: redemptions.length,
          totalPayoutVolume: totalPayout,
          avgPayoutPerRedemption: redemptions.length > 0 ? totalPayout / redemptions.length : 0,
        }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'getPredictionMetrics',
      description: 'Get prediction market count, positions, and payout metrics',
      schema: z.object({
        network: z.enum(['polygon']).optional().describe('Network to query'),
      }),
    }
  );

  return [getPredictionMarketsTool, getPredictionVolumeTool, getPredictionMetricsTool];
}
