/**
 * Unit-brand tests.
 *
 * The brands exist to make unit mixing a compile error. A brand that can be
 * bypassed at runtime is worth much less, so the constructors validate their
 * input rather than trusting it.
 */

import { describe, expect, it } from 'vitest';
import { bps, bpsToRate, days, pct, pctToRate, rate, rateToPct, unbrand, usd } from '../src/units.js';

describe('unit constructors', () => {
  it('accepts valid values', () => {
    expect(usd(1_000)).toBe(1_000);
    expect(pct(4)).toBe(4);
    expect(rate(0.04)).toBe(0.04);
    expect(bps(400)).toBe(400);
    expect(days(30)).toBe(30);
  });

  it('rejects a negative amount', () => {
    // A negative dollar figure is a parser bug, and failing here names it.
    expect(() => usd(-1)).toThrow(RangeError);
  });

  it('rejects a percentage outside 0-100', () => {
    expect(() => pct(-0.5)).toThrow(RangeError);
    expect(() => pct(101)).toThrow(RangeError);
  });

  it('rejects a non-finite value', () => {
    expect(() => rate(Number.NaN)).toThrow(RangeError);
    expect(() => usd(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('rejects a fractional basis point', () => {
    expect(() => bps(1.5)).toThrow(RangeError);
  });
});

describe('unit conversions', () => {
  it('converts percent to rate', () => {
    expect(pctToRate(pct(4))).toBeCloseTo(0.04, 10);
  });

  it('converts rate back to percent', () => {
    expect(rateToPct(rate(0.04))).toBeCloseTo(4, 10);
  });

  it('converts basis points to rate', () => {
    expect(bpsToRate(bps(400))).toBeCloseTo(0.04, 10);
  });

  it('round-trips percent through rate', () => {
    expect(rateToPct(pctToRate(pct(12.5)))).toBeCloseTo(12.5, 10);
  });

  it('agrees across all three representations of the same value', () => {
    // 4% == 0.04 == 400bp. If these disagree, one of the conversions is wrong.
    const fromPct = pctToRate(pct(4));
    const fromBps = bpsToRate(bps(400));
    expect(fromPct).toBeCloseTo(fromBps, 10);
  });
});

describe('unbrand', () => {
  it('strips the brand for serialization', () => {
    expect(unbrand(usd(42))).toBe(42);
    expect(unbrand(pct(4.5))).toBe(4.5);
  });
});
