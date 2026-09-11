import { BaseTool, type ToolResult } from '../BaseTool.js';
import { MertonPDInputSchema, type MertonPDInput } from '../../graphql/schema.js';
import { FnoDataExtractor, type SubgraphClient } from '@ethonline2026/graph-fno-indexer';
import { deriveRiskAdjustment, rate } from '@ethonline2026/risk-analysis-data-pipeline';
import type { RiskProfileReader } from '@ethonline2026/risk-analysis-data-pipeline';

/**
 * Merton Probability of Default calculation tool.
 * Implements the Merton structural credit risk model for DeFi positions.
 *
 * The Merton model treats equity as a call option on the firm's assets with
 * strike price equal to the face value of debt.
 *
 * ## Where the risk parameters come from
 *
 * Before a risk layer existed, three parameters were invented here: a 5%
 * risk-free rate, a 20% fallback volatility, and a "volatility" derived from the
 * *dispersion of collateral ratios* — which is a measure of how uneven the
 * positions are, not of how much the asset moves. Those values are still the
 * fallbacks, so a run without risk data behaves exactly as it did.
 *
 * When the caller names a chain and a risk snapshot exists, the parameters come
 * from the deterministic derivation in `@ethonline2026/risk-analysis-data-pipeline`
 * instead, and each is applied to the term it actually governs:
 *
 *  - `riskFreeRate` replaces the hardcoded 0.05.
 *  - `collateralHaircut` scales recoverable collateral, which is what a haircut
 *    is for, so the asset value entering the model is the *recoverable* one.
 *  - `pdLoad` multiplies the structural PD, as its contract states.
 *  - `volatility` replaces the collateral-ratio proxy, because a derived
 *    volatility is an observation where the proxy was a guess.
 *
 * `riskInputs` in the output names which source was used for each parameter, so
 * a PD can be traced to its inputs rather than taken on trust.
 */

export interface MertonPDOutput {
  readonly probabilityOfDefault: number;
  readonly distanceToDefault: number;
  readonly assetValue: number;
  readonly debtValue: number;
  readonly assetVolatility: number;
  readonly riskNeutralPD: number;
  /** Which source supplied each parameter — `derived` or `default`. */
  readonly riskInputs: {
    readonly riskFreeRate: number;
    readonly volatilitySource: 'derived' | 'collateral-ratio-proxy';
    readonly riskFreeRateSource: 'derived' | 'default';
    readonly collateralHaircutApplied: number;
    readonly pdLoadApplied: number;
    readonly chain: string | null;
  };
}

/** The documented defaults, used when no risk adjustment is available. */
const DEFAULT_RISK_FREE_RATE = 0.05;
const DEFAULT_ASSET_VOLATILITY = 0.2;

export class MertonPDTool extends BaseTool {
  readonly name = 'mertonPD';
  readonly description =
    'Compute Probability of Default using the Merton structural credit model. Analyzes ' +
    'collateral ratios to assess liquidation risk, applying chain-level risk parameters ' +
    '(risk-free rate, collateral haircut, PD load) when a chain is named.';
  readonly schema = MertonPDInputSchema;

  private client: SubgraphClient | null = null;
  private riskReader: RiskProfileReader | undefined;

  constructor(client?: SubgraphClient, riskReader?: RiskProfileReader) {
    super();
    this.client = client ?? null;
    this.riskReader = riskReader;
  }

  setClient(client: SubgraphClient): void {
    this.client = client;
  }

  /**
   * Attach the risk snapshot reader.
   *
   * Optional: without it the tool uses its documented defaults, which is the
   * behaviour it had before the risk layer existed.
   *
   * @param reader - The snapshot reader.
   */
  setRiskReader(reader: RiskProfileReader): void {
    this.riskReader = reader;
  }

