import { BaseTool, type ToolResult } from '../BaseTool.js';
import { StressTestInputSchema, type StressTestInput } from '../../graphql/schema.js';
import {
  FnoDataExtractor,
  type SubgraphClient,
  type ProtocolSnapshot,
  type FundingSnapshot,
} from '@ethonline2026/graph-fno-indexer';

/**
 * Stress test tool.
 * Runs scenario analysis with custom shocks on protocol positions.
 *
 * Scenarios from SYSTEM_DESIGN.md §7.3:
 * - Flash Crash: ETH -30%, BTC -25%
 * - Rate Hike: +200bp rate shock
 * - DeFi Hack: Protocol TVL -50%
 * - Stablecoin Depeg: USDT -5%
 * - Regulatory Ban: CEX shutdown
 * - Correlation Spike: Cross-asset correlation 0.95
 */

export interface StressScenario {
  readonly name: string;
  readonly description: string;
  readonly shocks: Record<string, number>;
}

export interface StressTestResult {
  readonly scenario: string;
  readonly pnlImpact: number;
  readonly newTVL: number;
  readonly breachLevel: 'none' | 'warning' | 'critical' | 'liquidation';
  readonly details: Record<string, number>;
}

export interface StressTestOutput {
  readonly results: StressTestResult[];
  readonly baseTVL: number;
  readonly worstCase: StressTestResult;
  readonly scenariosTested: string[];
}

export class StressTestTool extends BaseTool {
  readonly name = 'stressTest';
  readonly description = 'Run stress test scenarios on protocol positions. Tests flash crash, rate hike, DeFi hack, stablecoin depeg, regulatory ban, and correlation spike scenarios.';
  readonly schema = StressTestInputSchema;

  private client: SubgraphClient | null = null;

  constructor(client?: SubgraphClient) {
    super();
    this.client = client ?? null;
  }

  setClient(client: SubgraphClient): void {
    this.client = client;
  }

  /**
   * Run stress tests for a protocol.
   */
  async runStressTests(input: StressTestInput): Promise<ToolResult<StressTestOutput>> {
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
      // Fetch protocol data
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

      const baseTVL = parseFloat(protocol.totalValueLockedUSD) || 0;

      // Fetch funding data if pool specified (1 week of hourly snapshots)
      let funding: FundingSnapshot | null = null;
      if (input.poolId) {
        funding = await extractor.funding(input.poolId, 168);
      }

      // Define scenarios
      const scenarios = this.getScenarios(input.scenarios);

      // Run each scenario
      const results: StressTestResult[] = scenarios.map((scenario) =>
        this.runScenario(scenario, baseTVL, protocol, funding),
      );

      // Find worst case
      const worstCase = results.reduce((worst, current) =>
        Math.abs(current.pnlImpact) > Math.abs(worst.pnlImpact) ? current : worst,
      );

      return {
        success: true,
        data: {
          results,
          baseTVL,
          worstCase,
          scenariosTested: scenarios.map((s) => s.name),
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

  private getScenarios(scenarioNames: string[]): StressScenario[] {
    const allScenarios: Record<string, StressScenario> = {
      'flash-crash': {
        name: 'Flash Crash',
        description: 'ETH -30%, BTC -25%, spread widening 5%',
        shocks: { price: -0.30, spread: 0.05, volatility: 2.0 },
      },
      'rate-hike': {
        name: 'Rate Hike',
        description: '+200bp rate shock, yield steepening 100bp',
        shocks: { rate: 0.02, yieldSteepening: 0.01, creditWidening: 0.02 },
      },
      'defi-hack': {
        name: 'DeFi Hack',
        description: 'Protocol TVL -50%, contagion effect',
        shocks: { tvl: -0.50, contagion: 0.3, confidence: -0.4 },
      },
      'stablecoin-depeg': {
        name: 'Stablecoin Depeg',
        description: 'USDT -5%, flight to quality',
        shocks: { stablecoin: -0.05, flightToQuality: 0.2, liquidity: -0.3 },
      },
      'regulatory-ban': {
        name: 'Regulatory Ban',
        description: 'CEX shutdown, liquidity crisis',
        shocks: { liquidity: -0.5, cexVolume: -0.8, uncertainty: 0.6 },
      },
      'correlation-spike': {
        name: 'Correlation Spike',
        description: 'Cross-asset correlation 0.95, vol regime crisis',
        shocks: { correlation: 0.95, volMultiplier: 3.0, diversification: -0.7 },
      },
    };

    return scenarioNames.map((name) => allScenarios[name]).filter(Boolean) as StressScenario[];
  }

  private runScenario(
    scenario: StressScenario,
    baseTVL: number,
    protocol: ProtocolSnapshot,
    funding: FundingSnapshot | null,
  ): StressTestResult {
    const longOI = parseFloat(protocol.longOpenInterestUSD) || 0;
    const shortOI = parseFloat(protocol.shortOpenInterestUSD) || 0;

    let pnlImpact = 0;
    const details: Record<string, number> = {};

    // Apply shocks based on scenario type
    if (scenario.shocks.price) {
      // Price shock affects OI
      const priceShock = scenario.shocks.price;
      const longPnL = longOI * priceShock;
      const shortPnL = -shortOI * priceShock;
      pnlImpact = longPnL + shortPnL;
      details.longPnL = longPnL;
      details.shortPnL = shortPnL;
    }

    if (scenario.shocks.rate) {
      // Rate shock affects funding costs
      const rateShock = scenario.shocks.rate;
      const fundingImpact = (funding ? parseFloat(funding.totalValueLockedUSD) : baseTVL) * rateShock;
      pnlImpact -= fundingImpact;
      details.fundingImpact = -fundingImpact;
    }

    if (scenario.shocks.tvl) {
      // TVL shock directly impacts protocol value
      const tvlShock = scenario.shocks.tvl;
      const tvlImpact = baseTVL * tvlShock;
      pnlImpact += tvlImpact;
      details.tvlImpact = tvlImpact;
    }

    if (scenario.shocks.liquidity) {
      // Liquidity shock increases slippage
      const liquidityShock = scenario.shocks.liquidity;
      const slippageImpact = baseTVL * liquidityShock * 0.01; // 1% slippage per liquidity unit
      pnlImpact -= Math.abs(slippageImpact);
      details.slippageImpact = -Math.abs(slippageImpact);
    }

    // Calculate new TVL
    const newTVL = baseTVL + pnlImpact;

    // Determine breach level
    const pnlPercent = Math.abs(pnlImpact) / (baseTVL || 1);
    let breachLevel: 'none' | 'warning' | 'critical' | 'liquidation' = 'none';
    if (pnlPercent > 0.5) breachLevel = 'liquidation';
    else if (pnlPercent > 0.3) breachLevel = 'critical';
    else if (pnlPercent > 0.1) breachLevel = 'warning';

    return {
      scenario: scenario.name,
      pnlImpact,
      newTVL,
      breachLevel,
      details,
    };
  }

  protected async run(input: StressTestInput): Promise<unknown> {
    return this.runStressTests(input);
  }
}
