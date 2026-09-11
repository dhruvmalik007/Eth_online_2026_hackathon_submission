import { DecisionRecordSchema, type DecisionRecord } from './types.js';
import type { SqlRunner } from './runner.js';
import { DecisionActionSchema } from './types.js';
import { asDate, asNumber, asString, asStringArray, asJsonObject } from './wire.js';

/**
 * Append-only ledger of agent decisions.
 *
 * Each row records the forecast ids the decision cited, which is what closes
 * the evaluation loop: `v_decision_outcomes` later joins this row to the yield
 * that actually materialized, so the agent can be scored against its own
 * history rather than only against the current forecast.
 */
export class DecisionRepository {
  constructor(private readonly runner: SqlRunner) {}

  async record(decision: DecisionRecord): Promise<void> {
    const d = DecisionRecordSchema.parse(decision);
    await this.runner.query(
      `INSERT INTO ts_decisions
         (decision_id, decided_at, pool_id, action, size_usd, confidence,
          cited_forecast_ids, cited_metric_ids, rationale, state_snapshot, model_versions)
       VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8::text[], $9, $10::jsonb, $11::jsonb)
       ON CONFLICT (decision_id, decided_at) DO NOTHING`,
      [
        d.decisionId,
        d.decidedAt,
        d.poolId,
        d.action,
        d.sizeUsd,
        d.confidence,
        [...d.citedForecastIds],
        [...d.citedMetricIds],
        d.rationale,
        JSON.stringify(d.stateSnapshot),
        JSON.stringify(d.modelVersions),
      ],
    );
  }

  /** Decisions recorded in the window, newest first. */
  async getHistory(
    poolId: string,
    range: { readonly from: Date; readonly to: Date },
  ): Promise<readonly DecisionRecord[]> {
    const res = await this.runner.query(
      `SELECT decision_id, decided_at, pool_id, action, size_usd, confidence,
              cited_forecast_ids, cited_metric_ids, rationale,
              state_snapshot, model_versions
       FROM ts_decisions
       WHERE pool_id = $1 AND decided_at >= $2 AND decided_at <= $3
       ORDER BY decided_at DESC`,
      [poolId, range.from, range.to],
    );

    const out: DecisionRecord[] = [];
    for (const row of res.rows) {
      const decisionId = asString(row['decision_id']);
      const decidedAt = asDate(row['decided_at']);
      const action = DecisionActionSchema.safeParse(row['action']);
      const rationale = asString(row['rationale']);
      if (decisionId === null || decidedAt === null || !action.success || rationale === null) {
        continue;
      }
      out.push({
        decisionId,
        decidedAt,
        poolId: asString(row['pool_id']) ?? poolId,
        action: action.data,
        sizeUsd: asNumber(row['size_usd']) ?? 0,
        confidence: asNumber(row['confidence']) ?? 0,
        citedForecastIds: [...asStringArray(row['cited_forecast_ids'])],
        citedMetricIds: [...asStringArray(row['cited_metric_ids'])],
        rationale,
        stateSnapshot: asJsonObject(row['state_snapshot']),
        modelVersions: asJsonObject(row['model_versions']),
      });
    }
    return out;
  }
}
