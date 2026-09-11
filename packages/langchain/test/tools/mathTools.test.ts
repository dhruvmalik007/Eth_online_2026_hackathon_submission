import { describe, it, expect } from 'vitest';
import {
  calcRealizedVolTool,
  calcFeeApyTool,
  calcLvrTool,
  calcNetApyTool,
  calcVegaTool,
  calcEfficiencyRatioTool,
  calcAllocationTool,
  createMathTools,
} from '../../src/tools/mathTools.js';

/**
 * The math function table is the agent's source of arithmetic truth.
 * These tests invoke the TOOLS exactly as the LLM would (invoke → JSON.parse)
 * so the function table itself is verified, not just the underlying pure functions.
 *
 * UNITS CONTRACT (tested here): APYs in PERCENT (18 = 18%/yr), sigma in DECIMAL
 * (0.4 = 40%), vega in percentage-points per vol point. The tools convert to the
 * decimal pure functions internally — the model never does unit arithmetic.
 */
describe('math function table (calc_* tools)', () => {
  it('registers all seven formulas', () => {
    const names = createMathTools().map((t) => t.name);
    expect(names).toEqual([
      'calc_realized_vol',
      'calc_fee_apy',
      'calc_lvr',
      'calc_net_apy',
      'calc_vega',
      'calc_efficiency_ratio',
      'calc_allocation',
    ]);
  });

  it('calc_vega reproduces the walkthrough golden value: σ=40%, L=4, fee 24% vol-scaled ⇒ −1.0 ⇒ −$100k/yr per vol point on $10M', async () => {
    const res = JSON.parse(
      await calcVegaTool.invoke({ sigma: 0.4, leverage: 4, feeApyPct: 24, feeVolScaling: true, notionalUsd: 10_000_000 }),
    );
    // k = 24/100/0.4 = 0.6 ; vega = 0.6 − 16·0.4/4 = −1.0
    expect(res.vegaPctPerVolPoint).toBeCloseTo(-1.0, 10);
    expect(res.volgaDecimalPerUnitSigmaSquared).toBeCloseTo(-4, 10);
    expect(res.usdPerVolPoint).toBeCloseTo(-100_000, 4);
  });

  it('calc_vega static fees is always short-vol', async () => {
    const res = JSON.parse(
      await calcVegaTool.invoke({ sigma: 0.4, leverage: 4, feeApyPct: 24, feeVolScaling: false }),
    );
    expect(res.vegaPctPerVolPoint).toBeCloseTo(-1.6, 10);
  });

  it('calc_realized_vol: alternating ±10% closes ⇒ ln(1.1)·√8760', async () => {
    const res = JSON.parse(await calcRealizedVolTool.invoke({ closes: [1, 1.1, 1, 1.1, 1] }));
    expect(res.sigma).toBeCloseTo(Math.log(1.1) * Math.sqrt(24 * 365), 10);
    expect(res.dataPoints).toBe(5);
  });

  it('calc_fee_apy returns PERCENT and guards the v4 negative-TVL quirk', async () => {
    const ok = JSON.parse(await calcFeeApyTool.invoke({ feesUsd24h: 1176.65, tvlUsd: 14_008_005 }));
    expect(ok.feeApyPct).toBeCloseTo((1176.65 / 14_008_005) * 365 * 100, 8);
    expect(ok.guard).toBeNull();

    const neg = JSON.parse(await calcFeeApyTool.invoke({ feesUsd24h: 100, tvlUsd: -24_748_988 }));
    expect(neg.feeApyPct).toBe(0);
    expect(neg.guard).toMatch(/flash-accounting/);
  });

  it('calc_net_apy returns the percent leg decomposition: 70% fees + 30% lending − 2% LVR', async () => {
    const res = JSON.parse(
      await calcNetApyTool.invoke({
        sigma: 0.4, leverage: 1, feeApyPct: 18, feeVolScaling: false, idleFraction: 0.3, lendingApyPct: 5, gasDragPct: 0,
      }),
    );
    // 0.7·18 + 0.3·5 − 100·(1·0.16/8) = 12.6 + 1.5 − 2.0 = 12.1%
    expect(res.netApyPct).toBeCloseTo(12.1, 8);
    expect(res.components.feeLegPct).toBeCloseTo(12.6, 8);
    expect(res.components.lendingLegPct).toBeCloseTo(1.5, 8);
    expect(res.components.lvrCostPct).toBeCloseTo(2.0, 8);
  });

  it('calc_net_apy with feeVolScaling reproduces observed feeAPY at the current σ (no double count)', async () => {
    const res = JSON.parse(
      await calcNetApyTool.invoke({
        sigma: 0.4, leverage: 1, feeApyPct: 18, feeVolScaling: true, idleFraction: 0, lendingApyPct: 0, gasDragPct: 0,
      }),
    );
    // k = 0.18/0.4 = 0.45 ; fees = k·σ = 18% exactly, minus LVR(σ=40%, L=1) = 2% ⇒ 16%
    expect(res.netApyPct).toBeCloseTo(16, 8);
    expect(res.feeSlopeKUsed).toBeCloseTo(0.45, 10);
  });

  it('calc_lvr: σ=40%, L=4 ⇒ 32%/yr', async () => {
    const res = JSON.parse(await calcLvrTool.invoke({ sigma: 0.4, leverage: 4 }));
    expect(res.lvrPct).toBeCloseTo(32, 10);
  });

  it('calc_efficiency_ratio: η = 12.1% / 2% = 6.05', async () => {
    const res = JSON.parse(
      await calcEfficiencyRatioTool.invoke({
        sigma: 0.4, leverage: 1, feeApyPct: 18, feeVolScaling: false, idleFraction: 0.3, lendingApyPct: 5,
      }),
    );
    expect(res.efficiencyRatio).toBeCloseTo(6.05, 8);
  });

  it('calc_allocation enforces APR + vega budget and sums weights to 1', async () => {
    const res = JSON.parse(
      await calcAllocationTool.invoke({
        legs: [
          { poolId: '0xaaa', pair: 'USDC/USDT', sigma: 0.004, leverage: 20, feeApyPct: 1.2, feeVolScaling: false, idleFraction: 0, lendingApyPct: 0, volumeUsd: 5e11 },
          { poolId: '0xbbb', pair: 'USDC/WETH', hook: '0x0000000aa232009084bd71a5797d089aa4edfad4', sigma: 0.4, leverage: 1, feeApyPct: 18, feeVolScaling: false, idleFraction: 0.3, lendingApyPct: 5, volumeUsd: 1.93e9 },
          { poolId: '0xccc', pair: 'ETH/USDC', sigma: 0.41, leverage: 1, feeApyPct: 6.1, feeVolScaling: false, idleFraction: 0, lendingApyPct: 0, volumeUsd: 1.19e10 },
          { poolId: '0xddd', pair: 'MEME/WETH', sigma: 0.9, leverage: 1, feeApyPct: 90, feeVolScaling: false, idleFraction: 0, lendingApyPct: 0, volumeUsd: 500_000 },
        ],
        minApr: 6,
        vegaBudget: 0.5,
        sizeUsd: 10_000_000,
        minVolumeUsd: 1_000_000,
      }),
    );
    // 0xaaa: 1.12% < 6% APR-fail; 0xccc: 4.0% < 6% APR-fail; 0xddd: volume-fail
    expect(res.excluded.map((e: any) => e.poolId).sort()).toEqual(['0xaaa', '0xccc', '0xddd']);
    expect(res.strategy.legs.map((l: any) => l.poolId)).toEqual(['0xbbb']);

    const leg = res.strategy.legs[0];
    expect(leg.netApyPct).toBeCloseTo(12.1, 8);
    expect(leg.vegaPctPerVolPoint).toBeCloseTo(-0.1, 10);
    expect(leg.weight).toBeCloseTo(1, 9);
    expect(leg.vegaUsdPerVolPoint).toBeCloseTo(-10_000, 4); // 10M × −0.1/100

    expect(res.strategy.achievedAprPct).toBeCloseTo(12.1, 8);
    expect(res.strategy.meetsAprTarget).toBe(true);
    expect(res.strategy.withinVegaBudget).toBe(true);
  });

  it('calc_allocation tightens the vega budget and excludes the short-vol book', async () => {
    const res = JSON.parse(
      await calcAllocationTool.invoke({
        legs: [
          { poolId: '0xbbb', pair: 'USDC/WETH', sigma: 0.4, leverage: 1, feeApyPct: 18, feeVolScaling: false, idleFraction: 0.3, lendingApyPct: 5, volumeUsd: 1.93e9 },
          { poolId: '0xfff', pair: 'USDC/USDT', sigma: 0.005, leverage: 5, feeApyPct: 7, feeVolScaling: false, idleFraction: 0, lendingApyPct: 0, volumeUsd: 5e11 },
        ],
        minApr: 6,
        vegaBudget: 0.05,
        sizeUsd: 10_000_000,
      }),
    );
    expect(res.excluded.map((e: any) => e.poolId)).toEqual(['0xbbb']); // vega −0.1 > 0.05
    expect(res.strategy.legs.map((l: any) => l.poolId)).toEqual(['0xfff']); // vega −0.03125
  });

  it('calc_allocation returns an honest empty strategy when nothing qualifies', async () => {
    const res = JSON.parse(
      await calcAllocationTool.invoke({
        legs: [
          { poolId: '0xaaa', pair: 'USDC/USDT', sigma: 0.004, leverage: 20, feeApyPct: 1.2, feeVolScaling: false, idleFraction: 0, lendingApyPct: 0, volumeUsd: 5e11 },
        ],
        minApr: 99,
        vegaBudget: 0.01,
        sizeUsd: 1_000,
      }),
    );
    expect(res.strategy.legs).toHaveLength(0);
    expect(res.strategy.meetsAprTarget).toBe(false);
  });
});
