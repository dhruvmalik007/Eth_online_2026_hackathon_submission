import { tool } from '@langchain/core/tools';
import * as z from 'zod';
import {
  realizedVolFromHourlyCloses,
  feeApyFromDayData,
  lvr,
  netApy,
  vega,
  volga,
  efficiencyRatio,
  allocateStrategy,
  type StrategyLeg,
} from './fixedIncomeMath.js';

/**
 * Math function table — every fixed-income formula exposed as a verifiable
 * LangChain tool call (walkthrough §4.1, "Math Function Table").
 *
 * Principle: the LLM NEVER does arithmetic. It only supplies typed arguments;
 * the deterministic implementation in fixedIncomeMath.ts computes the result,
 * so every number in the agent's Markdown report is reproducible and auditable
 * from the tool-call trace (Part 2, Level B).
 *
 * UNITS CONTRACT (the tools are the percent boundary; the pure functions are decimal):
 *  - APY inputs/outputs: PERCENT (feeApyPct: 18 = 18%/yr)
 *  - sigma: DECIMAL (0.40 = 40%) — vol is never expressed in percent to avoid unit slips
 *  - fractions (idleFraction w): 0..1
 *  - vega output: percentage-point APY change per +1 vol point (= USD vega = N·v/100)
 *
 * Fee-vol scaling: `feeVolScaling=true` means fee revenue co-moves with volatility
 * (f(σ) = k·σ, k = f_obs/σ estimated at the observed point). Static fees (false)
 * treat feeAPY as vol-independent. The k slope is computed INSIDE the tool from
 * feeApyPct and sigma — the model never derives k itself.
 *
 * All tools are pure — no I/O, no subgraph calls — which is what makes them
 * verifiable: same inputs ⇒ same outputs, golden-tested in
 * test/tools/mathTools.test.ts.
 */

const sigmaField = z.number().min(0).max(10).describe('Annualized realized volatility as a DECIMAL (0.4 = 40%)');
const leverageField = z.number().positive().describe('Capital-efficiency factor L of the concentrated range (1 = full range)');

/** Convert percent APYs to decimals, run the pure math, convert back — in one place. */
function netApyPct(input: {
  sigma: number;
  leverage: number;
  feeApyPct: number;
  feeVolScaling: boolean;
  idleFraction: number;
  lendingApyPct: number;
  gasDragPct: number;
}): { netApyPct: number; feeLegPct: number; lendingLegPct: number; lvrCostPct: number; feeSlopeK: number } {
  const { sigma, leverage, feeApyPct, feeVolScaling, idleFraction, lendingApyPct, gasDragPct } = input;
  const feeApyDec = feeApyPct / 100;
  // Fee-slope convention: EITHER static feeApy OR k·sigma — never both (double count).
  const feeSlopeK = feeVolScaling && sigma > 0 ? feeApyDec / sigma : 0;
  const apyDec = netApy({
    sigma,
    leverage,
    feeApy: feeVolScaling ? 0 : feeApyDec,
    feeSlopeK,
    idleFraction,
    lendingApy: lendingApyPct / 100,
    gasDrag: gasDragPct / 100,
  });
  return {
    netApyPct: apyDec * 100,
    feeLegPct: (1 - idleFraction) * (feeApyDec + feeSlopeK * sigma) * 100,
    lendingLegPct: idleFraction * (lendingApyPct / 100) * 100,
    lvrCostPct: lvr(sigma, leverage) * 100,
    feeSlopeK,
  };
}

/** calc_realized_vol — σ from hourly closes. */
export const calcRealizedVolTool = tool(
  async ({ closes }) => {
    const sigma = realizedVolFromHourlyCloses(closes);
    return JSON.stringify({
      sigma,
      sigmaPct: +(sigma * 100).toFixed(6),
      formula: 'sigma = sqrt(var(log-returns)) * sqrt(24*365)',
      dataPoints: closes.filter((c) => Number.isFinite(c) && c > 0).length,
    });
  },
  {
    name: 'calc_realized_vol',
    description:
      'Compute annualized realized volatility from hourly close prices (log-returns, sqrt(24*365) scaling). Returns 0 when fewer than 3 valid closes — such books must be excluded from strategies.',
    schema: z.object({
      closes: z.array(z.number()).describe('Hourly close prices, oldest first (from v4PoolHourData)'),
    }),
  },
);

