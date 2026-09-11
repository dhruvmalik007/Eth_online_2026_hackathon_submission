/**
 * Golden tests for TimesFM-3 covariate construction.
 *
 * The alignment contract is the whole point of this module: a covariate row that
 * is one value short reaches the deployed service as HTTP 500, not a 4xx, so the
 * failure looks like a model outage rather than a shape bug. These tests pin the
 * contract, the forward-fill semantics (no interpolation), and the coverage
 * reporting.
 *
 * Expected values are hand-computed from the documented rules rather than
 * captured from a run, so a change in behaviour is an arithmetic difference.
 */

import { describe, expect, it } from 'vitest';
import {
  CovariateAlignmentError,
  alignToGrid,
  assertCovariatesAligned,
  buildPastCovariates,
  cumulativeIncidentSeries,
  emptyCovariateMatrix,
  type CovariatePoint,
} from '../src/index.js';

/** A grid of `n` hourly steps starting at a fixed instant. */
function hourlyGrid(n: number): Date[] {
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => new Date(base + i * 3_600_000));
}

/** A covariate point at hour `h`. */
function at(h: number, value: number): CovariatePoint {
  return { ts: new Date(Date.UTC(2026, 0, 1, h, 0, 0)), value };
}

describe('alignToGrid', () => {
  it('carries the last observation forward without interpolating', () => {
    // Observations at hours 0 and 2 only. The grid is every hour 0..3.
    // Forward-fill (not interpolation) means hour 1 repeats hour 0's value, and
    // hour 3 repeats hour 2's — no value between them is invented.
    const points = [at(0, 10), at(2, 30)];
    const { values } = alignToGrid(points, hourlyGrid(4));

    expect(values).toEqual([10, 10, 30, 30]);
  });

  it('backfills steps before the first observation with the earliest value', () => {
    // First observation is at hour 2; hours 0 and 1 have nothing before them.
    // Backfill repeats 30 rather than asserting 0, which would claim "no risk".
    const points = [at(2, 30), at(3, 40)];
    const { values, observed, filled } = alignToGrid(points, hourlyGrid(4));

    expect(values).toEqual([30, 30, 30, 40]);
    expect(observed).toBe(2); // hours 2 and 3 have a real observation at or before
    expect(filled).toBe(2); // hours 0 and 1 were backfilled
  });

  it('honours a numeric leading fill when the caller supplies one', () => {
    // A caller who knows "before measurement" means a specific default gets that
    // default, and it is clearly distinguishable from a real observation.
    const points = [at(2, 30)];
    const { values, observed, filled } = alignToGrid(points, hourlyGrid(3), 0);

    expect(values).toEqual([0, 0, 30]);
    expect(observed).toBe(1);
    expect(filled).toBe(2);
  });

  it('sorts out-of-order observations before aligning', () => {
    // Two queries concatenated can arrive unordered. Aligning unsorted data would
    // silently pick a wrong neighbour, so the order is normalised first.
    const points = [at(3, 40), at(0, 10), at(2, 30)];
    const { values } = alignToGrid(points, hourlyGrid(4));

    expect(values).toEqual([10, 10, 30, 40]);
  });

  it('produces exactly one value per grid step', () => {
    // The length invariant, stated directly: this is the property whose violation
    // the deployed service answers with HTTP 500.
    const grid = hourlyGrid(7);
    const { values } = alignToGrid([at(1, 5)], grid);

    expect(values).toHaveLength(grid.length);
  });

  it('handles an empty grid without producing values', () => {
    const { values, observed, filled } = alignToGrid([at(0, 10)], []);

    expect(values).toEqual([]);
    expect(observed).toBe(0);
    expect(filled).toBe(0);
  });
});

describe('assertCovariatesAligned', () => {
  it('accepts rows whose length equals the context length', () => {
    expect(() => {
      assertCovariatesAligned(3, ['a', 'b'], [[1, 2, 3], [4, 5, 6]]);
    }).not.toThrow();
  });

  it('rejects a row that is one value short, naming the covariate', () => {
    // The real bug this guards: 48-step series, 47-value covariate.
    let caught: unknown;
    try {
      assertCovariatesAligned(48, ['chain_risk'], [Array.from({ length: 47 }, () => 0)]);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CovariateAlignmentError);
    const error = caught as CovariateAlignmentError;
    expect(error.covariate).toBe('chain_risk');
    expect(error.expected).toBe(48);
    expect(error.actual).toBe(47);
  });

  it('names the row by position when the name is missing', () => {
    // Defensive: a caller passing fewer names than rows still gets a usable
    // message rather than a TypeError from indexing past the end.
    let caught: unknown;
    try {
      assertCovariatesAligned(2, [], [[1, 2, 3]]);
    } catch (err) {
      caught = err;
    }

    expect((caught as CovariateAlignmentError).covariate).toBe('covariate[0]');
  });
});

