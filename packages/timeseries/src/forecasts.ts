import {
  ForecastRunSchema,
  ForecastWireSchema,
  MetricNameSchema,
  quantilesAreMonotonic,
  quantilesFromWire,
  type ForecastRun,
  type ForecastStep,
  type MetricName,
} from './types.js';
import type { SqlRunner } from './runner.js';
import { asDate, asNumber, asString } from './wire.js';

/** Raised when a forecast fails validation before it can be persisted. */
export class ForecastValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForecastValidationError';
  }
}

/** 19 columns per step: run metadata + 9 quantiles + provenance. */
const STEPS_PER_INSERT = 200;

export interface LatestForecast {
  readonly runId: string;
  readonly poolId: string;
  readonly metric: MetricName;
  readonly issuedAt: Date;
  readonly modelVersion: string;
  readonly contextHash: string;
  readonly steps: readonly ForecastStep[];
}

export interface ForecastRunSummary {
  readonly runId: string;
  readonly poolId: string;
  readonly metric: MetricName;
  readonly issuedAt: Date;
  readonly modelVersion: string;
  readonly contextHash: string;
  readonly stepCount: number;
}

/**
 * Append-only ledger for TimesFM-3 runs.
 *
 * Both forecasts and realized metrics are hypertable rows, so "was the
 * forecast right?" is a SQL join on `(pool_id, metric, target_ts = ts)`
 * rather than application-side matching — that is why `target_ts` is stored
 * even though `issued_at` is the time column.
 */
export class ForecastRepository {
  constructor(private readonly runner: SqlRunner) {}

  /**
   * Persist a full run (one row per horizon step). Validated before write:
   * quantile monotonicity is a hard precondition, mirrored by the DB CHECK
   * constraint so a bypassed client still cannot store an incoherent run.
   */
  async saveRun(run: ForecastRun): Promise<number> {
    const validated = ForecastRunSchema.parse(run);
    for (const step of validated.steps) {
      if (!quantilesAreMonotonic(step.quantiles)) {
        throw new ForecastValidationError(
          `run ${validated.runId} step ${step.horizonStep}: quantiles are not monotonic`,
        );
      }
    }

    let written = 0;
    for (let start = 0; start < validated.steps.length; start += STEPS_PER_INSERT) {
      const chunk = validated.steps.slice(start, start + STEPS_PER_INSERT);
      const values: unknown[] = [];
      const tuples = chunk.map((step, i) => {
        const b = i * 19;
        const q = step.quantiles;
        values.push(
          validated.runId,
          validated.issuedAt,
          step.targetTs,
          validated.poolId,
          validated.metric,
          step.horizonStep,
          step.point,
          q.q10, q.q20, q.q30, q.q40, q.q50, q.q60, q.q70, q.q80, q.q90,
          validated.modelVersion,
          validated.contextHash,
          validated.latencyMs ?? null,
        );
        return `(${Array.from({ length: 19 }, (_, k) => `$${b + k + 1}`).join(', ')})`;
      });

      const sql = `
        INSERT INTO ts_forecasts
          (run_id, issued_at, target_ts, pool_id, metric, horizon_step, point,
           q10, q20, q30, q40, q50, q60, q70, q80, q90,
           model_version, context_hash, latency_ms)
        VALUES ${tuples.join(', ')}
        ON CONFLICT (run_id, issued_at, horizon_step) DO UPDATE SET
          point = EXCLUDED.point,
          q10 = EXCLUDED.q10, q20 = EXCLUDED.q20, q30 = EXCLUDED.q30,
          q40 = EXCLUDED.q40, q50 = EXCLUDED.q50, q60 = EXCLUDED.q60,
          q70 = EXCLUDED.q70, q80 = EXCLUDED.q80, q90 = EXCLUDED.q90,
          target_ts = EXCLUDED.target_ts,
          context_hash = EXCLUDED.context_hash,
          latency_ms = EXCLUDED.latency_ms`;
      await this.runner.query(sql, values);
      written += chunk.length;
    }
    return written;
  }

