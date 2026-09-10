import { describe, expect, it } from 'vitest';
import { TimeseriesClient } from '../src/client.js';
import type { SqlRunner } from '../src/runner.js';
import type { PoolMetricRow } from '../src/types.js';

/** Captures SQL + params, returns canned rows per call. */
class FakeRunner implements SqlRunner {
  readonly queries: Array<{ text: string; values: readonly unknown[] }> = [];
  private responses: Array<Record<string, unknown>[]> = [];

  queue(rows: Record<string, unknown>[]): void {
    this.responses.push(rows);
  }

  async query(text: string, values: readonly unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    this.queries.push({ text, values });
    const rows = this.responses.shift() ?? [];
    return { rows };
  }
}

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

describe('TimeseriesClient.upsertPoolMetrics', () => {
  it('emits a parameterized idempotent upsert', async () => {
    const r = new FakeRunner();
    const client = new TimeseriesClient(r);
    const n = await client.upsertPoolMetrics([row(), row({ poolId: '0xpool2', ts: new Date('2026-09-10T01:00:00Z') })]);
    expect(n).toBe(2);
    expect(r.queries).toHaveLength(1);
    const q = r.queries[0]!;
    expect(q.text).toContain('INSERT INTO pool_metrics_hourly');
    expect(q.text).toContain('ON CONFLICT (pool_id, ts) DO UPDATE');
    expect(q.values.filter((v) => v === '0xpool').length).toBe(1);
    expect(q.values).toHaveLength(20); // 10 columns × 2 rows
  });

  it('no-ops on an empty batch', async () => {
    const r = new FakeRunner();
    const client = new TimeseriesClient(r);
    expect(await client.upsertPoolMetrics([])).toBe(0);
    expect(r.queries).toHaveLength(0);
  });

  it('rejects malformed rows at the boundary', async () => {
    const r = new FakeRunner();
    const client = new TimeseriesClient(r);
    await expect(
      client.upsertPoolMetrics([row({ poolId: '' })]),
    ).rejects.toThrow();
    expect(r.queries).toHaveLength(0);
  });
});

describe('TimeseriesClient.getMetricWindow', () => {
  it('maps wire rows (snake_case, string numerics) to a typed window', async () => {
    const r = new FakeRunner();
    r.queue([
      { pool_id: '0xpool', ts: new Date('2026-09-09T00:00:00Z'), protocol: 'aave-v3', network: 'ethereum', apy: '0.04', volume_usd: '100', tvl_usd: '500', utilization: '0.7', vol: '0.3', tx_count: '10' },
      { pool_id: '0xpool', ts: new Date('2026-09-09T01:00:00Z'), protocol: 'aave-v3', network: 'ethereum', apy: '0.05', volume_usd: '110', tvl_usd: '501', utilization: '0.71', vol: '0.32', tx_count: '12' },
    ]);
    const client = new TimeseriesClient(r);
    const w = await client.getMetricWindow('0xpool', 'apy', new Date('2026-09-09T00:00:00Z'));
    expect(w.values).toEqual([0.04, 0.05]);
    expect(w.timestamps).toHaveLength(2);
    expect(r.queries[0]!.text).toContain('WHERE pool_id = $1 AND ts >= $2');
    expect(r.queries[0]!.text).toContain('ORDER BY ts ASC');
  });

  it('skips null metric points instead of guessing', async () => {
    const r = new FakeRunner();
    r.queue([
      { pool_id: '0xpool', ts: new Date('2026-09-09T00:00:00Z'), protocol: 'x', network: 'ethereum', apy: null, volume_usd: null, tvl_usd: null, utilization: null, vol: null, tx_count: null },
      { pool_id: '0xpool', ts: new Date('2026-09-09T01:00:00Z'), protocol: 'x', network: 'ethereum', apy: '0.05', volume_usd: '110', tvl_usd: '501', utilization: '0.71', vol: '0.32', tx_count: '12' },
    ]);
    const client = new TimeseriesClient(r);
    const w = await client.getMetricWindow('0xpool', 'apy', new Date('2026-09-09T00:00:00Z'));
    expect(w.values).toEqual([0.05]);
    expect(w.timestamps).toHaveLength(1);
  });
});

describe('TimeseriesClient.saveForecast / saveBacktestRun', () => {
  it('persists a multi-step quantile forecast', async () => {
    const r = new FakeRunner();
    const client = new TimeseriesClient(r);
    const n = await client.saveForecast({
      poolId: '0xpool',
      target: 'apy',
      modelVersion: 'timesfm-3.0',
      inputsHash: 'abc123',
      steps: [
        { ts: new Date('2026-09-11T00:00:00Z'), q10: 0.03, q50: 0.04, q90: 0.05 },
        { ts: new Date('2026-09-12T00:00:00Z'), q10: 0.031, q50: 0.041, q90: 0.052 },
      ],
    });
    expect(n).toBe(2);
    const q = r.queries[0]!;
    expect(q.text).toContain('INSERT INTO timesfm_forecasts');
    expect(q.text).toContain('ON CONFLICT (pool_id, target, horizon_ts, model_version)');
    expect(q.values).toHaveLength(16); // 8 params × 2 steps
  });

  it('saves a backtest run and returns its id', async () => {
    const r = new FakeRunner();
    r.queue([{ id: 42 }]);
    const client = new TimeseriesClient(r);
    const id = await client.saveBacktestRun({
      poolId: '0xpool', windowDays: 30, strategy: 'baseline', hitRate: 0.82, mape: 0.11, pnlVsHodl: 1.4,
    });
    expect(id).toBe(42);
    expect(r.queries[0]!.text).toContain('INSERT INTO backtest_runs');
  });
});