describe('buildPastCovariates', () => {
  it('builds rows that all equal the target series length', () => {
    const grid = hourlyGrid(5);
    const matrix = buildPastCovariates({
      grid,
      sources: [
        { name: 'chain_risk', points: [at(0, 0.7), at(3, 0.6)] },
        { name: 'governance_activity', points: [at(1, 0.4)] },
      ],
    });

    expect(matrix.contextLength).toBe(5);
    expect(matrix.names).toEqual(['chain_risk', 'governance_activity']);
    expect(matrix.rows).toHaveLength(2);
    for (const row of matrix.rows) {
      expect(row).toHaveLength(5);
    }
    // Hand-computed forward fills.
    expect(matrix.rows[0]).toEqual([0.7, 0.7, 0.7, 0.6, 0.6]);
    expect(matrix.rows[1]).toEqual([0.4, 0.4, 0.4, 0.4, 0.4]);
  });

  it('omits a covariate with no observations rather than zero-filling it', () => {
    // "No data" and "zero risk" are different claims. An unseen series is
    // dropped and named, so a caller can tell "not observed" from "observed as 0".
    const matrix = buildPastCovariates({
      grid: hourlyGrid(3),
      sources: [
        { name: 'chain_risk', points: [at(0, 0.5)] },
        { name: 'incident_impact', points: [] },
      ],
    });

    expect(matrix.names).toEqual(['chain_risk']);
    expect(matrix.rows).toHaveLength(1);
    expect(matrix.omitted).toEqual(['incident_impact']);
  });

  it('reports per-covariate coverage so filled values are visible', () => {
    const matrix = buildPastCovariates({
      grid: hourlyGrid(4),
      sources: [{ name: 'chain_risk', points: [at(3, 0.9)] }],
    });

    const coverage = matrix.coverage[0]!;
    expect(coverage.name).toBe('chain_risk');
    // Only hour 3 has an observation at or before it.
    expect(coverage.observed).toBe(1);
    expect(coverage.filled).toBe(3);
    expect(coverage.ratio).toBeCloseTo(0.25, 10);
  });

  it('reports nothing omitted when every covariate has data', () => {
    const matrix = buildPastCovariates({
      grid: hourlyGrid(2),
      sources: [{ name: 'chain_risk', points: [at(0, 0.5)] }],
    });

    expect(matrix.omitted).toEqual([]);
    expect(matrix.coverage[0]!.ratio).toBe(1);
  });

  it('returns an empty matrix when no covariates are supplied', () => {
    const matrix = buildPastCovariates({ grid: hourlyGrid(3), sources: [] });

    expect(matrix.names).toEqual([]);
    expect(matrix.rows).toEqual([]);
    expect(matrix.contextLength).toBe(3);
  });

  it('produces zero-length rows for an empty grid rather than fabricating steps', () => {
    // An empty grid has nothing to align to. The aligned row is therefore also
    // empty, so the lengths agree at 0 — an honest zero-length matrix rather than
    // invented steps or a spurious alignment failure.
    const matrix = buildPastCovariates({
      grid: [],
      sources: [{ name: 'chain_risk', points: [at(0, 1)] }],
    });

    expect(matrix.contextLength).toBe(0);
    expect(matrix.rows[0]).toEqual([]);
    expect(matrix.coverage[0]!.ratio).toBe(0);
  });
});

describe('cumulativeIncidentSeries', () => {
  it('accumulates severity weights into a monotone series', () => {
    // Weights are the documented rubric: low 1, medium 2, high 4, critical 8.
    // Three incidents → running totals 1, then 1+8=9, then 9+4=13.
    const series = cumulativeIncidentSeries([
      { occurredAt: new Date(Date.UTC(2026, 0, 1, 1)), severity: 'low' },
      { occurredAt: new Date(Date.UTC(2026, 0, 1, 3)), severity: 'critical' },
      { occurredAt: new Date(Date.UTC(2026, 0, 1, 5)), severity: 'high' },
    ]);

    expect(series.map((p) => p.value)).toEqual([1, 9, 13]);
  });

  it('sorts incidents before accumulating', () => {
    const series = cumulativeIncidentSeries([
      { occurredAt: new Date(Date.UTC(2026, 0, 1, 5)), severity: 'high' },
      { occurredAt: new Date(Date.UTC(2026, 0, 1, 1)), severity: 'low' },
    ]);

    expect(series.map((p) => p.value)).toEqual([1, 5]);
    expect(series[0]!.ts.getTime()).toBeLessThan(series[1]!.ts.getTime());
  });

  it('returns an empty series for no incidents', () => {
    expect(cumulativeIncidentSeries([])).toEqual([]);
  });

  it('aligns a cumulative incident series onto the target grid', () => {
    // Combined behaviour: incidents accumulate, then align by forward-fill, so a
    // step between incidents carries the damage-so-far rather than resetting.
    const incidents = cumulativeIncidentSeries([
      { occurredAt: new Date(Date.UTC(2026, 0, 1, 0)), severity: 'medium' },
      { occurredAt: new Date(Date.UTC(2026, 0, 1, 2)), severity: 'high' },
    ]);
    const matrix = buildPastCovariates({
      grid: hourlyGrid(4),
      sources: [{ name: 'incident_impact', points: incidents }],
    });

    expect(matrix.rows[0]).toEqual([2, 2, 6, 6]);
  });
});

describe('emptyCovariateMatrix', () => {
  it('represents "no covariates" without a null branch', () => {
    const matrix = emptyCovariateMatrix(12);

    expect(matrix).toEqual({
      names: [],
      rows: [],
      contextLength: 12,
      coverage: [],
      omitted: [],
    });
  });
});
