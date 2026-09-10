import { describe, expect, it } from 'vitest';
import { quantilesToRisk } from '../../src/tools/fixedIncomeRisk.js';
import {
  amountsSumTo100,
  assessRisk,
  citationsGrounded,
  quantilesMonotonic,
  scaleSuspicious,
} from '../../src/graph/v01/guardrails.js';
import type { SynthesisMatrix, YieldProjection } from '../../src/graph/v01/schemas.js';

const step = (day: number, q10: number, q50: number, q90: number) => ({ day, q10, q50, q90 });

// steps: q10 [0.030, 0.031, 0.032], q50 [0.040, 0.0405, 0.0412], q90 [0.050, 0.052, 0.054]
const cleanProjection: YieldProjection = {
  id: 'proj-0xpool-apy',
  poolId: '0xpool',
  target: 'apy',
  horizonDays: 3,
  steps: [step(1, 0.03, 0.04, 0.05), step(2, 0.031, 0.0405, 0.052), step(3, 0.032, 0.0412, 0.054)],
  model: 'timesfm-3.0',
  inputsHash: 'h',
  suspicious: false,
};

describe('fixedIncomeRisk.quantilesToRisk (golden values)', () => {
  it('hand-computed band width, vol, slope, and downside', () => {
    const r = quantilesToRisk(cleanProjection.steps.map((s) => ({ q10: s.q10, q50: s.q50, q90: s.q90 })));
    // band widths: 0.010, 0.0095, 0.0092 → mean 0.0095666…
    expect(r.downsideBandWidth).toBeCloseTo(0.009566666666666666, 9);
    // q50 diffs: 0.0005, 0.0007 → σ = 0.0001
    expect(r.bandVol).toBeCloseTo(0.0001, 9);
    // LSQ slope of [0.04, 0.0405, 0.0412] over x = [0,1,2] → 0.0006
    expect(r.trendSlope).toBeCloseTo(0.0006, 9);
    // q50[0] − q10[last] = 0.04 − 0.032 = 0.008
    expect(r.varDownside).toBeCloseTo(0.008, 9);
  });

  it('rejects fewer than 2 steps', () => {
    expect(() => quantilesToRisk([step(1, 0.03, 0.04, 0.05)])).toThrow();
  });
});

describe('guardrails.quantilesMonotonic', () => {
  it('accepts monotonic bands and rejects inverted ones', () => {
    expect(quantilesMonotonic(cleanProjection)).toBe(true);
    const inverted: YieldProjection = {
      ...cleanProjection,
      steps: [step(1, 0.05, 0.04, 0.03)],
    };
    expect(quantilesMonotonic(inverted)).toBe(false);
  });
});

describe('guardrails.scaleSuspicious (k·σ)', () => {
  // σ = 0.002, k = 10 → bound = 0.02 around the last realized value (0.045).
  it('flags a median path breaching the k·σ band', () => {
    const spiking: YieldProjection = {
      ...cleanProjection,
      steps: [step(1, 0.3, 0.5, 0.7)], // |0.5 − 0.045| = 0.455 > 0.02
    };
    expect(scaleSuspicious(spiking, 0.045, 0.002, 10)).toBe(true);
  });

  it('accepts a calm path within the band', () => {
    // |0.0412 − 0.045| = 0.0038 < 0.02
    expect(scaleSuspicious(cleanProjection, 0.045, 0.002, 10)).toBe(false);
  });
});

describe('guardrails.citationsGrounded', () => {
  const base: SynthesisMatrix = {
    violations: [{ id: 'v1', protocol: 'p', constraintId: 'c-aave', projectionId: 'proj-0xpool-apy', statement: 'x' }],
    alpha: [{ id: 'a1', protocol: 'p', projectionId: 'proj-0xpool-apy', thesis: 'y' }],
    feasibility: [{ protocol: 'p', risk: { trendSlope: 0.0006 }, feasible: true }],
  };

  it('accepts fully cited matrices', () => {
    expect(citationsGrounded(base)).toBe(true);
  });

  it('rejects dangling constraint/projection references', () => {
    const bad: SynthesisMatrix = {
      ...base,
      violations: [{ id: 'v1', protocol: 'p', constraintId: 'constraints/3', projectionId: 'proj-0xpool-apy', statement: 'x' }],
    };
    expect(citationsGrounded(bad)).toBe(false);
  });
});

describe('guardrails.assessRisk (deterministic risk gate)', () => {
  const decisions = [
    { amountPercentage: 65, citations: ['proj-0xpool-apy', 'c-aave'] },
    { amountPercentage: 35, citations: ['proj-0xpool2-apy'] },
  ];

  it('passes a clean, grounded, balanced matrix', () => {
    const r = assessRisk({ projections: [cleanProjection], decisions });
    expect(r.replanNeeded).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it('forces re-plan on suspicious projections', () => {
    const r = assessRisk({
      projections: [{ ...cleanProjection, suspicious: true }],
      decisions,
    });
    expect(r.replanNeeded).toBe(true);
    expect(r.suspiciousProjections).toEqual(['proj-0xpool-apy']);
  });

  it('forces re-plan when amounts do not sum to 100', () => {
    const r = assessRisk({ projections: [cleanProjection], decisions: [decisions[0]!] });
    expect(r.replanNeeded).toBe(true);
    expect(r.reasons.join(' ')).toContain('sum to 100%');
  });

  it('forces re-plan on ungrounded decisions', () => {
    const r = assessRisk({
      projections: [cleanProjection],
      decisions: [{ amountPercentage: 100, citations: [] }],
    });
    expect(r.replanNeeded).toBe(true);
    expect(r.reasons.join(' ')).toContain('citations');
  });
});

describe('guardrails.amountsSumTo100', () => {
  it('accepts 100 ± 1 and rejects other totals', () => {
    expect(amountsSumTo100([{ amountPercentage: 65 }, { amountPercentage: 35 }])).toBe(true);
    expect(amountsSumTo100([{ amountPercentage: 99.5 }, { amountPercentage: 0.8 }])).toBe(true);
    expect(amountsSumTo100([{ amountPercentage: 50 }, { amountPercentage: 30 }])).toBe(false);
  });
});
