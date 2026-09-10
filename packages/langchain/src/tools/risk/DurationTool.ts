import { BaseTool, type ToolResult } from '../BaseTool.js';
import { DurationInputSchema, type DurationInput } from '../../graphql/schema.js';
import { FnoDataExtractor, type SubgraphClient } from '@ethonline2026/graph-fno-indexer';

/**
 * Duration and Convexity calculation tool.
 * Computes DV01 (dollar value of 1bp rate change) and convexity.
 *
 * For DeFi: measures sensitivity of pool TVL to yield changes.
 * Analogous to bond duration but applied to DeFi yields.
 */

export interface DurationOutput {
  readonly duration: number;
  readonly modifiedDuration: number;
  readonly dv01: number;
  readonly convexity: number;
  readonly yieldToMaturity: number;
  readonly effectiveDuration: number;
  readonly tvl: number;
}

export class DurationTool extends BaseTool {
  readonly name = 'duration';
  readonly description = 'Compute duration, modified duration, DV01, and convexity. Measures sensitivity of pool TVL to yield changes.';
  readonly schema = DurationInputSchema;

  private client: SubgraphClient | null = null;

  constructor(client?: SubgraphClient) {
    super();
    this.client = client ?? null;
  }

  setClient(client: SubgraphClient): void {
    this.client = client;
  }

  /**
   * Compute duration metrics for a pool.
   */
  async computeDuration(input: DurationInput): Promise<ToolResult<DurationOutput>> {
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
      // Fetch funding data (1 week of hourly snapshots)
      const extractor = new FnoDataExtractor(this.client);
      const pool = await extractor.funding(input.poolId, 168);

      if (!pool) {
        return {
          success: false,
          error: 'Pool not found or no funding data available',
          toolName: this.name,
          durationMs: Date.now() - startTime,
        };
      }

      const tvl = parseFloat(pool.totalValueLockedUSD) || 0;
      const hourlySnapshots = pool.hourlySnapshots;

      if (hourlySnapshots.length < 2) {
        return {
          success: false,
          error: 'Insufficient data for duration calculation',
          toolName: this.name,
          durationMs: Date.now() - startTime,
        };
      }

      // Calculate yields from funding rates
      const yields = hourlySnapshots.map((s) => parseFloat(s.hourlyFundingrate) || 0);

      // Current yield (annualized)
      const currentYield = yields[0]! * 8760; // Annualize hourly rate

      // Calculate effective duration using yield changes
      const yieldChanges: number[] = [];

      for (let i = 1; i < hourlySnapshots.length; i++) {
        const currentYield = parseFloat(hourlySnapshots[i]!.hourlyFundingrate) || 0;
        const previousYield = parseFloat(hourlySnapshots[i - 1]!.hourlyFundingrate) || 0;
        yieldChanges.push(currentYield - previousYield);
      }

      // Effective duration = -ΔP/P / Δy
      // Approximated using yield volatility
      const avgYieldChange = yieldChanges.reduce((a, b) => a + b, 0) / yieldChanges.length;
      const yieldVariance = yieldChanges.reduce((sum, yc) => sum + Math.pow(yc - avgYieldChange, 2), 0) / yieldChanges.length;
      const yieldVolatility = Math.sqrt(yieldVariance);

      // Duration approximation
      const duration = yieldVolatility > 0 ? 1 / yieldVolatility : 1;
      const modifiedDuration = duration / (1 + currentYield);

      // DV01 = Modified Duration × Price × 0.0001
      const dv01 = modifiedDuration * tvl * 0.0001;

      // Convexity approximation
      const convexity = input.includeConvexity
        ? this.calculateConvexity(yields, tvl)
        : 0;

      // Effective duration (empirical)
      const effectiveDuration = this.calculateEffectiveDuration(hourlySnapshots);

      return {
        success: true,
        data: {
          duration,
          modifiedDuration,
          dv01,
          convexity,
          yieldToMaturity: currentYield,
          effectiveDuration,
          tvl,
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

  /**
   * Calculate convexity from yield data.
   */
  private calculateConvexity(yields: number[], price: number): number {
    if (price === 0 || yields.length < 3) return 0;

    const avgYield = yields.reduce((a, b) => a + b, 0) / yields.length;
    const convexity = yields.reduce((sum, y) => sum + Math.pow(y - avgYield, 2), 0) / yields.length;

    return convexity / Math.pow(1 + avgYield, 2);
  }

  /**
   * Calculate effective duration from hourly snapshots.
   */
  private calculateEffectiveDuration(snapshots: ReadonlyArray<{ readonly hourlyFundingrate: string; readonly hours: number }>): number {
    if (snapshots.length < 2) return 0;

    const rates = snapshots.map((s) => parseFloat(s.hourlyFundingrate) || 0);
    const maxRate = Math.max(...rates);
    const minRate = Math.min(...rates);
    const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;

    if (avgRate === 0) return 0;

    // Effective duration = (P- - P+) / (2 × P0 × Δy)
    const rateChange = (maxRate - minRate) / 2;
    return rateChange > 0 ? (maxRate - minRate) / (2 * avgRate) : 0;
  }

  protected async run(input: DurationInput): Promise<unknown> {
    return this.computeDuration(input);
  }
}