  /** Newest stored path for a pool+metric (via `ts_forecasts_latest`). */
  async getLatest(poolId: string, metric: MetricName): Promise<LatestForecast | null> {
    const parsedMetric = MetricNameSchema.parse(metric);
    const res = await this.runner.query(
      `SELECT run_id, issued_at, target_ts, pool_id, metric, horizon_step, point,
              q10, q20, q30, q40, q50, q60, q70, q80, q90,
              model_version, context_hash, latency_ms
       FROM ts_forecasts_latest
       WHERE pool_id = $1 AND metric = $2
       ORDER BY target_ts ASC`,
      [poolId, parsedMetric],
    );
    if (res.rows.length === 0) return null;

    const steps: ForecastStep[] = [];
    let head: { runId: string; issuedAt: Date; modelVersion: string; contextHash: string } | null = null;

    for (const raw of res.rows) {
      const wire = ForecastWireSchema.parse(raw);
      if (head === null) {
        head = {
          runId: wire.run_id,
          issuedAt: wire.issued_at,
          modelVersion: wire.model_version,
          contextHash: wire.context_hash,
        };
      }
      steps.push({
        targetTs: wire.target_ts,
        horizonStep: wire.horizon_step,
        point: wire.point ?? 0,
        quantiles: quantilesFromWire(wire),
      });
    }
    if (head === null) return null;

    return {
      runId: head.runId,
      poolId,
      metric: parsedMetric,
      issuedAt: head.issuedAt,
      modelVersion: head.modelVersion,
      contextHash: head.contextHash,
      steps,
    };
  }

  /** One row per run in the window — cheap listing for the UI and reports. */
  async listRuns(
    poolId: string,
    range: { readonly from: Date; readonly to: Date },
  ): Promise<readonly ForecastRunSummary[]> {
    const res = await this.runner.query(
      `SELECT run_id, pool_id, metric, min(issued_at) AS issued_at,
              min(model_version) AS model_version,
              min(context_hash) AS context_hash,
              count(*)::int AS step_count
       FROM ts_forecasts
       WHERE pool_id = $1 AND issued_at >= $2 AND issued_at <= $3
       GROUP BY run_id, pool_id, metric
       ORDER BY issued_at DESC`,
      [poolId, range.from, range.to],
    );

    const out: ForecastRunSummary[] = [];
    for (const row of res.rows) {
      const runId = asString(row['run_id']);
      const issuedAt = asDate(row['issued_at']);
      const metric = MetricNameSchema.safeParse(row['metric']);
      if (runId === null || issuedAt === null || !metric.success) continue;
      out.push({
        runId,
        poolId,
        metric: metric.data,
        issuedAt,
        modelVersion: asString(row['model_version']) ?? 'unknown',
        contextHash: asString(row['context_hash']) ?? '',
        stepCount: asNumber(row['step_count']) ?? 0,
      });
    }
    return out;
  }

  /** Every step of a specific run — the replay/audit path. */
  async getRun(runId: string): Promise<LatestForecast | null> {
    const res = await this.runner.query(
      `SELECT run_id, issued_at, target_ts, pool_id, metric, horizon_step, point,
              q10, q20, q30, q40, q50, q60, q70, q80, q90,
              model_version, context_hash, latency_ms
       FROM ts_forecasts
       WHERE run_id = $1
       ORDER BY horizon_step ASC`,
      [runId],
    );
    if (res.rows.length === 0) return null;

    const steps: ForecastStep[] = [];
    let head: { poolId: string; metric: MetricName; issuedAt: Date; modelVersion: string; contextHash: string } | null =
      null;
    for (const raw of res.rows) {
      const wire = ForecastWireSchema.parse(raw);
      const metric = MetricNameSchema.safeParse(wire.metric);
      if (!metric.success) continue;
      if (head === null) {
        head = {
          poolId: wire.pool_id,
          metric: metric.data,
          issuedAt: wire.issued_at,
          modelVersion: wire.model_version,
          contextHash: wire.context_hash,
        };
      }
      steps.push({
        targetTs: wire.target_ts,
        horizonStep: wire.horizon_step,
        point: wire.point ?? 0,
        quantiles: quantilesFromWire(wire),
      });
    }
    if (head === null) return null;
    return {
      runId,
      poolId: head.poolId,
      metric: head.metric,
      issuedAt: head.issuedAt,
      modelVersion: head.modelVersion,
      contextHash: head.contextHash,
      steps,
    };
  }
}