  /**
   * Compute Merton PD for positions in a pool.
   *
   * @param input - The pool, and optionally the chain whose derived risk
   *   parameters should be applied.
   * @returns The PD, distance to default, and the provenance of each parameter.
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

      // Derived risk parameters, when a chain was named and has a snapshot. The
      // lookup is best-effort: an unavailable store leaves the defaults in place
      // rather than failing a PD that would otherwise be computable.
      const derived = await this.riskParameters(input.chain);

      // Assets = recoverable collateral. A haircut is a multiplier on
      // recoverable value, so it is applied here rather than to the debt.
      const assetValue = totalCollateral * derived.collateralHaircut;
      const debtValue = totalBalance;
      const riskFreeRate = derived.riskFreeRate;
      const timeToMaturity = 1; // 1 year

      // Volatility: the derived one is an observation; the collateral-ratio
      // dispersion is a proxy that measures position evenness. Prefer the
      // observation, and name which was used.
      const avgRatio = collateralRatios.reduce((a, b) => a + b, 0) / collateralRatios.length;
      const variance =
        collateralRatios.reduce((sum, r) => sum + Math.pow(r - avgRatio, 2), 0) /
        collateralRatios.length;
      const proxyVolatility = Math.sqrt(variance) || DEFAULT_ASSET_VOLATILITY;
      const assetVolatility = derived.volatility ?? proxyVolatility;

      // Distance to Default (DD)
      // DD = ln(V/D) + (r - σ²/2)T / σ√T
      const distanceToDefault =
        assetValue > 0 && debtValue > 0
          ? (Math.log(assetValue / debtValue) +
              (riskFreeRate - Math.pow(assetVolatility, 2) / 2) * timeToMaturity) /
            (assetVolatility * Math.sqrt(timeToMaturity))
          : 0;

      // Probability of Default using normal CDF approximation, loaded by the
      // chain's risk regime: the load is >= 1 and only ever increases the PD.
      const structuralPD = this.normalCDF(-distanceToDefault);
      const probabilityOfDefault = Math.min(1, structuralPD * derived.pdLoad);

      // Risk-neutral PD
      const riskNeutralPD = this.normalCDF(
        -(Math.log(assetValue / debtValue) +
          (riskFreeRate - Math.pow(assetVolatility, 2) / 2) * timeToMaturity) /
          (assetVolatility * Math.sqrt(timeToMaturity)),
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
          riskInputs: {
            riskFreeRate,
            volatilitySource: derived.volatility === null ? 'collateral-ratio-proxy' : 'derived',
            riskFreeRateSource: derived.riskFreeRateSource,
            collateralHaircutApplied: derived.collateralHaircut,
            pdLoadApplied: derived.pdLoad,
            chain: derived.chain,
          },
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
   * Resolve the derived risk parameters for a chain, or the documented defaults.
   *
   * Every fallback is the value this tool used before the risk layer existed, so
   * an unavailable or unnamed chain reproduces the previous behaviour exactly.
   *
   * @param chainSlug - The chain to derive for, when the caller named one.
   * @returns The four parameters plus which source supplied each.
   */
  private async riskParameters(chainSlug: string | undefined): Promise<{
    readonly riskFreeRate: number;
    readonly riskFreeRateSource: 'derived' | 'default';
    readonly volatility: number | null;
    readonly collateralHaircut: number;
    readonly pdLoad: number;
    readonly chain: string | null;
  }> {
    const defaults = {
      riskFreeRate: DEFAULT_RISK_FREE_RATE,
      riskFreeRateSource: 'default' as const,
      volatility: null,
      collateralHaircut: 1,
      pdLoad: 1,
      chain: null,
    };

    if (chainSlug === undefined || this.riskReader === undefined) return defaults;

    try {
      const loaded = await this.riskReader.chain(chainSlug);
      if (loaded === null) return defaults;

      const adjustment = deriveRiskAdjustment({
        chainScores: loaded.value.riskScores,
        realizedVolatility: null,
        baseRiskFreeRate: rate(DEFAULT_RISK_FREE_RATE),
      });

      return {
        riskFreeRate: adjustment.riskFreeRate,
        // Named by provenance rather than inferred by comparing to the default:
        // a derived premium can legitimately be zero, and comparing values would
        // then mislabel a derived rate as a fallback.
        riskFreeRateSource: 'derived',
        volatility: adjustment.volatility,
        collateralHaircut: adjustment.collateralHaircut,
        pdLoad: adjustment.pdLoad,
        chain: loaded.value.slug,
      };
    } catch {
      // A failed snapshot read must not fail a PD that is otherwise computable;
      // the output records which source was used, so the fallback is visible.
      return defaults;
    }
  }

  /**
   * Standard normal CDF approximation using Abramowitz and Stegun.
   *
   * @param x - The point to evaluate.
   * @returns The cumulative probability.
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
    const y =
      1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

    return 0.5 * (1.0 + sign * y);
  }

  protected async run(input: MertonPDInput): Promise<unknown> {
    return this.computeMertonPD(input);
  }
}
