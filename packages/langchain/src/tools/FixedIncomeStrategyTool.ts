import { tool } from '@langchain/core/tools';
import * as z from 'zod';
import {
  ProtocolRegistry,
  loadEnv as loadGraphEnv,
  lendingAaveV3RiskParams,
  lendingAaveV3PoolMetrics,
} from '@ethonline2026/graph-fno-indexer';

/**
 * Fixed income strategy metrics (Bloomberg PORT-style).
 */
export interface FixedIncomeMetrics {
  readonly alpha: number; // Excess return vs benchmark
  readonly beta: number; // Sensitivity to market movements
  readonly vega: number; // Sensitivity to volatility
  readonly theta: number; // Time decay
  readonly gamma: number; // Convexity (second derivative)
  readonly duration: number; // Interest rate sensitivity (DV01)
  readonly convexity: number; // Rate curvature
  readonly sharpeRatio: number; // Risk-adjusted return
  readonly maxDrawdown: number; // Peak-to-trough decline
  readonly var95: number; // Value at Risk (95% confidence)
  readonly var99: number; // Value at Risk (99% confidence)
}

/**
 * Yield opportunity with risk metrics.
 */
export interface YieldOpportunity {
  readonly protocol: string;
  readonly network: string;
  readonly asset: string;
  readonly supplyAPY: number;
  readonly borrowAPY: number;
  readonly tvl: number;
  readonly utilization: number;
  readonly riskScore: number; // 0-100 (lower is better)
  readonly recommendation: 'supply' | 'borrow' | 'hold';
}

/**
 * Create LangChain tools for fixed income strategy analysis.
 * Computes Bloomberg-style risk metrics (Greeks, VaR, stress tests).
 */