/** calc_fee_apy — f = fees_24h / TVL * 365 (decimal); pct mirror provided. */
export const calcFeeApyTool = tool(
  async ({ feesUsd24h, tvlUsd }) => {
    const feeApy = feeApyFromDayData(feesUsd24h, tvlUsd);
    return JSON.stringify({
      feeApyPct: +(feeApy * 100).toFixed(10),
      formula: 'feeAPY = fees24h / TVL * 365',
      guard: tvlUsd <= 0 ? 'non-positive TVL (v4 flash-accounting quirk) — result forced to 0' : null,
    });
  },
  {
    name: 'calc_fee_apy',
    description:
      'Annualized fee yield (in PERCENT) from 24h fees and pool TVL. Guards against zero/negative TVL (v4 subgraph flash-accounting quirk) by returning 0 — exclude such books.',
    schema: z.object({
      feesUsd24h: z.number().describe('Fees accrued in the last 24h, USD (from v4PoolDayData)'),
      tvlUsd: z.number().describe('Current pool TVL, USD (from v4PoolDayData)'),
    }),
  },
);

/** calc_lvr — L²σ²/8, reported in percent. */
export const calcLvrTool = tool(
  async ({ sigma, leverage }) => {
    const cost = lvr(sigma, leverage);
    return JSON.stringify({
      lvrPct: +(cost * 100).toFixed(6),
      formula: 'LVR = L^2 * sigma^2 / 8   (Loss-Versus-Rebalancing, Milionis–Moallemi–Roughgarden)',
    });
  },
  {
    name: 'calc_lvr',
    description:
      'Annualized rebalancing cost (Loss-Versus-Rebalancing, in PERCENT) for a concentrated LP position: L^2 * sigma^2 / 8. This is the fixed-income "credit spread" the book is paid to bear.',
    schema: z.object({ sigma: sigmaField, leverage: leverageField }),
  },
);

/** calc_net_apy — dual-yield decomposition, percent boundary. */
export const calcNetApyTool = tool(
  async ({ sigma, leverage, feeApyPct, feeVolScaling, idleFraction, lendingApyPct, gasDragPct }) => {
    const r = netApyPct({ sigma, leverage, feeApyPct, feeVolScaling, idleFraction, lendingApyPct, gasDragPct: gasDragPct ?? 0 });
    return JSON.stringify({
      netApyPct: +r.netApyPct.toFixed(6),
      formula: 'netAPY% = (1-w)*feeAPY% + w*lendingAPY% − 100·L^2*sigma^2/8 − gasDrag%   (feeAPY% expressed as k·sigma when feeVolScaling)',
      components: {
        feeLegPct: +r.feeLegPct.toFixed(6),
        lendingLegPct: +r.lendingLegPct.toFixed(6),
        lvrCostPct: +r.lvrCostPct.toFixed(6),
        gasDragPct,
      },
      feeSlopeKUsed: +r.feeSlopeK.toFixed(10),
    });
  },
  {
    name: 'calc_net_apy',
    description:
      'Dual-yield net APY (in PERCENT) for a v4 LP book (DualPool-hook aware): trading fees on active capital + lending APY on the hook-swept idle capital − LVR rebalancing cost − gas drag. APYs in percent; sigma in decimal.',
    schema: z.object({
      sigma: sigmaField,
      leverage: leverageField,
      feeApyPct: z.number().describe('Annualized fee yield in PERCENT (from calc_fee_apy)'),
      feeVolScaling: z.boolean().describe('true: fees scale with vol, k = feeAPY/sigma (use for books whose 24h volume tracks vol); false: static fees'),
      idleFraction: z.number().min(0).max(1).describe('Fraction of capital the hook sweeps to lending (0 for unhooked books)'),
      lendingApyPct: z.number().describe('Lending APY on the idle leg in PERCENT (from getLendingReserves)'),
      gasDragPct: z.number().optional().describe('Gas+ops drag in percent of notional per year (default 0)'),
    }),
  },
);

