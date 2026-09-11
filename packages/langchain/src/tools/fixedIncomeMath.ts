/**
 * Fixed-income math for Uniswap v4 LP books (dual-hook aware).
 *
 * Pure functions only — no I/O — so every formula is unit-testable against
 * golden values (see test/tools/fixedIncomeMath.test.ts). The math tool table
 * (mathTools.ts) and the strategy tool (V4FixedIncomeStrategyTool.ts) feed
 * these functions with live subgraph data.
 *
 * Quant-library attribution (per the LangChain Greeks reference):
 * this module is the TypeScript analog of the `black-scholes` package — the
 * single source of truth for the LP-specific greeks (LVR, dual-yield vega)
 * that no off-the-shelf options library covers. Statistical primitives
 * (variance) are delegated to `mathjs` exactly as the reference prescribes,
 * so the distribution math is reference-implementation backed, not hand-rolled.
 * (When options Greeks land — SUBGRAPH_SPEC.md Phase 6, Derivatives Options —
 * the `black-scholes` package joins this table for Black-Scholes d1/d2 math.)
 *
 * ⚠️ UNITS: every function here is strictly DECIMAL. APY rates are fractions
 * (0.18 = 18%/yr), sigma is decimal (0.40 = 40%), outputs are fractions.
 * The calc_* LangChain tools are the PERCENT boundary for the LLM — they
 * convert at the edge so the model never does unit arithmetic.
 *
 * Yield decomposition per book (annualized, per dollar of notional):
 *
 *   APY_i = (1 - w) * f_i + w * r_i  -  L^2 * sigma^2 / 8  -  g
 *            \--- trading fees ---/  \- lending leg -/  \- LVR -/   \- gas drag
 *
 *   LVR (Loss-Versus-Rebalancing) = L^2 * sigma^2 / 8
 *     - full-range LP loses sigma^2/8 per year vs a rebalanced HODL (Milionis–Moallemi–Roughgarden)
 *     - a concentrated position with capital-efficiency L multiplies the bleed by L^2
 *
 * Vega (sensitivity of APY to volatility), with fee yield f = k * sigma:
 *
 *   vega = dAPY/dsigma = k - L^2 * sigma / 4          [APY fraction per unit sigma]
 *   vega per +1 vol point (Delta sigma = 0.01) = vega / 100  [APY fraction]
 *   USD vega per vol point = N * vega / 100
 *
 * Volga (second order): d^2APY/dsigma^2 = -L^2 / 4  (bleed accelerates quadratically).
 *
 * Fee-slope convention: pass EITHER a static feeApy (feeSlopeK=0) OR express fees
 * vol-scaled via feeSlopeK = feeApy/sigma with feeApy=0 — never both (double count).
 */

/**
 * Annualized realized volatility from hourly closes (log-returns, sqrt(24*365) scaling).
 *
 * NOTE ON mathjs: we verified `variance(x, 'biased')` (mathjs 14) normalizes by n+1,
 * not n — e.g. variance([2,4,6,8],'biased') = 4 while the population variance is 5.
 * The LVR derivation needs the plain second moment (divide by N), so the explicit
 * computation below is the source of truth. mathjs remains the dependency for
 * future stat extensions (fee-slope regression, matrix ops) where its semantics
 * are unambiguous.
 */
export function realizedVolFromHourlyCloses(closes: number[]): number {
  const clean = closes.filter((c) => Number.isFinite(c) && c > 0);
  if (clean.length < 3) return 0;

  const rets: number[] = [];
  for (let i = 1; i < clean.length; i++) {
    rets.push(Math.log(clean[i]! / clean[i - 1]!));
  }
  // Population (N-normalized) variance — the second moment the LVR formula assumes.
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varOfReturns = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length;
  return Math.sqrt(varOfReturns) * Math.sqrt(24 * 365);
}

/** Annualized fee yield from 24h fees and TVL: f = fees_24h / TVL * 365. */
export function feeApyFromDayData(feesUsd24h: number, tvlUsd: number): number {
  if (!Number.isFinite(feesUsd24h) || !Number.isFinite(tvlUsd) || tvlUsd <= 0) return 0;
  return (feesUsd24h / tvlUsd) * 365;
}

/** Loss-versus-rebalancing annualized cost for a concentrated position: L^2 * sigma^2 / 8. */
export function lvr(sigma: number, leverage: number): number {
  if (sigma < 0 || leverage <= 0) return 0;
  return (leverage * leverage * sigma * sigma) / 8;
}

/**
 * Dual-yield net APY (see module docstring).
 * @param feeSlopeK  d(feeAPY)/d(sigma) — fee revenue scales with volume, hence with vol.
 *                   Pass 0 to treat fees as vol-independent (conservative).
 */
export function netApy(input: {
  sigma: number;
  leverage: number;
  feeApy: number;
  feeSlopeK?: number;
  idleFraction: number;
  lendingApy: number;
  gasDrag?: number;
}): number {
  const { sigma, leverage, feeApy, feeSlopeK = 0, idleFraction, lendingApy, gasDrag = 0 } = input;
  const fees = (1 - idleFraction) * (feeApy + feeSlopeK * sigma);
  const lending = idleFraction * lendingApy;
  return fees + lending - lvr(sigma, leverage) - gasDrag;
}

/**
 * Vega of the net APY with respect to sigma:  k - L^2 * sigma / 4.
 * Returns the per-unit-sigma value; divide by 100 for per-vol-point, multiply by
 * notional for USD vega.
 */
