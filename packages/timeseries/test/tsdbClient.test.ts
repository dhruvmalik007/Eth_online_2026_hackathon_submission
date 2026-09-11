import { describe, expect, it } from 'vitest';
import { TimeseriesClient } from '../src/client.js';
import type { PoolMetricRow } from '../src/types.js';
import { RoutingFakeRunner } from './helpers.js';

const row = (over: Partial<PoolMetricRow> = {}): PoolMetricRow => ({
  poolId: '0xpool',
  ts: new Date('2026-09-10T00:00:00Z'),
  protocol: 'aave-v3',
  network: 'ethereum',
  apy: 0.042,
  volumeUsd: 1_000_000,
  tvlUsd: 50_000_000,
  utilization: 0.72,
  vol: 0.31,
  txCount: 1200,
  ...over,
});

/**
 * Window reads project a single metric column aliased to `value`, so the
 * fixture mirrors that narrow shape (protocol/network are not selected).
 */
const metricRow = (ts: string, value: string | null): Record<string, unknown> => ({
  pool_id: '0xpool',
  ts: new Date(ts),
  value,
});

describe('TimeseriesClient.upsertPoolMetrics', () => {
  it('emits a parameterized idempotent upsert', async () => {
    const r = new RoutingFakeRunner();
    const client = new TimeseriesClient(r);
    const n = await client.upsertPoolMetrics([
      row(),
      row({ poolId: '0xpool2', ts: new Date('2026-09-10T01:00:00Z') }),
    ]);
    expect(n).toBe(2);
    const q = r.find('INSERT INTO pool_metrics_hourly');
    expect(q?.text).toContain('ON CONFLICT (pool_id, ts) DO UPDATE');
    expect(q?.values.filter((v) => v === '0xpool').length).toBe(1);
    expect(q?.values).toHaveLength(20); // 10 columns × 2 rows
  });

  it('no-ops on an empty batch', async () => {
    const r = new RoutingFakeRunner();
    expect(await new TimeseriesClient(r).upsertPoolMetrics([])).toBe(0);
    expect(r.queries).toHaveLength(0);
  });

  it('rejects malformed rows at the boundary', async () => {
    const r = new RoutingFakeRunner();
    await expect(new TimeseriesClient(r).upsertPoolMetrics([row({ poolId: '' })])).rejects.toThrow();
    expect(r.queries).toHaveLength(0);
  });
});

describe('TimeseriesClient.getMetricWindow', () => {
  it('projects the metric column aliased to value and maps it', async () => {
    const r = new RoutingFakeRunner().on('AS value FROM pool_metrics_hourly', [
      metricRow('2026-09-09T00:00:00Z', '0.04'),
      metricRow('2026-09-09T01:00:00Z', '0.05'),
    ]);
    const w = await new TimeseriesClient(r).getMetricWindow(
      '0xpool',
      'apy',
      new Date('2026-09-09T00:00:00Z'),
    );
    expect(w.values).toEqual([0.04, 0.05]);
    expect(w.timestamps).toHaveLength(2);
    // Only the columns the window needs are selected — validating a partial
    // projection against the full row schema is what broke against live data.
    const q = r.find('AS value FROM pool_metrics_hourly');
    expect(q?.text).toContain('SELECT pool_id, ts, apy AS value');
    expect(q?.text).toContain('ORDER BY ts ASC');
  });

  it('brackets the window when an upper bound is supplied', async () => {
    const r = new RoutingFakeRunner().on('AS value FROM pool_metrics_hourly', []);
    await new TimeseriesClient(r).getMetricWindow(
      '0xpool',
      'apy',
      new Date('2026-09-01T00:00:00Z'),
      new Date('2026-09-09T00:00:00Z'),
    );
    expect(r.find('AND ts <= $3')).toBeDefined();
  });

  it('skips null metric points instead of guessing', async () => {
    const r = new RoutingFakeRunner().on('AS value FROM pool_metrics_hourly', [
      metricRow('2026-09-09T00:00:00Z', null),
      metricRow('2026-09-09T01:00:00Z', '0.05'),
    ]);
    const w = await new TimeseriesClient(r).getMetricWindow(
      '0xpool',
      'apy',
      new Date('2026-09-09T00:00:00Z'),
    );
    expect(w.values).toEqual([0.05]);
  });

  it('reads a non-apy metric from its own column', async () => {
    const r = new RoutingFakeRunner().on('AS value FROM pool_metrics_hourly', []);
    await new TimeseriesClient(r).getMetricWindow('0xpool', 'utilization', new Date());
    expect(r.find('SELECT pool_id, ts, utilization AS value')).toBeDefined();
  });

  it('accepts a numeric column delivered as a number', async () => {
    const r = new RoutingFakeRunner().on('AS value FROM pool_metrics_hourly', [
      { pool_id: '0xpool', ts: new Date('2026-09-09T00:00:00Z'), value: 0.07 },
    ]);
    const w = await new TimeseriesClient(r).getMetricWindow('0xpool', 'apy', new Date());
    expect(w.values).toEqual([0.07]);
  });
});

