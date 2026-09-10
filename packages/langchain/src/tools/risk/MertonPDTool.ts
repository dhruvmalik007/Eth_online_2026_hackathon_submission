import { BaseTool, type ToolResult } from '../BaseTool.js';
import { MertonPDInputSchema, type MertonPDInput } from '../../graphql/schema.js';
import { FnoDataExtractor, type SubgraphClient } from '@ethonline2026/graph-fno-indexer';

/**
 * Merton Probability of Default calculation tool.
 * Implements the Merton structural credit risk model for DeFi positions.
 *
 * The Merton model treats equity as a call option on the firm's assets
 * with strike price equal to the face value of debt.
 */

export interface MertonPDOutput {
  readonly probabilityOfDefault: number;
  readonly distanceToDefault: number;
  readonly assetValue: number;
  readonly debtValue: number;
  readonly assetVolatility: number;
  readonly riskNeutralPD: number;
}

export class MertonPDTool extends BaseTool {
  readonly name = 'mertonPD';
  readonly description = 'Compute Probability of Default using the Merton structural credit model. Analyzes collateral ratios to assess liquidation risk.';
  readonly schema = MertonPDInputSchema;

  private client: SubgraphClient | null = null;

  constructor(client?: SubgraphClient) {
    super();
    this.client = client ?? null;
  }

  setClient(client: SubgraphClient): void {
    this.client = client;
  }

  /**
   * Compute Merton PD for positions in a pool.
   */
  async computeMertonPD(input: MertonPDInput): Promise<ToolResult<MertonPDOutput>> {
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
          success: false,
          error: 'No positions found for PD calculation',
          toolName: this.name,
          durationMs: Date.now() - startTime,
        };
      }

      // Calculate aggregate metrics
      let totalCollateral = 0;
      let totalBalance = 0;
      const collateralRatios: number[] = [];

      for (const pos of positions) {
        const balance = parseFloat(pos.balanceUSD) || 0;
        const collateral = parseFloat(pos.collateralBalanceUSD) || 0;

        totalBalance += balance;
        totalCollateral += collateral;

        if (balance > 0) {
          collateralRatios.push(collateral / balance);
        }
      }

      // Merton model parameters
      const assetValue = totalCollateral; // Assets = collateral
      const debtValue = totalBalance; // Debt = position value
      const riskFreeRate = 0.05; // Assumed risk-free rate (5%)
      const timeToMaturity = 1; // 1 year

      // Calculate asset volatility from collateral ratios
      const avgRatio = collateralRatios.reduce((a, b) => a + b, 0) / collateralRatios.length;
      const variance = collateralRatios.reduce((sum, r) => sum + Math.pow(r - avgRatio, 2), 0) / collateralRatios.length;
      const assetVolatility = Math.sqrt(variance) || 0.2; // Default 20% if no variance

      // Distance to Default (DD)
      // DD = ln(V/D) + (r - σ²/2)T / σ√T
      const distanceToDefault = assetValue > 0 && debtValue > 0
        ? (Math.log(assetValue / debtValue) + (riskFreeRate - Math.pow(assetVolatility, 2) / 2) * timeToMaturity)
        / (assetVolatility * Math.sqrt(timeToMaturity))
        : 0;

      // Probability of Default using normal CDF approximation
      const probabilityOfDefault = this.normalCDF(-distanceToDefault);

      // Risk-neutral PD
      const riskNeutralPD = this.normalCDF(
        -(Math.log(assetValue / debtValue) + (riskFreeRate - Math.pow(assetVolatility, 2) / 2) * timeToMaturity)
        / (assetVolatility * Math.sqrt(timeToMaturity))
      );

      return {
        success: true,
        data: {
          probabilityOfDefault,
          distanceToDefault,
          assetValue,
          debtValue,
          assetVolatility,
          riskNeutralPD,
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
   * Standard normal CDF approximation using Abramowitz and Stegun.
   */
  private normalCDF(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x) / Math.sqrt(2);

    const t = 1.0 / (1.0 + p * absX);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

    return 0.5 * (1.0 + sign * y);
  }

  protected async run(input: MertonPDInput): Promise<unknown> {
    return this.computeMertonPD(input);
  }
}
