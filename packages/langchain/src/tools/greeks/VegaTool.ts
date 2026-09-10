import { BaseTool, type ToolResult } from '../BaseTool.js';
import { VegaInputSchema, type VegaInput } from '../../graphql/schema.js';
import { FnoDataExtractor, type SubgraphClient } from '@ethonline2026/graph-fno-indexer';

/**
 * Vega calculation tool.
 * Computes position vega: ν = ∂PositionValue/∂σ
 *
 * For DeFi: measures sensitivity to funding rate volatility.
 * High vega means position value is sensitive to changes in funding rates.
 */

export interface VegaOutput {
  readonly vega: number;
  readonly fundingVolatility: number;
  readonly annualizedVol: number;
  readonly currentFundingRate: number;
  readonly fundingRateTrend: 'increasing' | 'decreasing' | 'stable';
  readonly hourlyFundingRates: number[];
}

export class VegaTool extends BaseTool {
  readonly name = 'vega';
  readonly description = 'Compute position vega (ν) — sensitivity to funding rate volatility. Measures how position value changes with funding rate fluctuations.';
  readonly schema = VegaInputSchema;

  private client: SubgraphClient | null = null;

  constructor(client?: SubgraphClient) {
    super();
    this.client = client ?? null;
  }

  setClient(client: SubgraphClient): void {
    this.client = client;
  }

  /**
   * Compute vega for a pool.
   */
  async computeVega(input: VegaInput): Promise<ToolResult<VegaOutput>> {
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
      // Fetch funding data
      const extractor = new FnoDataExtractor(this.client);
      const pool = await extractor.funding(input.poolId, input.hours);

      if (!pool) {
        return {
          success: false,
          error: 'Pool not found or no funding data available',
          toolName: this.name,
          durationMs: Date.now() - startTime,
        };
      }

      const hourlySnapshots = pool.hourlySnapshots;

      if (hourlySnapshots.length === 0) {
        return {
          success: true,
          data: {
            vega: 0,
            fundingVolatility: 0,
            annualizedVol: 0,
            currentFundingRate: 0,
            fundingRateTrend: 'stable',
            hourlyFundingRates: [],
          },
          toolName: this.name,
          durationMs: Date.now() - startTime,
        };
      }

      // Extract hourly funding rates
      const hourlyRates = hourlySnapshots.map((s) => parseFloat(s.hourlyFundingrate) || 0);
      const currentFundingRate = hourlyRates[0] || 0;

      // Calculate funding volatility (standard deviation of hourly rates)
      const mean = hourlyRates.reduce((a, b) => a + b, 0) / hourlyRates.length;
      const variance = hourlyRates.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / hourlyRates.length;
      const fundingVolatility = Math.sqrt(variance);

      // Annualize volatility (assuming 8760 hours in a year)
      const annualize = input.annualize ?? true;
      const annualizedVol = annualize ? fundingVolatility * Math.sqrt(8760) : fundingVolatility;

      // Vega = TVL * funding volatility (sensitivity of position value to vol changes)
      const tvl = parseFloat(pool.totalValueLockedUSD) || 0;
      const vega = tvl * fundingVolatility;

      // Determine trend
      const fundingRateTrend = this.determineTrend(hourlyRates);

      return {
        success: true,
        data: {
          vega,
          fundingVolatility,
          annualizedVol,
          currentFundingRate,
          fundingRateTrend,
          hourlyFundingRates: hourlyRates,
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

  private determineTrend(rates: number[]): 'increasing' | 'decreasing' | 'stable' {
    if (rates.length < 3) return 'stable';

    const recent = rates.slice(0, Math.min(6, rates.length));
    const older = rates.slice(-Math.min(6, rates.length));

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

    const change = (recentAvg - olderAvg) / (Math.abs(olderAvg) || 1);

    if (change > 0.1) return 'increasing';
    if (change < -0.1) return 'decreasing';
    return 'stable';
  }

  protected async run(input: VegaInput): Promise<unknown> {
    return this.computeVega(input);
  }
}
