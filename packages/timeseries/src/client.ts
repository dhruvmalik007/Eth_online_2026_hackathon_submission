import { TimescaleDB } from '@timescaledb/core';
import {
  BacktestRunSchema,
  METRIC_COLUMNS,
  MetricNameSchema,
  MetricWindowPointWireSchema,
  PoolMetricRowSchema,
  METRIC_NAMES,
  type BacktestRun,
  type MetricName,
  type MetricWindow,
  type PoolMetricRow,
  type TimeBucketPoint,
} from './types.js';
import type { SqlRunner } from './runner.js';
import { asDate, asNumber } from './wire.js';

/**
 * Typed TimescaleDB client for the metric store. All SQL is parameterized;
 * wire rows are zod-validated at the boundary (pg numerics arrive as decimal
 * strings). Batch upserts use ON CONFLICT — the poller is idempotent per
 * (pool, ts).
 *
 * Forecasts, decisions, evaluation and embeddings live in their own
 * repositories; this client owns `pool_metrics_hourly` and the backtest log.
 */
export class TimeseriesClient {
  constructor(private readonly runner: SqlRunner) {}

  /** Idempotent batch upsert of hourly pool metrics. */
  async upsertPoolMetrics(rows: readonly PoolMetricRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const validated = rows.map((r) => PoolMetricRowSchema.parse(r));
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
    metric: MetricName,
    since: Date,
    until?: Date,
  ): Promise<MetricWindow> {
    // The column comes from our own catalog (never caller input), and it is
    // aliased to `value` so the wire shape is identical for every metric.
    const column = METRIC_COLUMNS[MetricNameSchema.parse(metric)];
    const res =
      until === undefined
        ? await this.runner.query(
            `SELECT pool_id, ts, ${column} AS value FROM pool_metrics_hourly
             WHERE pool_id = $1 AND ts >= $2 ORDER BY ts ASC`,
            [poolId, since],
          )
        : await this.runner.query(
            `SELECT pool_id, ts, ${column} AS value FROM pool_metrics_hourly
             WHERE pool_id = $1 AND ts >= $2 AND ts <= $3 ORDER BY ts ASC`,
            [poolId, since, until],
          );

    const timestamps: Date[] = [];
    const values: number[] = [];
    for (const raw of res.rows) {
      const wire = MetricWindowPointWireSchema.parse(raw);
      if (wire.value !== null && wire.value !== undefined) {
        timestamps.push(wire.ts);
        values.push(wire.value);
      }
    }
    return { poolId, metric, timestamps, values };
  }

  /** Multi-target window (one series per metric) — TimesFM-3 multivariate input. */
  async getMultiSeriesWindow(poolId: string, since: Date): Promise<readonly MetricWindow[]> {
    return Promise.all(METRIC_NAMES.map((metric) => this.getMetricWindow(poolId, metric, since)));
  }

  /**
   * Time-bucketed aggregate for one pool, built by the core `timeBucket`
   * builder (parameterized interval + range + WHERE — no interpolation).
   * Powers the indexer's chart series.
   */
  async getMetricWindowBucketed(
    poolId: string,
    metric: MetricName,
    interval: string,
    range: { readonly start: Date; readonly end: Date },
  ): Promise<readonly TimeBucketPoint[]> {
    const column = METRIC_COLUMNS[MetricNameSchema.parse(metric)];
    const { sql, params } = TimescaleDB
      .createHypertable('pool_metrics_hourly', { by_range: { column_name: 'ts' } })
      .timeBucket({
        interval,
        metrics: [
          { type: 'avg', column, alias: 'avg' },
          { type: 'min', column, alias: 'min' },
          { type: 'max', column, alias: 'max' },
          { type: 'count', alias: 'samples' },
        ],
      })
      .build({ range, where: { pool_id: poolId } });

    const res = await this.runner.query(sql, params);

    const points: TimeBucketPoint[] = [];
    for (const row of res.rows) {
      const bucketStart = asDate(row['interval']);
      if (bucketStart === null) continue;
      const values: Record<string, number> = {};
      for (const key of ['avg', 'min', 'max', 'samples'] as const) {
        const v = asNumber(row[key]);
        if (v !== null) values[key] = v;
      }
      points.push({ bucketStart, values });
    }
    // The builder orders DESC; chart consumers want chronological order.
    return points.sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime());
  }

  /** What the metric store actually holds — health checks and empty states. */
  async getCoverage(): Promise<StoreCoverage> {
    const res = await this.runner.query(
      `SELECT count(DISTINCT pool_id)::int AS pools,
              count(*)::int AS rows,
              min(ts) AS earliest,
              max(ts) AS latest
       FROM pool_metrics_hourly`,
    );
    const row = res.rows[0];
    return {
      poolCount: asNumber(row?.['pools']) ?? 0,
      rowCount: asNumber(row?.['rows']) ?? 0,
      earliest: asDate(row?.['earliest']),
      latest: asDate(row?.['latest']),
    };
  }

  /** Cheap liveness probe for the indexer health route. */
  async ping(): Promise<boolean> {
    const res = await this.runner.query('SELECT 1 AS ok');
    return asNumber(res.rows[0]?.['ok']) === 1;
  }

  async saveBacktestRun(run: BacktestRun): Promise<number> {
    const r = BacktestRunSchema.parse(run);
    const res = await this.runner.query(
      `INSERT INTO backtest_runs (pool_id, window_days, strategy, hit_rate, mape, pnl_vs_hodl)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [r.poolId, r.windowDays, r.strategy, r.hitRate ?? null, r.mape ?? null, r.pnlVsHodl ?? null],
    );
    const id = asNumber(res.rows[0]?.['id']);
    if (id === null) {
      throw new Error('backtest_runs insert returned no id');
    }
    return id;
  }
}

export interface StoreCoverage {
  readonly poolCount: number;
  readonly rowCount: number;
  readonly earliest: Date | null;
  readonly latest: Date | null;
}
