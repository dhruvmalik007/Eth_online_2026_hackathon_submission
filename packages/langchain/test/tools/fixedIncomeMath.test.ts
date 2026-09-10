import { describe, it, expect } from 'vitest';
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
} from '../../src/tools/fixedIncomeMath.js';

/**
 * Golden-value tests for the fixed-income math (docs/fixed-income-agent-walkthrough.md §3).
 * ⚠️ UNITS: this module is strictly DECIMAL — feeApy 0.18 = 18%, sigma 0.4 = 40%,
 * netApy output 0.121 = 12.1%/yr. The calc_* tools are the percent boundary.
 * Every constant here is hand-computed — if one of these fails, the agent's risk numbers lie.
 */
describe('fixedIncomeMath — golden values (decimal units)', () => {
  describe('vega = k − L²σ/4', () => {
    it('full-range (L=1), no fee slope, σ=20% ⇒ −0.05 per unit sigma', () => {
      expect(vega({ sigma: 0.2, leverage: 1, feeSlopeK: 0 })).toBeCloseTo(-0.05, 12);
    });

    it('walkthrough worked example: σ=40%, L=4, k=0.6 ⇒ −1.0 per unit sigma', () => {
      expect(vega({ sigma: 0.4, leverage: 4, feeSlopeK: 0.6 })).toBeCloseTo(-1.0, 12);
    });

    it('per vol point = per-unit-sigma / 100 ⇒ $10M notional loses $100k/yr per vol point', () => {
      const v = vega({ sigma: 0.4, leverage: 4, feeSlopeK: 0.6 }); // −1.0
      const usd = (v / 100) * 10_000_000;
      expect(usd).toBeCloseTo(-100_000, 6);
    });

    it('static fees (k=0) is always short-vol; fee-dominated L=1 book can be long-vol', () => {
      expect(vega({ sigma: 0.4, leverage: 4, feeSlopeK: 0 })).toBeLessThan(0);
      // k=0.6 > L²σ/4 = 0.075 ⇒ net long-vol (fees grow faster than LVR bleed)
      expect(vega({ sigma: 0.3, leverage: 1, feeSlopeK: 0.6 })).toBeGreaterThan(0);
    });

    it('volga = −L²/4 and is independent of sigma', () => {
      expect(volga(4)).toBeCloseTo(-4, 12);
      expect(volga(1)).toBeCloseTo(-0.25, 12);
    });
  });

  describe('LVR = L²σ²/8', () => {
    it('walkthrough example: σ=40%, L=4 ⇒ 0.32/yr = 32%/yr bleed', () => {
      expect(lvr(0.4, 4)).toBeCloseTo(0.32, 12);
    });

    it('convexity check: vega × Δσ + convexity reproduces ΔLVR at σ=40→41%', () => {
      const d = lvr(0.41, 4) - lvr(0.4, 4);
      const v = vega({ sigma: 0.4, leverage: 4, feeSlopeK: 0.6 });
      // first-order estimate |vega|·Δσ = 1.0 · 0.01; actual includes convexity ⇒ slightly larger
      expect(d).toBeGreaterThan(Math.abs(v) * 0.01);
      expect(d).toBeCloseTo(0.0162, 12);
    });

    it('full-range LVR is the classic σ²/8', () => {
      expect(lvr(0.5, 1)).toBeCloseTo(0.5 ** 2 / 8, 12);
    });
  });

  describe('realized volatility from hourly closes (mathjs population variance)', () => {
    it('flat closes ⇒ σ = 0', () => {
      expect(realizedVolFromHourlyCloses([100, 100, 100, 100])).toBe(0);
    });

    it('alternating ±10% closes ⇒ σ = ln(1.1) · √(24·365)', () => {
      const closes = [1, 1.1, 1, 1.1, 1];
      const expected = Math.log(1.1) * Math.sqrt(24 * 365);
      expect(realizedVolFromHourlyCloses(closes)).toBeCloseTo(expected, 10);
    });

    it('fewer than 3 closes ⇒ 0 (insufficient series must be excluded downstream)', () => {
      expect(realizedVolFromHourlyCloses([100, 101])).toBe(0);
      expect(realizedVolFromHourlyCloses([])).toBe(0);
    });
  });

  describe('dual-yield net APY (decimal in, decimal out)', () => {
    it('dual-hook book: 70% fees @18% + 30% lending @5% − LVR(L=1, σ=40%) = 2%/yr', () => {
      const apy = netApy({
        sigma: 0.4,
        leverage: 1,
        feeApy: 0.18,
        feeSlopeK: 0,
        idleFraction: 0.3,
        lendingApy: 0.05,
        gasDrag: 0,
      });
      // 0.7·0.18 + 0.3·0.05 − 1·0.16/8 = 0.126 + 0.015 − 0.02 = 0.121 (12.1%/yr)
      expect(apy).toBeCloseTo(0.121, 12);
    });

    it('fee-only book (w=0): lending leg contributes nothing', () => {
      const apy = netApy({
        sigma: 0.02,
        leverage: 20,
        feeApy: 0.04,
        idleFraction: 0,
        lendingApy: 0.09,
      });
      // 0.04 − 400·0.0004/8 = 0.04 − 0.02 = 0.02 (2%/yr)
      expect(apy).toBeCloseTo(0.02, 12);
    });

    it('k estimated as feeAPY/σ reproduces observed feeAPY minus LVR (no double count)', () => {
      const feeApy = 0.18;
      const sigma = 0.4;
      const k = feeApy / sigma; // 0.45 — estimated slope
      const apyLinear = netApy({
        sigma,
        leverage: 1,
        feeApy: 0, // fees fully expressed via the slope term
        feeSlopeK: k,
        idleFraction: 0,
        lendingApy: 0,
      });
      // k·σ = 0.18 exactly, minus LVR(σ=0.4, L=1) = 0.02 — the slope reproduces the
      // observed fee yield at the current σ, and the rebalancing cost still applies.
      expect(apyLinear).toBeCloseTo(feeApy - lvr(sigma, 1), 12);
    });
  });

  describe('efficiency ratio', () => {
    it('η = netAPY / LVR = 0.121 / 0.02 = 6.05', () => {
      const input = { sigma: 0.4, leverage: 1, feeApy: 0.18, feeSlopeK: 0, idleFraction: 0.3, lendingApy: 0.05 };
      expect(efficiencyRatio(input)).toBeCloseTo(0.121 / 0.02, 10);
    });
  });

  describe('allocateStrategy — APR + vega constraints', () => {
    const mk = (over: Partial<StrategyLeg> & { poolId: string; pair: string }): StrategyLeg => ({
      hook: null,
      sigma: 0.02,
      leverage: 20,
      feeApy: 0.05,
      feeSlopeK: 0,
      idleFraction: 0,
      lendingApy: 0,
      volumeUsd: 5_000_000_000,
      ...over,
    });

    const legs: StrategyLeg[] = [
      // 1.12% net (0.012 − 0.0008) < 6% target ⇒ APR-fail
      mk({ poolId: '0xaaa', pair: 'USDC/USDT', sigma: 0.004, leverage: 20, feeApy: 0.012 }),
      // dual-hook ETH book: 12.1% net, vega −0.1 ⇒ eligible
      mk({
        poolId: '0xbbb',
        pair: 'USDC/WETH',
        hook: '0x0000000aa232009084bd71a5797d089aa4edfad4',
        sigma: 0.4,
        leverage: 1,
        feeApy: 0.18,
        lendingApy: 0.05,
        idleFraction: 0.3,
        volumeUsd: 1_930_000_000,
      }),
      // 4.0% net (0.061 − 0.021) < 6% ⇒ APR-fail (vega −0.1025 would pass a 0.5 budget)
      mk({ poolId: '0xccc', pair: 'ETH/USDC', sigma: 0.41, leverage: 1, feeApy: 0.061 }),
      // volume-fail
      mk({ poolId: '0xddd', pair: 'MEME/WETH', sigma: 0.9, leverage: 1, feeApy: 0.9, volumeUsd: 500_000 }),
      // no hourly series
      mk({ poolId: '0xeee', pair: 'DEAD/WETH', sigma: 0 }),
      // tight stable book: 6.99% net, vega −0.03125 ⇒ eligible, high efficiency
      mk({ poolId: '0xfff', pair: 'USDC/USDT', sigma: 0.005, leverage: 5, feeApy: 0.07 }),
    ];

    it('filters out APR-fail, volume-fail and no-sigma books with reasons', () => {
      const result = allocateStrategy(legs, { minApr: 0.06, vegaBudget: 0.5, sizeUsd: 10_000_000, minVolumeUsd: 1_000_000 });
      const reasons = Object.fromEntries(result.excluded.map((e) => [e.poolId, e.reason]));

      expect(reasons['0xaaa']).toMatch(/below target/);
      expect(reasons['0xccc']).toMatch(/below target/);
      expect(reasons['0xddd']).toMatch(/below floor/);
      expect(reasons['0xeee']).toMatch(/hourly price series/);

      expect(result.legs.map((l) => l.poolId)).toEqual(expect.arrayContaining(['0xbbb', '0xfff']));
    });

    it('vega budget actually excludes a short-vol book when tightened', () => {
      const result = allocateStrategy(legs, { minApr: 0.06, vegaBudget: 0.05, sizeUsd: 10_000_000, minVolumeUsd: 1_000_000 });
      const reasons = Object.fromEntries(result.excluded.map((e) => [e.poolId, e.reason]));
      // 0xbbb vega −0.1 > 0.05 ⇒ excluded; 0xfff vega −0.03125 ⇒ eligible
      expect(reasons['0xbbb']).toMatch(/vega/);
      expect(result.legs.map((l) => l.poolId)).toEqual(['0xfff']);
    });

    it('weights sum to 1 and scale notional', () => {
      const result = allocateStrategy(legs, { minApr: 0.06, vegaBudget: 0.5, sizeUsd: 10_000_000, minVolumeUsd: 1_000_000 });
      const sum = result.legs.reduce((s, l) => s + l.weight, 0);
      expect(sum).toBeCloseTo(1, 9);
      const notionalSum = result.legs.reduce((s, l) => s + l.notionalUsd, 0);
      expect(notionalSum).toBeCloseTo(10_000_000, 4);
    });

    it('achieved APR is the weight-space average and flags target misses honestly', () => {
      const result = allocateStrategy(legs, { minApr: 0.06, vegaBudget: 0.5, sizeUsd: 10_000_000, minVolumeUsd: 1_000_000 });
      const manual = result.legs.reduce((s, l) => s + l.weight * l.netApy, 0);
      expect(result.achievedApr).toBeCloseTo(manual, 12);
      expect(result.meetsAprTarget).toBe(result.achievedApr >= 0.06);
    });

    it('portfolio vega is the weighted sum and respects the budget flag', () => {
      const result = allocateStrategy(legs, { minApr: 0.06, vegaBudget: 0.5, sizeUsd: 10_000_000, minVolumeUsd: 1_000_000 });
      const manual = result.legs.reduce((s, l) => s + l.weight * l.vega, 0);
      expect(result.portfolioVega).toBeCloseTo(manual, 12);
      expect(result.withinVegaBudget).toBe(Math.abs(manual) <= 0.5);
    });

    it('returns an honest empty strategy when nothing qualifies', () => {
      const result = allocateStrategy(legs, { minApr: 0.99, vegaBudget: 0.01, sizeUsd: 1_000, minVolumeUsd: 0 });
      expect(result.legs).toHaveLength(0);
      expect(result.meetsAprTarget).toBe(false);
      expect(result.excluded.length).toBeGreaterThan(0);
    });
  });

  describe('feeApyFromDayData', () => {
    it('24h fees / TVL × 365 (decimal fraction)', () => {
      expect(feeApyFromDayData(1176.65, 14_008_005)).toBeCloseTo((1176.65 / 14_008_005) * 365, 12);
    });

    it('guards: zero/negative TVL (v4 flash quirk) ⇒ 0, never NaN/Infinity', () => {
      expect(feeApyFromDayData(100, 0)).toBe(0);
      expect(feeApyFromDayData(100, -24_748_988)).toBe(0);
      expect(feeApyFromDayData(NaN, 100)).toBe(0);
    });
  });
});
