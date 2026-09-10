import { BaseTool, type ToolResult } from '../BaseTool.js';
import { RhoInputSchema, type RhoInput } from '../../graphql/schema.js';
import { FnoDataExtractor, type SubgraphClient } from '@ethonline2026/graph-fno-indexer';

/**
 * Rho calculation tool.
 * Computes position rho: ρ = ∂PositionValue/∂r
 *
 * For DeFi: measures sensitivity to interest rate changes.
 * Relevant for lending protocols where rates affect borrowing costs
 * and lending yields.
 */

export interface RhoOutput {
  readonly rho: number;
  readonly rateSensitivity: number;
  readonly tvl: number;
  readonly borrowYieldImpact: number;
  readonly lendYieldImpact: number;
  readonly rateShiftBasisPoints: number;
}

export class RhoTool extends BaseTool {
  readonly name = 'rho';
  readonly description = 'Compute position rho (ρ) — sensitivity to interest rate changes. Measures impact of rate shifts on protocol TVL and yields.';
  readonly schema = RhoInputSchema;

  private client: SubgraphClient | null = null;

  constructor(client?: SubgraphClient) {
    super();
    this.client = client ?? null;
  }

  setClient(client: SubgraphClient): void {
    this.client = client;
  }

  /**
   * Compute rho for a protocol/pool.
   */
  async computeRho(input: RhoInput): Promise<ToolResult<RhoOutput>> {
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
      // Fetch protocol snapshot (funding feed not consumed by rho math — dead
      // fetch removed in the template migration)
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

      const tvl = parseFloat(protocol.totalValueLockedUSD) || 0;
      const rateShiftBps = input.rateShiftBasisPoints;
      const rateShiftDecimal = rateShiftBps / 10000;

      // Calculate rate sensitivity based on TVL and open interest
      const longOI = parseFloat(protocol.longOpenInterestUSD) || 0;
      const shortOI = parseFloat(protocol.shortOpenInterestUSD) || 0;
      const totalOI = longOI + shortOI;

      // Rho approximation: sensitivity of TVL to rate changes
      // Higher OI relative to TVL = higher rate sensitivity
      const oiRatio = tvl > 0 ? totalOI / tvl : 0;
      const rateSensitivity = oiRatio * rateShiftDecimal;

      // Impact on borrow/lend yields
      // Rate increase benefits lenders, hurts borrowers
      const borrowYieldImpact = -rateShiftDecimal * (shortOI / (tvl || 1));
      const lendYieldImpact = rateShiftDecimal * (1 - oiRatio);

      // Rho = expected change in position value per 1% rate change
      const rho = tvl * rateSensitivity;

      return {
        success: true,
        data: {
          rho,
          rateSensitivity,
          tvl,
          borrowYieldImpact,
          lendYieldImpact,
          rateShiftBasisPoints: rateShiftBps,
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

  protected async run(input: RhoInput): Promise<unknown> {
    return this.computeRho(input);
  }
}
