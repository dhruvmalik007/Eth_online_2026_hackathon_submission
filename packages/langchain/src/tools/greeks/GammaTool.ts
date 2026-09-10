import { BaseTool, type ToolResult } from '../BaseTool.js';
import { GammaInputSchema, type GammaInput } from '../../graphql/schema.js';
import { FnoDataExtractor, type SubgraphClient } from '@ethonline2026/graph-fno-indexer';

/**
 * Gamma calculation tool.
 * Computes position gamma: Γ = ∂²PositionValue/∂UnderlyingPrice²
 *
 * For DeFi: measures the rate of change of delta with respect to price.
 * High gamma means delta changes rapidly with price moves — important for
 * leveraged positions that can be liquidated.
 */

export interface GammaOutput {
  readonly gamma: number;
  readonly leverageProfile: {
    readonly avgLeverage: number;
    readonly maxLeverage: number;
    readonly minLeverage: number;
    readonly leverageStdDev: number;
  };
  readonly liquidationRisk: 'low' | 'medium' | 'high' | 'critical';
  readonly deltaSensitivity: number;
}

export class GammaTool extends BaseTool {
  readonly name = 'gamma';
  readonly description = 'Compute position gamma (Γ) — rate of change of delta with respect to price. Identifies leveraged positions at risk of rapid delta shifts.';
  readonly schema = GammaInputSchema;

  private client: SubgraphClient | null = null;

  constructor(client?: SubgraphClient) {
    super();
    this.client = client ?? null;
  }

  setClient(client: SubgraphClient): void {
    this.client = client;
  }

  /**
   * Compute gamma for a protocol/pool.
   */
  async computeGamma(input: GammaInput): Promise<ToolResult<GammaOutput>> {
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
      // Fetch positions
      const extractor = new FnoDataExtractor(this.client);
      const positions = await extractor.openPositions(input.poolId);

      if (positions.length === 0) {
        return {
          success: true,
          data: {
            gamma: 0,
            leverageProfile: { avgLeverage: 0, maxLeverage: 0, minLeverage: 0, leverageStdDev: 0 },
            liquidationRisk: 'low',
            deltaSensitivity: 0,
          },
          toolName: this.name,
          durationMs: Date.now() - startTime,
        };
      }

      // Calculate leverage distribution
      const leverages = positions.map((p) => parseFloat(p.leverage) || 1);
      const avgLeverage = leverages.reduce((a, b) => a + b, 0) / leverages.length;
      const maxLeverage = Math.max(...leverages);
      const minLeverage = Math.min(...leverages);
      const leverageVariance = leverages.reduce((sum, l) => sum + Math.pow(l - avgLeverage, 2), 0) / leverages.length;
      const leverageStdDev = Math.sqrt(leverageVariance);

      // Gamma approximation: sensitivity of position count to leverage changes
      // Higher leverage variance = higher gamma (more positions near liquidation)
      const highLeveragePositions = leverages.filter((l) => l > avgLeverage * 1.5).length;
      const gamma = highLeveragePositions / positions.length * avgLeverage;

      // Delta sensitivity: how much delta can change per 1% price move
      const deltaSensitivity = gamma * avgLeverage;

      // Liquidation risk based on leverage distribution
      const liquidationRisk = this.assessLiquidationRisk(avgLeverage, maxLeverage, leverageStdDev);

      return {
        success: true,
        data: {
          gamma,
          leverageProfile: {
            avgLeverage,
            maxLeverage,
            minLeverage,
            leverageStdDev,
          },
          liquidationRisk,
          deltaSensitivity,
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

  private assessLiquidationRisk(
    avgLeverage: number,
    maxLeverage: number,
    _stdDev: number,
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (maxLeverage > 50 || avgLeverage > 20) return 'critical';
    if (maxLeverage > 25 || avgLeverage > 10) return 'high';
    if (maxLeverage > 10 || avgLeverage > 5) return 'medium';
    return 'low';
  }

  protected async run(input: GammaInput): Promise<unknown> {
    return this.computeGamma(input);
  }
}
