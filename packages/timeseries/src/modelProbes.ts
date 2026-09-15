import { asDate, asNumber } from './wire.js';
import type { SqlRunner } from './runner.js';

/**
 * The model-availability record.
 *
 * Nothing persisted a probe before this: `/api/health` answered a request and the answer was
 * discarded, and no table carried a success/failure column, so a model outage left no trace at all.
 * An uptime figure therefore has to be built from rows this repository writes going forward, which
 * is why the window it reports is bounded by `recordedSince` rather than by the requested period —
 * a chart that silently starts at zero reads as an outage that never happened.
 */

/** Whether a probe was taken on a schedule or because someone was looking. */
export type ProbeSource = 'cron' | 'on-demand' | 'health';

export interface ProbeRecord {
  readonly service: string;
  readonly reachable: boolean;
  /** Absent for a dependency with no meaningful latency (a missing bucket, an unset key). */
  readonly latencyMs?: number | null;
  readonly status?: number | null;
  readonly detail?: string | null;
  readonly source?: ProbeSource;
  readonly probedAt?: Date;
}

export interface ProbeSummary {
  readonly service: string;
  readonly samples: number;
  readonly reachableSamples: number;
  /** Null rather than 100 when there are no samples — an unobserved service is not a healthy one. */
  readonly uptimePct: number | null;
  readonly p50LatencyMs: number | null;
  readonly p95LatencyMs: number | null;
  readonly lastProbedAt: Date | null;
  readonly lastReachable: boolean | null;
}

export interface ProbeWindow {
  readonly sinceHours: number;
  /** The earliest probe on record at all — the honest left edge of any figure below. */
  readonly recordedSince: Date | null;
  readonly summaries: ProbeSummary[];
}

export const DEFAULT_WINDOW_HOURS = 24;
export const MAX_WINDOW_HOURS = 24 * 90;

export class ModelProbeRepository {
  constructor(private readonly runner: SqlRunner) {}

  /**
   * Append one row per probe.
   *
   * A single multi-row INSERT, because the probes are taken together and a partially written window
   * would understate one service's uptime relative to the others'.
   */
  async record(records: readonly ProbeRecord[]): Promise<number> {
    if (records.length === 0) return 0;

    const values: unknown[] = [];
    const tuples: string[] = [];
    for (const record of records) {
      const base = values.length;
      tuples.push(
        `($${base + 1}::timestamptz, $${base + 2}::text, $${base + 3}::boolean, ` +
          `$${base + 4}::numeric, $${base + 5}::int, $${base + 6}::text, $${base + 7}::text)`,
      );
      values.push(
        record.probedAt ?? new Date(),
        record.service,
        record.reachable,
        record.latencyMs ?? null,
        record.status ?? null,
        record.detail ?? null,
        record.source ?? 'cron',
      );
    }

    const res = await this.runner.query(
      `INSERT INTO model_probes
         (probed_at, service, reachable, latency_ms, status, detail, source)
       VALUES ${tuples.join(', ')}
       RETURNING (probed_at IS NOT NULL)::int AS inserted`,
      values,
    );
    return res.rows.length;
  }

  /** The earliest probe ever recorded, or null when nothing has been recorded yet. */
  async recordedSince(): Promise<Date | null> {
    const res = await this.runner.query('SELECT min(probed_at) AS first FROM model_probes');
    return asDate(res.rows[0]?.['first']);
  }

  /**
   * Per-service rollups over the trailing window.
   *
   * `percentile_cont` ignores NULL latencies, so a service probed without one (an unset key, a
   * missing bucket) contributes to the sample count and the uptime figure without inventing a
   * latency for itself.
   */
  async window(sinceHours: number = DEFAULT_WINDOW_HOURS): Promise<ProbeWindow> {
    const hours = Math.min(Math.max(Math.trunc(sinceHours), 1), MAX_WINDOW_HOURS);

    const [rollups, latest, since] = await Promise.all([
      this.runner.query(
        `SELECT service,
                count(*)::int                                    AS samples,
                count(*) FILTER (WHERE reachable)::int           AS reachable_samples,
                percentile_cont(0.5)  WITHIN GROUP (ORDER BY latency_ms) AS p50,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
                max(probed_at)                                   AS last_probed_at
           FROM model_probes
          WHERE probed_at >= now() - ($1::int * interval '1 hour')
          GROUP BY service
          ORDER BY service`,
        [hours],
      ),
      this.runner.query(
        `SELECT DISTINCT ON (service) service, reachable
           FROM model_probes
          ORDER BY service, probed_at DESC`,
      ),
      this.recordedSince(),
    ]);

    const lastReachable = new Map<string, boolean>();
    for (const row of latest.rows) {
      const service = row['service'];
      if (typeof service === 'string' && typeof row['reachable'] === 'boolean') {
        lastReachable.set(service, row['reachable']);
      }
    }

    const summaries: ProbeSummary[] = [];
    for (const row of rollups.rows) {
      const service = row['service'];
      if (typeof service !== 'string') continue;
      const samples = asNumber(row['samples']) ?? 0;
      const reachableSamples = asNumber(row['reachable_samples']) ?? 0;
      summaries.push({
        service,
        samples,
        reachableSamples,
        uptimePct: samples === 0 ? null : reachableSamples / samples,
        p50LatencyMs: asNumber(row['p50']),
        p95LatencyMs: asNumber(row['p95']),
        lastProbedAt: asDate(row['last_probed_at']),
        lastReachable: lastReachable.get(service) ?? null,
      });
    }

    return { sinceHours: hours, recordedSince: since, summaries };
  }
}
