import {
  ChainRiskHistoryRowSchema,
  IncidentSeveritySchema,
  MarketMakerMetricsRowSchema,
  ProtocolGovernanceHistoryRowSchema,
  SecurityIncidentRowSchema,
  type ChainRiskHistoryRow,
  type MarketMakerMetricsRow,
  type IncidentSeverity,
  type ProtocolGovernanceHistoryRow,
  type SecurityIncidentRow,
} from './types.js';
import type { SqlRunner } from './runner.js';
import { asDate, asNumber, asString } from './wire.js';

/**
 * Temporal history for the risk-data pipeline.
 *
 * This repository owns the SQL for the four risk tables, which is the same
 * division of labour the rest of the package follows: this package is the one
 * that knows its schema, so callers describe *what* to write and never *how*.
 * The risk-data pipeline therefore depends on this type rather than issuing
 * statements of its own.
 *
 * All four writes are append-only and idempotent by primary key
 * (`ON CONFLICT DO NOTHING`), so re-running a sweep is safe: a repeated
 * observation updates nothing, which is what makes the 6-hourly cadence
 * self-healing rather than a source of duplicate rows.
 *
 * ## Why history lives here and not only in the snapshot
 *
 * The pipeline's GCS snapshot answers "what is the risk profile now". A forecast
 * covariate needs "what was it at each step of the target series", which only an
 * append-only table can answer. These four series are what TimesFM-3 conditions
 * on, so a gap here is a gap in the model's inputs rather than merely a missing
 * dashboard value.
 */

/** How many rows a single write affected. */
export interface RiskHistoryWriteResult {
  /** Rows actually inserted. Rows already present are not counted. */
  readonly inserted: number;
}

export class RiskHistoryRepository {
  /**
   * @param runner - The transport port. Never a concrete pg client, so this
   *   repository is exercisable against an in-memory fake.
   */
  constructor(private readonly runner: SqlRunner) {}