export function vega(input: { sigma: number; leverage: number; feeSlopeK?: number }): number {
  const { sigma, leverage, feeSlopeK = 0 } = input;
  if (sigma < 0 || leverage <= 0) return 0;
  return feeSlopeK - (leverage * leverage * sigma) / 4;
}

/** Volga: d(vega)/d(sigma) = -L^2 / 4. Negative ⇒ bleed accelerates as vol rises. */
export function volga(leverage: number): number {
  return -(leverage * leverage) / 4;
}

/** Fixed-Income Efficiency Ratio: net APY per unit of LVR bleed. >1 ⇒ positively carried. */
export function efficiencyRatio(input: {
  sigma: number;
  leverage: number;
  feeApy: number;
  feeSlopeK?: number;
  idleFraction: number;
  lendingApy: number;
}): number {
  const bleed = lvr(input.sigma, input.leverage);
  const apy = netApy({ ...input, gasDrag: 0 });
  if (bleed <= 0) return apy > 0 ? Number.POSITIVE_INFINITY : 0;
  return apy / bleed;
}

export interface StrategyLeg {
  readonly poolId: string;
  readonly pair: string;
  readonly hook: string | null;
  readonly sigma: number;
  readonly leverage: number;
  readonly feeApy: number;
  readonly feeSlopeK: number;
  readonly idleFraction: number;
  readonly lendingApy: number;
  readonly volumeUsd: number;
}

export interface StrategyLegResult {
  readonly poolId: string;
  readonly pair: string;
  readonly hook: string | null;
  readonly weight: number;
  readonly netApy: number;
  readonly lvr: number;
  readonly vega: number;
  readonly efficiency: number;
  readonly notionalUsd: number;
}

export interface StrategyResult {
  readonly legs: StrategyLegResult[];
  readonly achievedApr: number;
  readonly portfolioVega: number;
  readonly maxConcentration: number;
  readonly sizeUsd: number;
  readonly minApr: number;
  readonly vegaBudget: number;
  readonly meetsAprTarget: boolean;
  readonly withinVegaBudget: boolean;
  readonly excluded: Array<{ poolId: string; pair: string; reason: string }>;
}

/**
 * APR-constrained, vega-budgeted, min-risk allocation (walkthrough §3.3):
 *  1. filter: netApy >= minApr AND |vega| <= vegaBudget AND sigma series valid AND volume floor
 *  2. weight proportional to efficiency ratio (least vol-fragile books get the most capital)
 *  3. report achieved APR, portfolio vega, concentration
 */
export function allocateStrategy(
  legs: StrategyLeg[],
  constraints: { minApr: number; vegaBudget: number; sizeUsd: number; minVolumeUsd?: number },
): StrategyResult {
  const { minApr, vegaBudget, sizeUsd, minVolumeUsd = 0 } = constraints;

  const excluded: StrategyResult['excluded'] = [];
  const eligible: Array<{ leg: StrategyLeg; netApy: number; vega: number; efficiency: number }> = [];

  for (const leg of legs) {
    if (leg.sigma <= 0) {
      excluded.push({ poolId: leg.poolId, pair: leg.pair, reason: 'no valid hourly price series (cannot compute sigma)' });
      continue;
    }
    if (leg.volumeUsd < minVolumeUsd) {
      excluded.push({ poolId: leg.poolId, pair: leg.pair, reason: `volume $${leg.volumeUsd.toFixed(0)} below floor $${minVolumeUsd}` });
      continue;
    }
    const apy = netApy(leg);
    const v = vega(leg);
    if (apy < minApr) {
      excluded.push({ poolId: leg.poolId, pair: leg.pair, reason: `net APY ${apy.toFixed(2)}% below target ${minApr}%` });
      continue;
    }
    if (Math.abs(v) > vegaBudget) {
      excluded.push({ poolId: leg.poolId, pair: leg.pair, reason: `vega ${v.toFixed(3)}/unit-sigma exceeds budget ${vegaBudget}` });
      continue;
    }
    eligible.push({ leg, netApy: apy, vega: v, efficiency: efficiencyRatio(leg) });
  }

  if (eligible.length === 0) {
    return {
      legs: [],
      achievedApr: 0,
      portfolioVega: 0,
      maxConcentration: 0,
      sizeUsd,
      minApr,
      vegaBudget,
      meetsAprTarget: false,
      withinVegaBudget: true,
      excluded,
    };
  }

  // Weight ∝ efficiency ratio; guard against negative/infinite efficiencies.
  const weightsRaw = eligible.map((e) => Math.max(e.efficiency, 0));
  const total = weightsRaw.reduce((a, b) => a + b, 0);

  const legsOut: StrategyLegResult[] = eligible.map((e, idx) => {
    const weight = total > 0 ? weightsRaw[idx]! / total : 1 / eligible.length;
    return {
      poolId: e.leg.poolId,
      pair: e.leg.pair,
      hook: e.leg.hook,
      weight,
      netApy: e.netApy,
      lvr: lvr(e.leg.sigma, e.leg.leverage),
      vega: e.vega,
      efficiency: e.efficiency,
      notionalUsd: weight * sizeUsd,
    };
  });

  const achievedApr = legsOut.reduce((s, l) => s + l.weight * l.netApy, 0);
  const portfolioVega = legsOut.reduce((s, l) => s + l.weight * l.vega, 0);
  const maxConcentration = legsOut.reduce((m, l) => Math.max(m, l.weight), 0);

  return {
    legs: legsOut,
    achievedApr,
    portfolioVega,
    maxConcentration,
    sizeUsd,
    minApr,
    vegaBudget,
    meetsAprTarget: achievedApr >= minApr,
    withinVegaBudget: Math.abs(portfolioVega) <= vegaBudget,
    excluded,
  };
}
