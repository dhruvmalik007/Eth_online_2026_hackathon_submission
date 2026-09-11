import type {
  CalibrationRow,
  CalibrationSummary,
  DecisionOutcomeRow,
  RealizedYieldRow,
} from './types.js';
import type { SqlRunner } from './runner.js';
import { asDate, asNumber, asString } from './wire.js';

/** Numeric columns arrive as decimal strings; a null column means no data. */
function requiredNumber(value: unknown): number {
  return asNumber(value) ?? 0;
}

function optionalNumber(value: unknown): number | null {
  return asNumber(value);
}

/**
 * Time-stamped performance evaluation.
 *
 * Every figure here is computed by SQL views, never by the application and
 * never by a language model — the agent may quote these numbers but has no
 * path to inventing them. Three questions are answered:
 *
 *  - `getCalibration`      — was each forecast step accurate? (pinball, coverage)
 *  - `getRealizedYield`    — what yield actually materialized, bucketed?
 *  - `getDecisionOutcomes` — did past decisions beat the baseline?
 */
export class PerformanceRepository {
  constructor(private readonly runner: SqlRunner) {}

  /** Per-step calibration: forecast joined to the realized observation. */
  async getCalibration(
    poolId: string,
    range: { readonly from: Date; readonly to: Date },
    options: { readonly metric?: string; readonly limit?: number } = {},
  ): Promise<readonly CalibrationRow[]> {
    const metric = options.metric ?? null;
    const limit = Math.min(Math.max(options.limit ?? 500, 1), 5000);
    const res = await this.runner.query(
      `SELECT run_id, pool_id, metric, target_ts, horizon_step,
              forecast_q10, forecast_q50, forecast_q90, actual,
              signed_error, absolute_error, pinball_loss, covered, model_version
       FROM v_forecast_calibration
       WHERE pool_id = $1 AND target_ts >= $2 AND target_ts <= $3
         AND ($4::text IS NULL OR metric = $4)
       ORDER BY target_ts DESC
       LIMIT $5`,
      [poolId, range.from, range.to, metric, limit],
    );

    const out: CalibrationRow[] = [];
    for (const row of res.rows) {
      const targetTs = asDate(row['target_ts']);
      const runId = asString(row['run_id']);
      if (targetTs === null || runId === null) continue;
      out.push({
        runId,
        poolId: asString(row['pool_id']) ?? poolId,
        metric: asString(row['metric']) ?? 'unknown',
        targetTs,
        horizonStep: requiredNumber(row['horizon_step']),
        forecastQ10: requiredNumber(row['forecast_q10']),
        forecastQ50: requiredNumber(row['forecast_q50']),
        forecastQ90: requiredNumber(row['forecast_q90']),
        actual: requiredNumber(row['actual']),
        signedError: requiredNumber(row['signed_error']),
        absoluteError: requiredNumber(row['absolute_error']),
        pinballLoss: requiredNumber(row['pinball_loss']),
        covered: row['covered'] === true,
        modelVersion: asString(row['model_version']) ?? 'unknown',
      });
    }
    return out;
  }

  /**
   * Aggregated reliability per metric: empirical coverage (does the q10–q90
   * band contain reality as often as it claims?) plus mean pinball loss.
   */
  async getCalibrationSummary(
    poolId: string,
    range: { readonly from: Date; readonly to: Date },
  ): Promise<readonly CalibrationSummary[]> {
    const res = await this.runner.query(
      `SELECT pool_id, metric,
              count(*)::int AS samples,
              avg(CASE WHEN covered THEN 1.0 ELSE 0.0 END) AS coverage,
              avg(pinball_loss) AS mean_pinball_loss,
              avg(absolute_error) AS mean_absolute_error,
              CASE WHEN avg(abs(forecast_q50)) > 0
                   THEN avg(absolute_error / abs(forecast_q50))
                   ELSE NULL END AS mape
       FROM v_forecast_calibration
       WHERE pool_id = $1 AND target_ts >= $2 AND target_ts <= $3
       GROUP BY pool_id, metric
       ORDER BY metric ASC`,
      [poolId, range.from, range.to],
    );

    const out: CalibrationSummary[] = [];
    for (const row of res.rows) {
      out.push({
        poolId: asString(row['pool_id']) ?? poolId,
        metric: asString(row['metric']) ?? 'unknown',
        samples: requiredNumber(row['samples']),
        coverage: requiredNumber(row['coverage']),
        meanPinballLoss: requiredNumber(row['mean_pinball_loss']),
        meanAbsoluteError: requiredNumber(row['mean_absolute_error']),
        meanAbsolutePercentageError: optionalNumber(row['mape']),
      });
    }
    return out;
  }

  /** Realized APY per pool over daily buckets. */
  async getRealizedYield(
    poolId: string,
    range: { readonly from: Date; readonly to: Date },
  ): Promise<readonly RealizedYieldRow[]> {
    const res = await this.runner.query(
      `SELECT pool_id, bucket_start, avg_apy, min_apy, max_apy, avg_tvl, samples
       FROM v_realized_yield
       WHERE pool_id = $1 AND bucket_start >= $2 AND bucket_start <= $3
       ORDER BY bucket_start ASC`,
      [poolId, range.from, range.to],
    );

    const out: RealizedYieldRow[] = [];
    for (const row of res.rows) {
      const bucketStart = asDate(row['bucket_start']);
      if (bucketStart === null) continue;
      out.push({
        poolId: asString(row['pool_id']) ?? poolId,
        bucketStart,
        avgApy: requiredNumber(row['avg_apy']),
        minApy: requiredNumber(row['min_apy']),
        maxApy: requiredNumber(row['max_apy']),
        avgTvl: optionalNumber(row['avg_tvl']),
        samples: requiredNumber(row['samples']),
      });
    }
    return out;
  }

  /** Past decisions scored against what the market did next. */
  async getDecisionOutcomes(
    poolId: string,
    range: { readonly from: Date; readonly to: Date },
  ): Promise<readonly DecisionOutcomeRow[]> {
    const res = await this.runner.query(
      `SELECT decision_id, pool_id, action, size_usd, decided_at, horizon_end,
              realized_apy, baseline_apy, outcome_score
       FROM v_decision_outcomes
       WHERE pool_id = $1 AND decided_at >= $2 AND decided_at <= $3
       ORDER BY decided_at DESC`,
      [poolId, range.from, range.to],
    );

    const out: DecisionOutcomeRow[] = [];
    for (const row of res.rows) {
      const decisionId = asString(row['decision_id']);
      const decidedAt = asDate(row['decided_at']);
      const horizonEnd = asDate(row['horizon_end']);
      if (decisionId === null || decidedAt === null || horizonEnd === null) continue;
      out.push({
        decisionId,
        poolId: asString(row['pool_id']) ?? poolId,
        action: asString(row['action']) ?? 'HOLD',
        sizeUsd: requiredNumber(row['size_usd']),
        decidedAt,
        horizonEnd,
        realizedApy: requiredNumber(row['realized_apy']),
        baselineApy: optionalNumber(row['baseline_apy']),
        outcomeScore: optionalNumber(row['outcome_score']),
      });
    }
    return out;
  }
}