/** calc_vega — k − L²σ/4, reported per vol point in pp + USD. */
export const calcVegaTool = tool(
  async ({ sigma, leverage, feeApyPct, feeVolScaling, notionalUsd }) => {
    const feeSlopeK = feeVolScaling && sigma > 0 ? feeApyPct / 100 / sigma : 0;
    const v = vega({ sigma, leverage, feeSlopeK });
    return JSON.stringify({
      vegaPctPerVolPoint: +v.toFixed(10),
      vegaDecimalPerUnitSigma: +v.toFixed(10),
      volgaDecimalPerUnitSigmaSquared: +volga(leverage).toFixed(10),
      usdPerVolPoint: notionalUsd !== undefined ? +((v / 100) * notionalUsd).toFixed(2) : null,
      formula: 'vega = k - L^2*sigma/4 (k = feeAPY/sigma when feeVolScaling, else 0) ; volga = -L^2/4',
      interpretation:
        'vegaPctPerVolPoint = net-APY percentage-point change per +1 percentage point of annualized volatility. Negative ⇒ short-vol. usdPerVolPoint = annualized USD P&L per +1 vol point on notionalUsd.',
    });
  },
  {
    name: 'calc_vega',
    description:
      'Vega of the dual-yield APY with respect to volatility: k − L²σ/4 (k computed internally from feeApyPct when feeVolScaling, else 0; volga −L²/4). Negative ⇒ the book is short-vol. Returns pp-per-vol-point and USD per vol point on the given notional.',
    schema: z.object({
      sigma: sigmaField,
      leverage: leverageField,
      feeApyPct: z.number().describe('Annualized fee yield in PERCENT (used to derive k when feeVolScaling)'),
      feeVolScaling: z.boolean().describe('true: fees scale with vol (k = feeAPY/sigma); false: static fees, purely short-vol'),
      notionalUsd: z.number().optional().describe('Position notional in USD — if given, returns usdPerVolPoint'),
    }),
  },
);

/** calc_efficiency_ratio — η = netAPY / LVR, unitless. */
export const calcEfficiencyRatioTool = tool(
  async ({ sigma, leverage, feeApyPct, feeVolScaling, idleFraction, lendingApyPct }) => {
    const feeSlopeK = feeVolScaling && sigma > 0 ? feeApyPct / 100 / sigma : 0;
    const eta = efficiencyRatio({
      sigma,
      leverage,
      feeApy: feeVolScaling ? 0 : feeApyPct / 100,
      feeSlopeK,
      idleFraction,
      lendingApy: lendingApyPct / 100,
    });
    return JSON.stringify({
      efficiencyRatio: Number.isFinite(eta) ? +eta.toFixed(10) : 'Infinity (zero LVR — e.g. static-fee stable book with sigma=0)',
      formula: 'eta = netAPY / LVR = 8*netAPY / (L^2*sigma^2)',
      interpretation: 'eta > 1 ⇒ yield more than compensates the vol-bleed; allocation weights are proportional to eta.',
    });
  },
  {
    name: 'calc_efficiency_ratio',
    description:
      'Fixed-Income Efficiency Ratio: net APY per unit of LVR bleed (unitless). Books with higher eta receive proportionally more capital in the allocation.',
    schema: z.object({
      sigma: sigmaField,
      leverage: leverageField,
      feeApyPct: z.number(),
      feeVolScaling: z.boolean(),
      idleFraction: z.number().min(0).max(1),
      lendingApyPct: z.number(),
    }),
  },
);