describe('TimeseriesClient.getMetricWindowBucketed', () => {
  it('builds a parameterized time_bucket query and orders results ascending', async () => {
    const r = new RoutingFakeRunner().on('time_bucket', [
      { interval: '2026-09-02T00:00:00Z', avg: '0.05', min: '0.04', max: '0.06', samples: '24' },
      { interval: '2026-09-01T00:00:00Z', avg: '0.04', min: '0.03', max: '0.05', samples: '23' },
    ]);
    const points = await new TimeseriesClient(r).getMetricWindowBucketed(
      '0xpool',
      'apy',
      '1 day',
      { start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-09-03T00:00:00Z') },
    );

    const q = r.find('time_bucket');
    // The core builder parameterizes interval, range and WHERE — no interpolation.
    expect(q?.text).toContain('time_bucket($1::interval');
    expect(q?.values[0]).toBe('1 day');
    expect(q?.values).toContain('0xpool');

    expect(points).toHaveLength(2);
    expect(points[0]!.bucketStart.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(points[0]!.values).toEqual({ avg: 0.04, min: 0.03, max: 0.05, samples: 23 });
  });

  it('degrades a row with an unparseable bucket to a skip', async () => {
    const r = new RoutingFakeRunner().on('time_bucket', [{ interval: 'not-a-date', avg: '1' }]);
    const points = await new TimeseriesClient(r).getMetricWindowBucketed(
      '0xpool',
      'apy',
      '1 hour',
      { start: new Date(), end: new Date() },
    );
    expect(points).toHaveLength(0);
  });
});

describe('TimeseriesClient coverage and health', () => {
  it('summarises what the store holds', async () => {
    const r = new RoutingFakeRunner().on('count(DISTINCT pool_id)', [
      { pools: 3, rows: '120', earliest: new Date('2026-09-01T00:00:00Z'), latest: new Date('2026-09-10T00:00:00Z') },
    ]);
    const coverage = await new TimeseriesClient(r).getCoverage();
    expect(coverage.poolCount).toBe(3);
    expect(coverage.rowCount).toBe(120);
    expect(coverage.latest?.toISOString()).toBe('2026-09-10T00:00:00.000Z');
  });

  it('reports an empty store without throwing', async () => {
    const r = new RoutingFakeRunner().on('count(DISTINCT pool_id)', [
      { pools: 0, rows: 0, earliest: null, latest: null },
    ]);
    const coverage = await new TimeseriesClient(r).getCoverage();
    expect(coverage.earliest).toBeNull();
    expect(coverage.rowCount).toBe(0);
  });

  it('pings', async () => {
    const r = new RoutingFakeRunner().on('SELECT 1 AS ok', [{ ok: 1 }]);
    expect(await new TimeseriesClient(r).ping()).toBe(true);
  });
});

describe('TimeseriesClient.saveBacktestRun', () => {
  it('saves a backtest run and returns its id', async () => {
    const r = new RoutingFakeRunner().on('INSERT INTO backtest_runs', [{ id: 42 }]);
    const id = await new TimeseriesClient(r).saveBacktestRun({
      poolId: '0xpool', windowDays: 30, strategy: 'baseline', hitRate: 0.82, mape: 0.11, pnlVsHodl: 1.4,
    });
    expect(id).toBe(42);
  });

  it('fails loudly when the insert returns no id', async () => {
    const r = new RoutingFakeRunner().on('INSERT INTO backtest_runs', []);
    await expect(
      new TimeseriesClient(r).saveBacktestRun({ poolId: '0xpool', windowDays: 30, strategy: 'x' }),
    ).rejects.toThrowError(/returned no id/);
  });
});
