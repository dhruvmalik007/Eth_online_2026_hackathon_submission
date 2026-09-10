import type { MetricWindow } from './types.js';
import {
  BacktestRunSchema,
  ForecastRecordSchema,
  PoolMetricRowSchema,
  PoolMetricWireSchema,
  type BacktestRun,
  type ForecastRecord,
  type PoolMetricRow,
} from './types.js';
import type { SqlRunner } from './runner.js';

/**
 * Typed TimescaleDB client. All SQL is parameterized; wire rows are zod-
 * validated at the boundary (pg numerics arrive as decimal strings).
 * Batch upserts use ON CONFLICT — the poller is idempotent per (pool, ts).
 */
export class TimeseriesClient {
  constructor(private readonly runner: SqlRunner) {}

  /** Idempotent batch upsert of hourly pool metrics. */
  async upsertPoolMetrics(rows: readonly PoolMetricRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const validated = rows.map((r) => PoolMetricRowSchema.parse(r));
    // Multi-row insert: 10 columns per row.
    const chunkSize = 100;
    let inserted = 0;
    for (let start = 0; start < validated.length; start += chunkSize) {
      const chunk = validated.slice(start, start + chunkSize);
      const values: unknown[] = [];
      const tuples = chunk.map((r, i) => {
        const b = i * 10;
        values.push(
          r.poolId, r.ts, r.protocol, r.network,
          r.apy ?? null, r.volumeUsd ?? null, r.tvlUsd ?? null,
          r.utilization ?? null, r.vol ?? null, r.txCount ?? null,
        );
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10})`;
      });
      const sql = `
        INSERT INTO pool_metrics_hourly
          (pool_id, ts, protocol, network, apy, volume_usd, tvl_usd, utilization, vol, tx_count)
        VALUES ${tuples.join(', ')}
        ON CONFLICT (pool_id, ts) DO UPDATE SET
          protocol = EXCLUDED.protocol,
          network = EXCLUDED.network,
          apy = EXCLUDED.apy,
          volume_usd = EXCLUDED.volume_usd,
          tvl_usd = EXCLUDED.tvl_usd,
          utilization = EXCLUDED.utilization,
          vol = EXCLUDED.vol,
          tx_count = EXCLUDED.tx_count,
          ingested_at = now()`;
      await this.runner.query(sql, values);
      inserted += chunk.length;
    }
    return inserted;
  }

  /** A single-metric window for one pool — the TimesFM-3 `series` input. */
  async getMetricWindow(
    poolId: string,
    metric: MetricWindow['metric'],
    since: Date,
  ): Promise<MetricWindow> {
    const column = METRIC_COLUMNS[metric];
    const res = await this.runner.query(
      `SELECT ts, ${column} FROM pool_metrics_hourly
       WHERE pool_id = $1 AND ts >= $2 ORDER BY ts ASC`,
      [poolId, since],
    );
    const timestamps: Date[] = [];
    const values: number[] = [];
    for (const raw of res.rows) {
      const wire = PoolMetricWireSchema.parse(raw);
      const v = wire[WIRE_COLUMN[metric]];
      if (v !== null && v !== undefined) {
        timestamps.push(wire.ts);
        values.push(v);
      }
    }
    return { poolId, metric, timestamps, values };
  }

  /** Multi-target window (one matrix per pool) — TimesFM-3 multivariate input. */
  async getMultiSeriesWindow(
    poolId: string,
    since: Date,
  ): Promise<readonly MetricWindow[]> {
    return Promise.all(
      (['apy', 'volume', 'tvl', 'utilization'] as const).map((metric) =>
        this.getMetricWindow(poolId, metric, since),
      ),
    );
  }

  /** Persist a TimesFM-3 forecast (cache + audit trail). */
  async saveForecast(record: ForecastRecord): Promise<number> {
    const r = ForecastRecordSchema.parse(record);
    const values: unknown[] = [];
    const tuples = r.steps.map((s, i) => {
      const b = i * 8;
      values.push(r.poolId, r.target, s.ts, s.q10, s.q50, s.q90, r.modelVersion, r.inputsHash);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8})`;
    });
    const sql = `
      INSERT INTO timesfm_forecasts (pool_id, target, horizon_ts, q10, q50, q90, model_version, inputs_hash)
      VALUES ${tuples.join(', ')}
      ON CONFLICT (pool_id, target, horizon_ts, model_version) DO UPDATE SET
        q10 = EXCLUDED.q10, q50 = EXCLUDED.q50, q90 = EXCLUDED.q90, inputs_hash = EXCLUDED.inputs_hash`;
    await this.runner.query(sql, values);
    return r.steps.length;
  }

  async saveBacktestRun(run: BacktestRun): Promise<number> {
    const r = BacktestRunSchema.parse(run);
    const res = await this.runner.query(
      `INSERT INTO backtest_runs (pool_id, window_days, strategy, hit_rate, mape, pnl_vs_hodl)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [r.poolId, r.windowDays, r.strategy, r.hitRate ?? null, r.mape ?? null, r.pnlVsHodl ?? null],
    );
    const id = res.rows[0]?.id;
    if (typeof id !== 'number') {
      throw new Error('backtest_runs insert returned no id');
    }
    return id;
  }
}

const METRIC_COLUMNS = {
  apy: 'apy',
  volume: 'volume_usd',
  tvl: 'tvl_usd',
  utilization: 'utilization',
} as const;

/** Metric enum → validated wire-row field. */
const WIRE_COLUMN: Record<MetricWindow['metric'], 'apy' | 'volume_usd' | 'tvl_usd' | 'utilization'> = {
  apy: 'apy',
  volume: 'volume_usd',
  tvl: 'tvl_usd',
  utilization: 'utilization',
};
