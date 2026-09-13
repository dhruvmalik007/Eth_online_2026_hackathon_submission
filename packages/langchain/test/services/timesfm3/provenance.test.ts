import { describe, expect, it } from 'vitest';
import {
  buildForecastProvenance,
  describeProvenance,
  digestSeries,
} from '../../../src/services/timesfm3/provenance.js';

const forecast = {
  model: 'timesfm-3.0',
  horizon: 3,
  latencyMs: 120,
  flags: { quantileMonotonic: true, scaleSuspicious: false },
};

function windowOf(values: number[]) {
  return {
    timestamps: values.map((_, i) => new Date(Date.UTC(2026, 0, 1 + i))),
    values,
  };
}

describe('digestSeries', () => {
  it('is stable across repeated calls', () => {
    const a = digestSeries([1, 2, 3], { target: 'apy' });
    const b = digestSeries([1, 2, 3], { target: 'apy' });
    expect(a).toBe(b);
  });

  it('changes when the data changes, even for identical params', () => {
    // The regression this module exists for: `pool:apy:90d` hashed the request, so
    // a shifted window produced the same string and a tampered forecast verified.
    const params = { poolId: 'p', target: 'apy', windowDays: 90 };
    const before = digestSeries([1, 2, 3, 4, 5, 6, 7, 8], params);
    const after = digestSeries([1, 2, 3, 4, 5, 6, 7, 9], params);
    expect(before).not.toBe(after);
  });

  it('changes when the params change, even for identical data', () => {
    const values = [1, 2, 3];
    expect(digestSeries(values, { target: 'apy' })).not.toBe(
      digestSeries(values, { target: 'tvl' }),
    );
  });

  it('does not depend on param key order', () => {
    const values = [1, 2, 3, 4];
    expect(digestSeries(values, { a: 1, b: 2 })).toBe(digestSeries(values, { b: 2, a: 1 }));
  });

  it('names non-finite values rather than stringifying them', () => {
    // String(NaN) is 'NaN' — a valid-looking token that would silently collide with a
    // different non-finite series if it were not handled explicitly.
    expect(digestSeries([1, Number.NaN, 3], {})).not.toBe(
      digestSeries([1, Number.POSITIVE_INFINITY, 3], {}),
    );
  });

  it('is prefixed so the algorithm is legible in a trace', () => {
    expect(digestSeries([1], {})).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('buildForecastProvenance', () => {
  const input = {
    poolId: 'pool-1',
    target: 'apy',
    windowDays: 90,
    window: windowOf([3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8]),
    forecast,
  };

  it('records the model that produced the numbers, not the one requested', () => {
    const p = buildForecastProvenance(input);
    expect(p.model).toBe('timesfm-3.0');
    expect(p.horizon).toBe(3);
  });

  it('records how many points the model consumed', () => {
    // FM3 produces output on a short window too; only the count separates a
    // reliable forecast from one that should not have been trusted.
    const p = buildForecastProvenance(input);
    expect(p.inputPoints).toBe(8);
  });

  it('records the covered span as ISO dates', () => {
    const p = buildForecastProvenance(input);
    expect(p.inputFrom).toBe('2026-01-01T00:00:00.000Z');
    expect(p.inputTo).toBe('2026-01-08T00:00:00.000Z');
  });

  it('carries the guardrail flags through', () => {
    const p = buildForecastProvenance({
      ...input,
      forecast: { ...forecast, flags: { quantileMonotonic: true, scaleSuspicious: true } },
    });
    expect(p.flags.scaleSuspicious).toBe(true);
  });

  it('tolerates an empty window without throwing', () => {
    const p = buildForecastProvenance({ ...input, window: { timestamps: [], values: [] } });
    expect(p.inputPoints).toBe(0);
    expect(p.inputFrom).toBeNull();
  });
});

describe('describeProvenance', () => {
  const base = buildForecastProvenance({
    poolId: 'pool-1',
    target: 'apy',
    windowDays: 90,
    window: windowOf([3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8]),
    forecast,
  });

  it('is a single line naming the model, target, horizon and window', () => {
    const line = describeProvenance(base);
    expect(line).toContain('timesfm-3.0');
    expect(line).toContain('apy');
    expect(line).toContain('h=3');
    expect(line).toContain('8 pts');
    expect(line).not.toContain('\n');
  });

  it('stays quiet when nothing is wrong', () => {
    expect(describeProvenance(base)).not.toContain('⚠');
  });

  it('surfaces scaleSuspicious instead of burying it in nested JSON', () => {
    const flagged = { ...base, flags: { ...base.flags, scaleSuspicious: true } };
    expect(describeProvenance(flagged)).toContain('scaleSuspicious');
  });

  it('surfaces a window below the FM3 minimum', () => {
    expect(describeProvenance({ ...base, inputPoints: 4 })).toContain('only 4 input points');
  });

  it('surfaces non-monotonic quantiles', () => {
    const broken = { ...base, flags: { ...base.flags, quantileMonotonic: false } };
    expect(describeProvenance(broken)).toContain('non-monotonic');
  });
});
