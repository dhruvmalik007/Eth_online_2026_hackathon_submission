import { BaseTool, type ToolResult } from '../BaseTool.js';
import { VaRInputSchema, type VaRInput } from '../../graphql/schema.js';
import { FnoDataExtractor, type SubgraphClient } from '@ethonline2026/graph-fno-indexer';

/**
 * Value at Risk (VaR) calculation tool.
 * Computes VaR and Expected Shortfall using historical or Monte Carlo methods.
 */

export interface VaROutput {
  readonly var95: number;
  readonly var99: number;
  readonly expectedShortfall: number;
  readonly method: 'historical' | 'monte-carlo';
  readonly confidenceLevels: number[];
  readonly historicalReturns: number[];
}

export class VaRTool extends BaseTool {
  readonly name = 'valueAtRisk';
  readonly description = 'Compute Value at Risk (VaR) and Expected Shortfall. Supports historical simulation and Monte Carlo methods.';
  readonly schema = VaRInputSchema;

  private client: SubgraphClient | null = null;

  constructor(client?: SubgraphClient) {
    super();
    this.client = client ?? null;
  }

  setClient(client: SubgraphClient): void {
    this.client = client;
  }

  /**
   * Compute VaR for a protocol.
   */
  async computeVaR(input: VaRInput): Promise<ToolResult<VaROutput>> {
    const startTime = Date.now();

    if (!this.client) {
      return {
        success: false,
        error: 'Subgraph client not set. Call setClient() first.',
        toolName: this.name,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      // Fetch protocol snapshot with financial metrics
      const extractor = new FnoDataExtractor(this.client);
      const protocol = await extractor.protocolSnapshot(input.protocolId);

      if (!protocol) {
        return {
          success: false,
          error: 'Protocol not found or no data available',
          toolName: this.name,
          durationMs: Date.now() - startTime,
        };
      }

      const metrics = protocol.financialMetrics;

      if (metrics.length === 0) {
        return {
          success: false,
          error: 'No financial metrics available for VaR calculation',
          toolName: this.name,
          durationMs: Date.now() - startTime,
        };
      }

      // Calculate daily returns from volume data
      const returns = this.calculateReturns(metrics);

      if (returns.length === 0) {
        return {
          success: false,
          error: 'Insufficient data for VaR calculation',
          toolName: this.name,
          durationMs: Date.now() - startTime,
        };
      }

      let var95: number;
      let var99: number;
      let expectedShortfall: number;
      const actualMethod: 'historical' | 'monte-carlo' = input.method === 'monte-carlo' ? 'monte-carlo' : 'historical';

      if (actualMethod === 'monte-carlo') {
        // Monte Carlo simulation
        const simulation = this.monteCarloSimulation(returns, input.simulations);
        var95 = simulation.var95;
        var99 = simulation.var99;
        expectedShortfall = simulation.expectedShortfall;
      } else {
        // Historical simulation
        const sortedReturns = [...returns].sort((a, b) => a - b);
        const idx95 = Math.floor(sortedReturns.length * 0.05);
        const idx99 = Math.floor(sortedReturns.length * 0.01);
        var95 = -sortedReturns[idx95]!;
        var99 = -sortedReturns[idx99]!;

        // Expected Shortfall (CVaR) = average of returns beyond VaR
        const tailReturns = sortedReturns.slice(0, idx95);
        expectedShortfall = tailReturns.length > 0
          ? -tailReturns.reduce((a, b) => a + b, 0) / tailReturns.length
          : var95;
      }

      return {
        success: true,
        data: {
          var95,
          var99,
          expectedShortfall,
          method: actualMethod,
          confidenceLevels: input.confidenceLevels,
          historicalReturns: returns,
        },
        toolName: this.name,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        toolName: this.name,
        durationMs: Date.now() - startTime,
      };
    }
  }

  private calculateReturns(metrics: ReadonlyArray<{ readonly dailyVolumeUSD: string; readonly days: number }>): number[] {
    const returns: number[] = [];

    for (let i = 1; i < metrics.length; i++) {
      const current = parseFloat(metrics[i]!.dailyVolumeUSD) || 0;
      const previous = parseFloat(metrics[i - 1]!.dailyVolumeUSD) || 0;

      if (previous > 0) {
        returns.push((current - previous) / previous);
      }
    }

    return returns;
  }

  private monteCarloSimulation(
    returns: number[],
    simulations: number,
  ): { var95: number; var99: number; expectedShortfall: number } {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Generate simulated returns
    const simulatedReturns: number[] = [];
    for (let i = 0; i < simulations; i++) {
      // Box-Muller transform for normal distribution
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      simulatedReturns.push(mean + z * stdDev);
    }

    const sorted = [...simulatedReturns].sort((a, b) => a - b);
    const idx95 = Math.floor(sorted.length * 0.05);
    const idx99 = Math.floor(sorted.length * 0.01);

    const var95 = -sorted[idx95]!;
    const var99 = -sorted[idx99]!;

    const tailReturns = sorted.slice(0, idx95);
    const expectedShortfall = tailReturns.length > 0
      ? -tailReturns.reduce((a, b) => a + b, 0) / tailReturns.length
      : var95;

    return { var95, var99, expectedShortfall };
  }

  protected async run(input: VaRInput): Promise<unknown> {
    return this.computeVaR(input);
  }
}