export function createFixedIncomeTools() {
  /**
   * Compute fixed income metrics for a lending position.
   */
  const computeFixedIncomeMetricsTool = tool(
    async (input: unknown) => {
      const { network = 'ethereum', asset = 'USDC', amount = 100000 } = input as {
        network?: string;
        asset?: string;
        amount?: number;
      };

      try {
        const env = loadGraphEnv();
        const registry = ProtocolRegistry.fromEnv(env);
        const source = registry.getSource('aave-v3', network);

        if (!source) {
          return JSON.stringify({ error: `Aave V3 not configured for network: ${network}` });
        }

        // Fetch reserve data for the asset (risk params: liquidation threshold + factor)
        const data = await source.client.executeTemplate(lendingAaveV3RiskParams, { first: 50 });

        const reserves = data.reserves;
        const reserve = reserves.find(
          (r) => r.symbol.toUpperCase() === asset.toUpperCase()
        );

        if (!reserve) {
          return JSON.stringify({ error: `Asset ${asset} not found on Aave V3 ${network}` });
        }

        // Convert RAY rates to percentages (1e27)
        const supplyAPY = (Number(reserve.liquidityRate) / 1e27) * 100;
        const borrowAPY = (Number(reserve.variableBorrowRate) / 1e27) * 100;
        const utilization = Number(reserve.utilizationRate);
        const tvl = Number(reserve.totalLiquidity) / Math.pow(10, reserve.decimals);

        // Compute fixed income metrics
        // Alpha: excess supply yield vs risk-free rate (assume 5% baseline)
        const riskFreeRate = 5.0;
        const alpha = supplyAPY - riskFreeRate;

        // Beta: sensitivity to utilization changes (higher utilization = higher rates)
        const beta = utilization > 0.8 ? 1.5 : utilization > 0.5 ? 1.0 : 0.5;

        // Vega: sensitivity to volatility (based on utilization variance)
        const vega = Math.abs(supplyAPY - borrowAPY) * 0.1;

        // Theta: time decay (assume 0.01% per day for lending)
        const theta = -0.01 * 365; // Annualized

        // Gamma: convexity (second derivative of yield curve)
        const gamma = (borrowAPY - supplyAPY) * 0.01;

        // Duration: interest rate sensitivity (DV01 approximation)
        const duration = 1 / (supplyAPY / 100 + 0.01);

        // Convexity: rate curvature
        const convexity = duration * duration * 0.5;

        // Sharpe ratio (assume 2% volatility for lending)
        const volatility = 2.0;
        const sharpeRatio = volatility > 0 ? (supplyAPY - riskFreeRate) / volatility : 0;

        // Max drawdown (based on utilization stress)
        const maxDrawdown = utilization > 0.9 ? 5.0 : utilization > 0.7 ? 2.0 : 0.5;

        // VaR (historical simulation based on utilization)
        const var95 = 1.645 * volatility * (amount / tvl > 0.01 ? 2 : 1);
        const var99 = 2.326 * volatility * (amount / tvl > 0.01 ? 2 : 1);

        const metrics: FixedIncomeMetrics = {
          alpha,
          beta,
          vega,
          theta,
          gamma,
          duration,
          convexity,
          sharpeRatio,
          maxDrawdown,
          var95,
          var99,
        };

        return JSON.stringify({
          asset,
          network,
          protocol: 'Aave V3',
          currentYield: {
            supplyAPY,
            borrowAPY,
            utilization,
            tvl,
          },
          position: {
            amount,
            expectedAnnualReturn: (amount * supplyAPY) / 100,
            riskAdjustedReturn: (amount * alpha) / 100,
          },
          riskMetrics: metrics,
          recommendation: {
            action: alpha > 1 ? 'supply' : alpha < -2 ? 'borrow' : 'hold',
            confidence: Math.min(Math.abs(alpha) * 20, 100),
            rationale:
              alpha > 1
                ? `Attractive yield premium of ${alpha.toFixed(2)}% over risk-free rate`
                : alpha < -2
                  ? `Consider borrowing at ${borrowAPY.toFixed(2)}% for leverage strategies`
                  : 'Yield premium insufficient for risk taken',
          },
        }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'computeFixedIncomeMetrics',
      description: 'Compute fixed income risk metrics (alpha, beta, vega, theta, gamma, duration, VaR) for a lending position',
      schema: z.object({
        network: z.enum(['ethereum', 'arbitrum', 'optimism']).optional().describe('Network to query'),
        asset: z.string().optional().describe('Asset symbol (e.g., USDC, WETH, DAI)'),
        amount: z.number().optional().describe('Position amount in USD (default: 100000)'),
      }),
    }
  );

  /**
   * Find best yield opportunities across lending and DEX protocols.
   */
  const findBestYieldsTool = tool(
    async (input: unknown) => {
      const { networks = ['ethereum', 'arbitrum', 'optimism'], minTVL = 1000000, asset } = input as {
        networks?: string[];
        minTVL?: number;
        asset?: string;
      };

      try {
        const env = loadGraphEnv();
        const registry = ProtocolRegistry.fromEnv(env);
        const opportunities: YieldOpportunity[] = [];

        // Query lending yields from Aave V3
        for (const network of networks) {
          const source = registry.getSource('aave-v3', network);
          if (!source) continue;

          const data = await source.client.executeTemplate(lendingAaveV3PoolMetrics, { first: 50 });

          const reserves = data.reserves;
          for (const r of reserves) {
            if (asset && r.symbol.toUpperCase() !== asset.toUpperCase()) continue;

            const tvl = Number(r.totalLiquidity) / Math.pow(10, r.decimals);
            if (tvl < minTVL) continue;

            const supplyAPY = (Number(r.liquidityRate) / 1e27) * 100;
            const borrowAPY = (Number(r.variableBorrowRate) / 1e27) * 100;
            const utilization = Number(r.utilizationRate);

            // Risk score based on utilization and TVL
            const riskScore = Math.min(
              utilization * 50 + (tvl < 10000000 ? 30 : tvl < 100000000 ? 15 : 0),
              100
            );

            opportunities.push({
              protocol: 'Aave V3',
              network,
              asset: r.symbol,
              supplyAPY,
              borrowAPY,
              tvl,
              utilization,
              riskScore,
              recommendation: supplyAPY > 5 ? 'supply' : supplyAPY > 2 ? 'hold' : 'borrow',
            });
          }
        }

        // Sort by risk-adjusted yield (supplyAPY / riskScore)
        opportunities.sort((a, b) => {
          const scoreA = a.riskScore > 0 ? a.supplyAPY / a.riskScore : a.supplyAPY;
          const scoreB = b.riskScore > 0 ? b.supplyAPY / b.riskScore : b.supplyAPY;
          return scoreB - scoreA;
        });

        return JSON.stringify({
          opportunitiesFound: opportunities.length,
          topOpportunities: opportunities.slice(0, 10),
          summary: {
            bestSupplyYield: opportunities.length > 0 ? opportunities[0] : null,
            avgSupplyAPY: opportunities.reduce((sum, o) => sum + o.supplyAPY, 0) / (opportunities.length || 1),
            totalTVL: opportunities.reduce((sum, o) => sum + o.tvl, 0),
          },
        }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'findBestYields',
      description: 'Find best yield opportunities across lending protocols with risk scoring',
      schema: z.object({
        networks: z.array(z.enum(['ethereum', 'arbitrum', 'optimism'])).optional().describe('Networks to search'),
        minTVL: z.number().optional().describe('Minimum TVL filter in USD'),
        asset: z.string().optional().describe('Filter by asset symbol'),
      }),
    }
  );

  /**
   * Run stress test scenarios on a fixed income portfolio.
   */
  const runStressTestTool = tool(
    async (input: unknown) => {
      const { network = 'ethereum', asset = 'USDC', amount = 100000 } = input as {
        network?: string;
        asset?: string;
        amount?: number;
      };

      try {
        const env = loadGraphEnv();
        const registry = ProtocolRegistry.fromEnv(env);
        const source = registry.getSource('aave-v3', network);

        if (!source) {
          return JSON.stringify({ error: `Aave V3 not configured for network: ${network}` });
        }

        // Get current reserve data
        const data = await source.client.executeTemplate(lendingAaveV3PoolMetrics, { first: 50 });

        const reserve = data.reserves.find(
          (r) => r.symbol.toUpperCase() === asset.toUpperCase()
        );

        if (!reserve) {
          return JSON.stringify({ error: `Asset ${asset} not found` });
        }

        const currentSupplyAPY = (Number(reserve.liquidityRate) / 1e27) * 100;
        const currentUtilization = Number(reserve.utilizationRate);

        // Stress test scenarios
        const scenarios = [
          {
            name: 'Rate Hike (+2%)',
            description: 'Federal Reserve raises rates by 200bps',
            supplyAPYChange: 1.5,
            utilizationChange: 0.1,
            impact: 'Higher yields, increased borrowing costs',
          },
          {
            name: 'Rate Cut (-1%)',
            description: 'Federal Reserve cuts rates by 100bps',
            supplyAPYChange: -0.8,
            utilizationChange: -0.05,
            impact: 'Lower yields, reduced borrowing demand',
          },
          {
            name: 'DeFi Hack',
            description: 'Major protocol exploit causes TVL flight',
            supplyAPYChange: -3.0,
            utilizationChange: -0.3,
            impact: 'Yield collapse, capital outflows',
          },
          {
            name: 'Stablecoin Depeg',
            description: 'Major stablecoin loses peg',
            supplyAPYChange: 5.0,
            utilizationChange: 0.4,
            impact: 'Flight to quality, volatile yields',
          },
          {
            name: 'Bull Market',
            description: 'Crypto market rally increases demand',
            supplyAPYChange: 2.0,
            utilizationChange: 0.2,
            impact: 'Higher yields from increased leverage demand',
          },
        ];

        const results = scenarios.map((scenario) => {
          const stressedSupplyAPY = Math.max(0, currentSupplyAPY + scenario.supplyAPYChange);
          const stressedUtilization = Math.min(1, Math.max(0, currentUtilization + scenario.utilizationChange));
          const pnl = (amount * (stressedSupplyAPY - currentSupplyAPY)) / 100;

          return {
            ...scenario,
            currentSupplyAPY,
            stressedSupplyAPY,
            currentUtilization,
            stressedUtilization,
            pnl,
            recommendation: pnl > 0 ? 'beneficial' : pnl > -amount * 0.05 ? 'manageable' : 'exit',
          };
        });

        return JSON.stringify({
          asset,
          network,
          currentPosition: {
            amount,
            supplyAPY: currentSupplyAPY,
            utilization: currentUtilization,
            annualReturn: (amount * currentSupplyAPY) / 100,
          },
          stressTestResults: results,
          worstCase: results.reduce((worst, r) => (r.pnl < worst.pnl ? r : worst), results[0]!),
          bestCase: results.reduce((best, r) => (r.pnl > best.pnl ? r : best), results[0]!),
        }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'runStressTest',
      description: 'Run stress test scenarios on a fixed income position (rate hikes, hacks, depegs)',
      schema: z.object({
        network: z.enum(['ethereum', 'arbitrum', 'optimism']).optional().describe('Network to query'),
        asset: z.string().optional().describe('Asset symbol'),
        amount: z.number().optional().describe('Position amount in USD'),
      }),
    }
  );

  return [computeFixedIncomeMetricsTool, findBestYieldsTool, runStressTestTool];
}