/** calc_allocation — portfolio weights under APR + vega constraints. */
const legSchema = z.object({
  poolId: z.string(),
  pair: z.string(),
  hook: z.string().nullable().optional(),
  sigma: z.number().min(0).describe('DECIMAL'),
  leverage: z.number().positive(),
  feeApyPct: z.number().describe('PERCENT'),
  feeVolScaling: z.boolean(),
  idleFraction: z.number().min(0).max(1),
  lendingApyPct: z.number().describe('PERCENT'),
  volumeUsd: z.number(),
});

export const calcAllocationTool = tool(
  async ({ legs, minApr, vegaBudget, sizeUsd, minVolumeUsd }) => {
    // Percent → decimal boundary before the pure allocator (minApr is PERCENT too).
    const decimalLegs: StrategyLeg[] = legs.map((l) => ({
      poolId: l.poolId,
      pair: l.pair,
      hook: l.hook ?? null,
      sigma: l.sigma,
      leverage: l.leverage,
      feeApy: l.feeVolScaling ? 0 : l.feeApyPct / 100,
      feeSlopeK: l.feeVolScaling && l.sigma > 0 ? l.feeApyPct / 100 / l.sigma : 0,
      idleFraction: l.idleFraction,
      lendingApy: l.lendingApyPct / 100,
      volumeUsd: l.volumeUsd,
    }));

    const result = allocateStrategy(decimalLegs, {
      minApr: minApr / 100,
      vegaBudget,
      sizeUsd,
      ...(minVolumeUsd !== undefined ? { minVolumeUsd } : {}),
    });

    // Decimal → percent boundary on the way out.
    return JSON.stringify({
      strategy: {
        legs: result.legs.map((l) => ({
          ...l,
          netApyPct: +(l.netApy * 100).toFixed(6),
          lvrPct: +(l.lvr * 100).toFixed(6),
          vegaPctPerVolPoint: +l.vega.toFixed(10),
          vegaUsdPerVolPoint: +((l.vega / 100) * l.notionalUsd).toFixed(2),
          weightPct: +(l.weight * 100).toFixed(4),
        })),
        achievedAprPct: +(result.achievedApr * 100).toFixed(6),
        portfolioVegaPctPerVolPoint: +result.portfolioVega.toFixed(10),
        maxConcentrationPct: +(result.maxConcentration * 100).toFixed(4),
        meetsAprTarget: result.meetsAprTarget,
        withinVegaBudget: result.withinVegaBudget,
      },
      constraints: { minApr, vegaBudget, sizeUsd, minVolumeUsd },
      excluded: result.excluded,
      math: {
        netApy: '(1-w)*feeAPY + w*lendingAPY − L^2*sigma^2/8 − gasDrag (feeAPY as k·sigma when feeVolScaling)',
        vega: 'k − L^2*sigma/4 (per unit sigma; /100 per vol point)',
        lvr: 'L^2*sigma^2/8',
        weights: 'proportional to Fixed-Income Efficiency Ratio = netAPY / LVR',
      },
    });
  },
  {
    name: 'calc_allocation',
    description:
      'Portfolio allocation under trader constraints: filter books by min net APR + vega budget + volume floor, then weight proportionally to the Fixed-Income Efficiency Ratio. APYs in percent, sigma in decimal. Returns weights, per-leg Greeks, exclusions with reasons, and target/budget flags.',
    schema: z.object({
      legs: z.array(legSchema).describe('Candidate books with per-book metrics (from calc_net_apy / calc_vega inputs)'),
      minApr: z.number().describe('Required portfolio net APR in percent (e.g. 6)'),
      vegaBudget: z.number().describe('Max |vega| per unit sigma per book (e.g. 0.5)'),
      sizeUsd: z.number().positive().describe('Total notional in USD'),
      minVolumeUsd: z.number().optional().describe('Minimum cumulative volume floor (default 0)'),
    }),
  },
);

/** The full math function table — registered on the DeepGraphAgent. */
export function createMathTools() {
  return [
    calcRealizedVolTool,
    calcFeeApyTool,
    calcLvrTool,
    calcNetApyTool,
    calcVegaTool,
    calcEfficiencyRatioTool,
    calcAllocationTool,
  ];
}