  /**
   * Append chain risk observations.
   *
   * @param rows - One row per chain per sweep.
   * @returns The number of rows actually inserted.
   * @throws {import('zod').ZodError} When a row is malformed — validation happens
   *   before the write, so a bad row never reaches the database.
   */
  async recordChainRisk(
    rows: readonly ChainRiskHistoryRow[],
  ): Promise<RiskHistoryWriteResult> {
    const parsed = rows.map((row) => ChainRiskHistoryRowSchema.parse(row));
    if (parsed.length === 0) return { inserted: 0 };

    const values: unknown[] = [];
    const tuples = parsed.map((row, i) => {
      const b = i * 14;
      values.push(
        row.ts,
        row.chainSlug,
        row.stage,
        row.stateValidation,
        row.dataAvailability,
        row.exitWindow,
        row.sequencerFailure,
        row.proposerFailure,
        row.challengePeriodDays,
        row.exitWindowDays,
        row.sequencerDelayHours,
        row.valueSecuredUsd,
        row.compositeScore,
        JSON.stringify(row.raw),
      );
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12}, $${b + 13}, $${b + 14}::jsonb)`;
    });

    const res = await this.runner.query(
      `INSERT INTO chain_risk_history
         (ts, chain_slug, stage, state_validation, data_availability, exit_window,
          sequencer_failure, proposer_failure, challenge_period_days, exit_window_days,
          sequencer_delay_hours, value_secured_usd, composite_score, raw)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (chain_slug, ts) DO NOTHING
       RETURNING chain_slug`,
      values,
    );
    return { inserted: res.rows.length };
  }

  /**
   * Append protocol governance observations.
   *
   * @param rows - One row per protocol per sweep.
   * @returns The number of rows actually inserted.
   */
  async recordGovernance(
    rows: readonly ProtocolGovernanceHistoryRow[],
  ): Promise<RiskHistoryWriteResult> {
    const parsed = rows.map((row) => ProtocolGovernanceHistoryRowSchema.parse(row));
    if (parsed.length === 0) return { inserted: 0 };

    const values: unknown[] = [];
    const tuples = parsed.map((row, i) => {
      const b = i * 11;
      values.push(
        row.observedAt,
        row.protocolSlug,
        row.proposalCount,
        row.openCount,
        row.recentCount,
        row.riskProposalCount,
        row.activityScore,
        row.participationScore,
        row.riskActivityScore,
        row.compositeScore,
        JSON.stringify(row.raw),
      );
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}::jsonb)`;
    });

    const res = await this.runner.query(
      `INSERT INTO protocol_governance_history
         (observed_at, protocol_slug, proposal_count, open_count, recent_count,
          risk_proposal_count, activity_score, participation_score,
          risk_activity_score, composite_score, raw)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (protocol_slug, observed_at) DO NOTHING
       RETURNING protocol_slug`,
      values,
    );
    return { inserted: res.rows.length };
  }

  /**
   * Append market-maker metric observations.
   *
   * @param rows - One row per market maker per sweep.
   * @returns The number of rows actually inserted.
   */
  async recordMarketMakers(
    rows: readonly MarketMakerMetricsRow[],
  ): Promise<RiskHistoryWriteResult> {
    const parsed = rows.map((row) => MarketMakerMetricsRowSchema.parse(row));
    if (parsed.length === 0) return { inserted: 0 };

    const values: unknown[] = [];
    const tuples = parsed.map((row, i) => {
      const b = i * 16;
      values.push(
        row.ts,
        row.marketMaker,
        row.grade,
        row.compositeScore,
        row.rank,
        row.depthUsd,
        row.spreadPct,
        row.volumeUsd,
        row.tradingKpis,
        row.trust,
        row.coverageCapabilities,
        row.uptime,
        row.integrationLevel,
        row.activeEngagements,
        row.fdvUsd,
        JSON.stringify(row.raw),
      );
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12}, $${b + 13}, $${b + 14}, $${b + 15}, $${b + 16}::jsonb)`;
    });

    const res = await this.runner.query(
      `INSERT INTO market_maker_metrics
         (ts, market_maker, grade, composite_score, rank, depth_usd, spread_pct,
          volume_usd, trading_kpis, trust, coverage_capabilities, uptime,
          integration_level, active_engagements, fdv_usd, raw)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (market_maker, ts) DO NOTHING
       RETURNING market_maker`,
      values,
    );
    return { inserted: res.rows.length };
  }

  /**
   * Append security incidents.
   *
   * No collector feeds this yet — the incident source is an open question in the
   * plan — but the write path is complete so adding one needs no schema change.
   *
   * @param rows - One row per incident.
   * @returns The number of rows actually inserted.
   */
  async recordIncidents(
    rows: readonly SecurityIncidentRow[],
  ): Promise<RiskHistoryWriteResult> {
    const parsed = rows.map((row) => SecurityIncidentRowSchema.parse(row));
    if (parsed.length === 0) return { inserted: 0 };

    const values: unknown[] = [];
    const tuples = parsed.map((row, i) => {
      const b = i * 10;
      values.push(
        row.occurredAt,
        row.incidentId,
        row.subject,
        row.subjectKind,
        row.incidentKind,
        row.severity,
        row.amountUsd,
        row.summary,
        row.sourceUrl,
        JSON.stringify(row.raw),
      );
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}::jsonb)`;
    });

    const res = await this.runner.query(
      `INSERT INTO security_incidents
         (occurred_at, incident_id, subject, subject_kind, incident_kind, severity,
          amount_usd, summary, source_url, raw)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (subject, occurred_at) DO NOTHING
       RETURNING subject`,
      values,
    );
    return { inserted: res.rows.length };
  }

  /**
   * Read a chain's composite score series, oldest first.
   *
   * The ordering is deliberate: a covariate must align index-for-index with the
   * target series, so the caller needs chronological order rather than the
   * newest-first order an API would prefer.
   *
   * @param chainSlug - The chain to read.
   * @param range - Inclusive time window.
   * @returns Timestamp and composite score per observation.
   */
  async chainCompositeSeries(
    chainSlug: string,
    range: { readonly from: Date; readonly to: Date },
  ): Promise<readonly { readonly ts: Date; readonly value: number }[]> {
    const res = await this.runner.query(
      `SELECT ts, composite_score
       FROM chain_risk_history
       WHERE chain_slug = $1 AND ts >= $2 AND ts <= $3
       ORDER BY ts ASC`,
      [chainSlug, range.from, range.to],
    );

    const out: { ts: Date; value: number }[] = [];
    for (const row of res.rows) {
      const ts = asDate(row['ts']);
      const value = asNumber(row['composite_score']);
      if (ts !== null && value !== null) out.push({ ts, value });
    }
    return out;
  }

  /**
   * Read a protocol's governance composite series, oldest first.
   *
   * @param protocolSlug - The protocol to read.
   * @param range - Inclusive time window.
   * @returns Timestamp and composite score per observation.
   */
  async governanceCompositeSeries(
    protocolSlug: string,
    range: { readonly from: Date; readonly to: Date },
  ): Promise<readonly { readonly ts: Date; readonly value: number }[]> {
    const res = await this.runner.query(
      `SELECT observed_at, composite_score
       FROM protocol_governance_history
       WHERE protocol_slug = $1 AND observed_at >= $2 AND observed_at <= $3
       ORDER BY observed_at ASC`,
      [protocolSlug, range.from, range.to],
    );

    const out: { ts: Date; value: number }[] = [];
    for (const row of res.rows) {
      const ts = asDate(row['observed_at']);
      const value = asNumber(row['composite_score']);
      if (ts !== null && value !== null) out.push({ ts, value });
    }
    return out;
  }

  /**
   * Read a market maker's median book-depth series, oldest first.
   *
   * @param marketMaker - The market maker to read.
   * @param range - Inclusive time window.
   * @returns Timestamp and depth in USD per observation where depth was reported.
   */
  async marketMakerDepthSeries(
    marketMaker: string,
    range: { readonly from: Date; readonly to: Date },
  ): Promise<readonly { readonly ts: Date; readonly value: number }[]> {
    const res = await this.runner.query(
      `SELECT ts, depth_usd
       FROM market_maker_metrics
       WHERE market_maker = $1 AND ts >= $2 AND ts <= $3 AND depth_usd IS NOT NULL
       ORDER BY ts ASC`,
      [marketMaker, range.from, range.to],
    );

    const out: { ts: Date; value: number }[] = [];
    for (const row of res.rows) {
      const ts = asDate(row['ts']);
      const value = asNumber(row['depth_usd']);
      if (ts !== null && value !== null) out.push({ ts, value });
    }
    return out;
  }

  /**
   * Count incidents observed in a window, for use as a covariate.
   *
   * @param subject - The entity to count incidents for.
   * @param range - Inclusive time window.
   * @returns The incident count.
   */
  async incidentCount(
    subject: string,
    range: { readonly from: Date; readonly to: Date },
  ): Promise<number> {
    const res = await this.runner.query(
      `SELECT count(*)::int AS n
       FROM security_incidents
       WHERE subject = $1 AND occurred_at >= $2 AND occurred_at <= $3`,
      [subject, range.from, range.to],
    );
    return asNumber(res.rows[0]?.['n']) ?? 0;
  }

  /**
   * Read a subject's incidents, oldest first, for covariate construction.
   *
   * Returns one entry per incident rather than a count, because the covariate
   * that matters is *cumulative*: "how many incidents had occurred by this point
   * in the target series". A single total for the whole window cannot be aligned
   * to a per-step grid, so the timestamps are needed and the running total is
   * computed by the caller.
   *
   * Severity is carried alongside the timestamp so a caller can weight an exploit
   * above a paused withdrawal without a second query.
   *
   * @param subject - The entity to read incidents for.
   * @param range - Inclusive time window.
   * @returns The occurrence time and severity of each incident.
   */
  async incidentSeries(
    subject: string,
    range: { readonly from: Date; readonly to: Date },
  ): Promise<readonly { readonly occurredAt: Date; readonly severity: IncidentSeverity }[]> {
    const res = await this.runner.query(
      `SELECT occurred_at, severity
       FROM security_incidents
       WHERE subject = $1 AND occurred_at >= $2 AND occurred_at <= $3
       ORDER BY occurred_at ASC`,
      [subject, range.from, range.to],
    );

    const out: { occurredAt: Date; severity: IncidentSeverity }[] = [];
    for (const row of res.rows) {
      const occurredAt = asDate(row['occurred_at']);
      const severity = row['severity'];
      // The severity column carries a CHECK constraint db-side; this guards
      // against a value the constraint permits being added later without the
      // enum being widened, which would otherwise surface as a bad covariate.
      if (occurredAt !== null && isSeverity(severity)) out.push({ occurredAt, severity });
    }
    return out;
  }

  /**
   * Count rows in each risk history table, for verification and the manifest.
   *
   * @returns A row count per table.
   */
  async counts(): Promise<Record<string, number>> {
    const res = await this.runner.query(
      `SELECT 'chain_risk_history' AS table_name, count(*)::int AS n FROM chain_risk_history
       UNION ALL SELECT 'protocol_governance_history', count(*)::int FROM protocol_governance_history
       UNION ALL SELECT 'market_maker_metrics', count(*)::int FROM market_maker_metrics
       UNION ALL SELECT 'security_incidents', count(*)::int FROM security_incidents`,
    );

    const out: Record<string, number> = {};
    for (const row of res.rows) {
      const table = asString(row['table_name']);
      if (table !== null) out[table] = asNumber(row['n']) ?? 0;
    }
    return out;
  }
}

/**
 * Narrow a database value to a severity.
 *
 * The column is constrained db-side, so this is not the primary defence — it
 * exists because a `text` column's type is `string` at the driver boundary and
 * the alternative would be a cast, which this package does not use.
 *
 * @param value - The raw column value.
 * @returns True when the value is a known severity.
 */
function isSeverity(value: unknown): value is IncidentSeverity {
  return IncidentSeveritySchema.safeParse(value).success;
}
