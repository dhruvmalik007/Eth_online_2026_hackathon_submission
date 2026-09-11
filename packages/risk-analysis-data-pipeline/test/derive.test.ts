/**
 * Golden tests for the deterministic derivation.
 *
 * Every expected value is hand-computed from the documented formulas, so a
 * change to a weight or a constant produces an arithmetic difference rather than
 * a silently shifted parameter.
 */

import { describe, expect, it } from 'vitest';
import {
  COMPOSITE_WEIGHTS,
  FALLBACK_VOLATILITY,
  chainRiskPremium,
  collateralHaircut,
  compositeChainScore,
  deriveRiskAdjustment,
  liquidityScore,
  pdLoad,
  recoverableCollateral,
  volatilityMultiplier,
} from '../src/derive.js';
import type { ChainRiskScores, MarketMakerProfile } from '../src/types.js';
import { rate, usd } from '../src/units.js';

/**
 * The Base chain fixture's scores, as produced by the Python worker.
 *
 * @param overrides - Dimension scores to override.
 * @returns A complete score set.
 */
function scores(overrides: Partial<ChainRiskScores> = {}): ChainRiskScores {
  return {
    stateValidation: 0.7,
    dataAvailability: 1.0,
    exit: 0.1,
    sequencer: 0.8,
    proposer: 1.0,
    composite: 0.7,
    ...overrides,
  };
}

/**
 * Build a market-maker profile carrying a given depth.
 *
 * @param depthUsd - The 30-day average book depth.
 * @returns A profile with hero metrics.
 */
function maker(depthUsd: number): MarketMakerProfile {
  return {
    schemaVersion: '0.1.0',
    slug: 'maker',
    name: 'Maker',
    rank: 1,
    grade: 'AA',
    compositeScore: 9,
    subScores: {
      tradingKpis: 9,
      trust: 9,
      coverageCapabilities: 9,
      uptime: 9,
      integrationLevel: null,
    },
    metrics: {
      depthUsd,
      depthRank: 1,
      spreadPct: 0.1,
      spreadRank: 1,
      volumeUsd: 1_000_000,
      volumeRank: 1,
    },
    activeEngagements: 5,
    fdvUsd: 1_000_000,
    window: '30d',
    provider: 'Forgd via DefiLlama',
    provenance: {
      source: 'defillama.com/market-makers',
      sourceUrl: 'https://defillama.com/market-makers',
      fetchedAt: '2026-09-11T00:00:00Z',
      state: 'fresh',
    },
  };
}

