import { BaseTool, type ToolResult } from '../BaseTool.js';
import { ThetaInputSchema, type ThetaInput } from '../../graphql/schema.js';
import { FnoDataExtractor, type SubgraphClient } from '@ethonline2026/graph-fno-indexer';

/**
 * Theta calculation tool.
 * Computes position theta: Θ = ∂PositionValue/∂t
 *
 * For DeFi: measures time decay of position value, primarily through
 * funding rate payments. Long positions pay funding when rate is positive.
 */

export interface ThetaOutput {
  readonly theta: number;
  readonly dailyFundingCost: number;
  readonly avgPositionAge: number;
  readonly fundingRatePerDay: number;
  readonly positionsAtRisk: number;
}

export class ThetaTool extends BaseTool {
  readonly name = 'theta';
  readonly description = 'Compute position theta (Θ) — time decay of position value through funding rate payments. Measures daily cost of holding positions.';
  readonly schema = ThetaInputSchema;

  private client: SubgraphClient | null = null;

  constructor(client?: SubgraphClient) {
    super();
    this.client = client ?? null;
  }

  setClient(client: SubgraphClient): void {
    this.client = client;
  }

  /**
   * Compute theta for a pool.
   */
  async computeTheta(input: ThetaInput): Promise<ToolResult<ThetaOutput>> {
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

      // Fetch funding data
      const funding = await extractor.funding(input.poolId, 24);
      const fundingRate = funding?.fundingrate[0] !== undefined
        ? parseFloat(funding.fundingrate[0])
        : 0;

      if (positions.length === 0) {
        return {
          success: true,
          data: {
            theta: 0,
            dailyFundingCost: 0,
            avgPositionAge: 0,
            fundingRatePerDay: fundingRate * 3, // 3 funding periods per day
            positionsAtRisk: 0,
          },
          toolName: this.name,
          durationMs: Date.now() - startTime,
        };
      }

      // Calculate average position age (in days)
      const now = Date.now() / 1000;
      const positionAges = positions.map((p) => {
        const opened = parseInt(p.timestampOpened) || now;
        return (now - opened) / 86400; // Convert to days
      });
      const avgPositionAge = positionAges.reduce((a, b) => a + b, 0) / positionAges.length;

      // Calculate daily funding cost
      // Funding is typically paid every 8 hours (3 times per day)
      const fundingPeriodsPerDay = 3;
      const fundingRatePerDay = fundingRate * fundingPeriodsPerDay;

      let dailyFundingCost = 0;
      let positionsAtRisk = 0;

      for (const pos of positions) {
        const balanceUSD = parseFloat(pos.balanceUSD) || 0;
        const positionFundingCost = balanceUSD * fundingRatePerDay;

        // Long positions pay positive funding, shorts pay negative
        if (pos.side === 'LONG' && fundingRate > 0) {
          dailyFundingCost += positionFundingCost;
          positionsAtRisk++;
        } else if (pos.side === 'SHORT' && fundingRate < 0) {
          dailyFundingCost += Math.abs(positionFundingCost);
          positionsAtRisk++;
        }
      }

      // Theta = daily cost as percentage of total position value
      const totalValue = positions.reduce((sum, p) => sum + (parseFloat(p.balanceUSD) || 0), 0);
      const theta = totalValue > 0 ? dailyFundingCost / totalValue : 0;

      return {
        success: true,
        data: {
          theta,
          dailyFundingCost,
          avgPositionAge,
          fundingRatePerDay,
          positionsAtRisk,
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

  protected async run(input: ThetaInput): Promise<unknown> {
    return this.computeTheta(input);
  }
}
