/**
 * Backfill `pool_metrics_hourly` from DefiLlama.
 *
 * TimesFM-3 forecasts a *window*, so it is only as good as what the window
 * contains: `timesfm3_forecast` requires at least eight observations per pool,
 * and with the table empty it cannot produce anything at all. This is the step
 * that gives it a history.
 *
 * Two properties matter more than throughput:
 *
 * **Idempotent.** `pool_metrics_hourly` is keyed `(pool_id, ts)`, so re-running
 * cannot duplicate a point — which is what makes this safe to run before every
 * demo rather than a migration that must be tracked.
 *
 * **Nulls stay null.** DefiLlama omits `apy` for pools it cannot price, and the
 * temptation is to write 0. A zero APY is a *claim about the pool*; a null is an
 * absence. FM3 would forecast the first and skip the second, so coercing here
 * would silently manufacture a flat-yield history.
 */
import { z } from "zod";
import type { TimeseriesClient } from "@ethonline2026/timeseries";
import type { PoolMetricRow } from "@ethonline2026/timeseries";

export const YIELDS_CHART_BASE_URL = "https://yields.llama.fi/chart";

/**
 * The chart endpoint's row.
 *
 * `timestamp` is typed loosely on purpose: the endpoint has served both an ISO
 * string and epoch seconds, and a strict schema would make the backfill fail on
 * whichever one it is not expecting. `apy` and `tvlUsd` are nullable because the
 * endpoint genuinely omits them.
 */
const ChartPointSchema = z.object({
  timestamp: z.union([z.string(), z.number()]),
  apy: z.number().nullable().optional(),
  tvlUsd: z.number().nullable().optional(),
});

const ChartResponseSchema = z.object({
  status: z.string().optional(),
  data: z.array(ChartPointSchema).default([]),
});

export interface BackfillablePool {
  readonly poolId: string;
  readonly protocol: string;
  readonly network: string;
}

export interface BackfillSkip {
  readonly poolId: string;
  readonly reason: string;
}

export interface BackfillResult {
  readonly pools: number;
  /** Rows the writer reported as touched, summed across pools. */
  readonly written: number;
  readonly skipped: readonly BackfillSkip[];
  readonly coverage: {
    readonly pools: number;
    readonly rows: number;
    readonly earliest: string | null;
    readonly latest: string | null;
  };
}

export interface BackfillOptions {
  readonly pools: readonly BackfillablePool[];
  readonly client: TimeseriesClient;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  /** Points older than this are dropped; FM3 does not benefit from a long tail. */
  readonly sinceDays?: number;
}

/**
 * One pool's history, normalised.
 *
 * Exported separately from the writer so the parsing — which is where the
 * timestamp ambiguity lives — is testable without a database.
 */
export function toPoolMetricRows(
  pool: BackfillablePool,
  body: unknown,
  since: Date,
): PoolMetricRow[] {
  const parsed = ChartResponseSchema.parse(body);
  const rows: PoolMetricRow[] = [];

  for (const point of parsed.data) {
    const ts = parseTimestamp(point.timestamp);
    if (ts === undefined || ts < since) continue;
    rows.push({
      poolId: pool.poolId,
      ts,
      protocol: pool.protocol,
      network: pool.network,
      // Carried through as-is, including `null` — see the module note.
      apy: point.apy ?? null,
      tvlUsd: point.tvlUsd ?? null,
    });
  }

  return rows.sort((a, b) => a.ts.getTime() - b.ts.getTime());
}

/** ISO string or epoch seconds — the endpoint has served both. */
function parseTimestamp(value: string | number): Date | undefined {
  if (typeof value === "number") {
    // Epoch seconds; milliseconds would be ~1000× the current figure.
    const ms = value > 1e11 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date;
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? parseTimestamp(asNumber) : undefined;
}

export async function backfillPoolMetrics(options: BackfillOptions): Promise<BackfillResult> {
  const {
    pools,
    client,
    baseUrl = YIELDS_CHART_BASE_URL,
    fetchImpl = fetch,
    now = () => new Date(),
    sinceDays = 120,
  } = options;

  const since = new Date(now().getTime() - sinceDays * 24 * 60 * 60 * 1000);
  const skipped: BackfillSkip[] = [];
  let written = 0;

  for (const pool of pools) {
    try {
      const response = await fetchImpl(`${baseUrl}/${encodeURIComponent(pool.poolId)}`);
      if (!response.ok) {
        skipped.push({ poolId: pool.poolId, reason: `chart returned HTTP ${response.status}` });
        continue;
      }
      const rows = toPoolMetricRows(pool, await response.json(), since);
      if (rows.length === 0) {
        skipped.push({ poolId: pool.poolId, reason: "no points within the window" });
        continue;
      }
      written += await client.upsertPoolMetrics(rows);
    } catch (error) {
      // One unreachable pool must not abort the rest: a partially backfilled table still lets the
      // forecast run for the pools that did resolve.
      skipped.push({
        poolId: pool.poolId,
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  const coverage = await client.getCoverage();
  return {
    pools: pools.length,
    written,
    skipped,
    // ISO strings rather than `Date`s: this ends up in evidence and in a log line, and a `Date` that
    // serialises differently depending on the sink is not a record of anything.
    coverage: {
      pools: coverage.poolCount,
      rows: coverage.rowCount,
      earliest: coverage.earliest?.toISOString() ?? null,
      latest: coverage.latest?.toISOString() ?? null,
    },
  };
}