describe('composite weights', () => {
  it('sum to exactly 1.0', () => {
    // Convexity is what guarantees the composite stays within its inputs' range.
    const total = Object.values(COMPOSITE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });

  it('weights state validation most heavily', () => {
    const heaviest = Object.entries(COMPOSITE_WEIGHTS).sort((a, b) => b[1] - a[1])[0];
    expect(heaviest?.[0]).toBe('stateValidation');
  });
});

describe('compositeChainScore', () => {
  it('reproduces the hand-computed Base value', () => {
    // 0.30(0.70) + 0.25(1.00) + 0.20(0.10) + 0.15(0.80) + 0.10(1.00) = 0.700
    expect(compositeChainScore(scores())).toBeCloseTo(0.7, 10);
  });

  it('returns 1.0 for a perfect chain', () => {
    expect(
      compositeChainScore(scores({ stateValidation: 1, dataAvailability: 1, exit: 1, sequencer: 1, proposer: 1 })),
    ).toBeCloseTo(1.0, 10);
  });

  it('never exceeds the range of its inputs', () => {
    const input = scores({ stateValidation: 0.9, dataAvailability: 0.1, exit: 0.9 });
    const composite = compositeChainScore(input);
    const values = [input.stateValidation, input.dataAvailability, input.exit, input.sequencer, input.proposer];
    expect(composite).toBeGreaterThanOrEqual(Math.min(...values));
    expect(composite).toBeLessThanOrEqual(Math.max(...values));
  });
});

describe('volatilityMultiplier', () => {
  it('applies no amplification for the safest chain', () => {
    expect(volatilityMultiplier(1)).toBeCloseTo(1.0, 10);
  });

  it('applies the full slope for the least safe chain', () => {
    // 1 + (1 - 0) * 0.8 = 1.8
    expect(volatilityMultiplier(0)).toBeCloseTo(1.8, 10);
  });

  it('scales linearly in between', () => {
    // 1 + (1 - 0.5) * 0.8 = 1.4
    expect(volatilityMultiplier(0.5)).toBeCloseTo(1.4, 10);
  });
});

describe('chainRiskPremium', () => {
  it('adds no premium for the safest chain', () => {
    expect(chainRiskPremium(1)).toBeCloseTo(0, 10);
  });

  it('adds the full premium for the least safe chain', () => {
    // 0.06 = 600 bp
    expect(chainRiskPremium(0)).toBeCloseTo(0.06, 10);
  });
});

describe('collateralHaircut', () => {
  it('discounts nothing when exit and sequencer are perfect', () => {
    expect(collateralHaircut(scores({ exit: 1, sequencer: 1 }))).toBeCloseTo(1.0, 10);
  });

  it('reaches the documented maximum discount at worst-case risk', () => {
    // (exitRisk + sequencerRisk) / 2 = 1, so 1 - 1 * 0.5 = 0.5
    expect(collateralHaircut(scores({ exit: 0, sequencer: 0 }))).toBeCloseTo(0.5, 10);
  });

  it('stays within (0, 1]', () => {
    const haircut = collateralHaircut(scores());
    expect(haircut).toBeGreaterThan(0);
    expect(haircut).toBeLessThanOrEqual(1);
  });
});

describe('pdLoad', () => {
  it('is exactly 1 for a perfect chain with no governance input', () => {
    expect(pdLoad(1)).toBeCloseTo(1.0, 10);
  });

  it('adds the full chain load at worst-case chain risk', () => {
    // 1 + (1 - 0) * 0.5 = 1.5
    expect(pdLoad(0)).toBeCloseTo(1.5, 10);
  });

  it('sums chain and governance loads rather than averaging', () => {
    // 1 + 0.25 (chain at 0.5) + 0.15 (governance at 0.5) = 1.40
    expect(pdLoad(0.5, 0.5)).toBeCloseTo(1.4, 10);
  });

  it('never falls below 1', () => {
    expect(pdLoad(1, 1)).toBeCloseTo(1.0, 10);
  });
});

describe('liquidityScore', () => {
  it('is zero when no maker reports depth', () => {
    // Zero is the honest answer for "unknown" rather than a safe default.
    expect(liquidityScore([])).toBe(0);
  });

  it('saturates at the documented ceiling', () => {
    expect(liquidityScore([maker(10_000_000)])).toBe(1);
  });

  it('scales proportionally below the ceiling', () => {
    expect(liquidityScore([maker(2_500_000)])).toBeCloseTo(0.5, 10);
  });

  it('uses the median so one dominant maker cannot mask a thin venue', () => {
    // Three makers: one huge, two small. The mean would be ~3.4M (0.67), but the
    // median is 300k (0.06) — which reflects what a typical fill would face.
    const value = liquidityScore([maker(10_000_000), maker(300_000), maker(200_000)]);
    expect(value).toBeCloseTo(300_000 / 5_000_000, 10);
  });
});

describe('deriveRiskAdjustment', () => {
  it('scales a measured volatility by the regime multiplier', () => {
    const adjustment = deriveRiskAdjustment({
      chainScores: scores(),
      realizedVolatility: rate(0.4),
      baseRiskFreeRate: rate(0.05),
    });
    // composite 0.7 -> multiplier 1 + 0.3 * 0.8 = 1.24; 0.4 * 1.24 = 0.496
    expect(adjustment.volatility).toBeCloseTo(0.496, 10);
    expect(adjustment.volatilitySource).toBe('realized');
  });

  it('adds the chain premium to the base rate', () => {
    const adjustment = deriveRiskAdjustment({
      chainScores: scores(),
      realizedVolatility: rate(0.4),
      baseRiskFreeRate: rate(0.05),
    });
    // 0.05 + (1 - 0.7) * 0.06 = 0.068
    expect(adjustment.riskFreeRate).toBeCloseTo(0.068, 10);
  });

  it('falls back to the documented volatility and says so', () => {
    const adjustment = deriveRiskAdjustment({
      chainScores: scores(),
      realizedVolatility: null,
      baseRiskFreeRate: rate(0.05),
    });
    // Reporting the fallback is the point: a consumer can see the value is an
    // assumption rather than a measurement.
    expect(adjustment.volatilitySource).toBe('fallback');
    expect(adjustment.volatility).toBeCloseTo(FALLBACK_VOLATILITY * volatilityMultiplier(0.7), 10);
  });

  it('explains every factor it applies', () => {
    const adjustment = deriveRiskAdjustment({
      chainScores: scores(),
      realizedVolatility: rate(0.4),
      baseRiskFreeRate: rate(0.05),
    });
    const names = adjustment.factors.map((f) => f.name);
    expect(names).toContain('chainComposite');
    expect(names).toContain('volatilityMultiplier');
    expect(names).toContain('collateralHaircut');
    expect(names).toContain('pdLoad');
    expect(names).toContain('liquidityScore');
    // Each explanation must be a real sentence, not a placeholder.
    for (const factor of adjustment.factors) {
      expect(factor.explanation.length).toBeGreaterThan(20);
    }
  });

  it('notes when no governance profile was available', () => {
    const adjustment = deriveRiskAdjustment({
      chainScores: scores(),
      realizedVolatility: rate(0.4),
      baseRiskFreeRate: rate(0.05),
    });
    const load = adjustment.factors.find((f) => f.name === 'pdLoad');
    expect(load?.explanation).toContain('no governance profile');
  });
});

describe('recoverableCollateral', () => {
  it('discounts the notional by the haircut', () => {
    const adjustment = deriveRiskAdjustment({
      chainScores: scores(),
      realizedVolatility: rate(0.4),
      baseRiskFreeRate: rate(0.05),
    });
    // haircut for exit 0.1 / sequencer 0.8: (0.9 + 0.2)/2 = 0.55 -> 1 - 0.275 = 0.725
    expect(recoverableCollateral(usd(1_000_000), adjustment)).toBeCloseTo(725_000, 5);
  });
});
