import { BaseTool, type ToolResult } from '../BaseTool.js';
import { DeltaInputSchema, type DeltaInput } from '../../graphql/schema.js';
import { FnoDataExtractor, type SubgraphClient } from '@ethonline2026/graph-fno-indexer';

/**
 * Delta calculation tool.
 * Computes position delta: Δ = ∂PositionValue/∂UnderlyingPrice
 *
 * For DeFi: measures sensitivity of position value to underlying token price changes.
 * Uses position balanceUSD and token price data from The Graph.
 */

export interface DeltaOutput {
  readonly delta: number;
  readonly netExposure: number;
  readonly longExposure: number;
  readonly shortExposure: number;
  readonly positionCount: number;
  readonly leverageWeightedDelta: number;
}

export class DeltaTool extends BaseTool {
  readonly name = 'delta';
  readonly description = 'Compute position delta (Δ) — sensitivity of position value to underlying price changes. Returns net exposure and leverage-weighted delta.';
  readonly schema = DeltaInputSchema;

  private client: SubgraphClient | null = null;

  constructor(client?: SubgraphClient) {
    super();
    this.client = client ?? null;
  }

  setClient(client: SubgraphClient): void {
    this.client = client;
  }

  /**
   * Compute delta for a protocol/pool.
   */
  async computeDelta(input: DeltaInput): Promise<ToolResult<DeltaOutput>> {
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

      // Calculate exposures
      let longExposure = 0;
      let shortExposure = 0;
      let totalLeverage = 0;

      for (const pos of positions) {
        const balanceUSD = parseFloat(pos.balanceUSD);
        const leverage = parseFloat(pos.leverage) || 1;

        if (pos.side === 'LONG') {
          longExposure += balanceUSD * leverage;
        } else {
          shortExposure += balanceUSD * leverage;
        }
        totalLeverage += leverage;
      }

      const netExposure = longExposure - shortExposure;
      const positionCount = positions.length;
      const avgLeverage = positionCount > 0 ? totalLeverage / positionCount : 1;

      // Delta = net exposure normalized by position count
      // Leverage-weighted delta accounts for amplified exposure
      const delta = positionCount > 0 ? netExposure / positionCount : 0;
      const leverageWeightedDelta = delta * avgLeverage;

      return {
        success: true,
        data: {
          delta,
          netExposure,
          longExposure,
          shortExposure,
          positionCount,
          leverageWeightedDelta,
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

  protected async run(input: DeltaInput): Promise<unknown> {
    return this.computeDelta(input);
  }
}
