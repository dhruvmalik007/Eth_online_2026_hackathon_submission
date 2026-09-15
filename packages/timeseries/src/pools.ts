import { asDate, asNumber } from './wire.js';
import type { SqlRunner } from './runner.js';

/**
 * The pool universe.
 *
 * Every pool-scoped route takes a `poolId` the caller already has, and nothing exposed the set of
 * ids that actually hold data — which is why the console could only work for someone who already
 * knew an address, and why `/api/agent` fell back to the literal `"0xpool"`. This repository backs
 * the one route that answers "what is indexed?".
 *
 * The set lives in `pool_metrics_hourly`, the table every other pool-keyed ledger (`ts_forecasts`,
 * `ts_decisions`, `ts_embeddings`, `backtest_runs`) is populated from, so it is the honest answer to
 * "what can this deployment forecast?" rather than a registry someone has to maintain.
 */

export interface PoolSummary {
  readonly poolId: string;
  readonly protocol: string;
  readonly network: string;
  /** Rows held for this pool — a proxy for how much history a forecast can draw on. */
  readonly observations: number;
  readonly firstSeen: Date | null;
  readonly lastSeen: Date | null;
}

export interface PoolFilters {
  /** Cap on rows returned. The store is ordered by recency, so a cap keeps the live end. */
  readonly limit?: number;
  readonly network?: string;
  readonly protocol?: string;
}

export const DEFAULT_POOL_LIMIT = 200;
export const MAX_POOL_LIMIT = 1000;

/** Networks and protocols that actually appear, so a picker can offer real values. */
export interface PoolFacets {
  readonly networks: string[];
  readonly protocols: string[];
}

export class PoolCatalogRepository {
  constructor(private readonly runner: SqlRunner) {}

  async list(filters: PoolFilters = {}): Promise<PoolSummary[]> {
    const limit = Math.min(Math.max(filters.limit ?? DEFAULT_POOL_LIMIT, 1), MAX_POOL_LIMIT);
    // `protocol` and `network` describe the pool, not the row, so they are folded with aggregate
    // functions rather than added to the GROUP BY. Grouping by them would split a single pool into
    // several entries the moment one ingest run disagreed about its label, which is exactly the kind
    // of duplicate a picker must not show.
    const res = await this.runner.query(
      `SELECT pool_id,
              max(protocol)  AS protocol,
              max(network)   AS network,
              count(*)::int  AS observations,
              min(ts)        AS first_seen,
              max(ts)        AS last_seen
         FROM pool_metrics_hourly
        WHERE ($1::text IS NULL OR network  = $1)
          AND ($2::text IS NULL OR protocol = $2)
        GROUP BY pool_id
        ORDER BY max(ts) DESC
        LIMIT $3`,
      [filters.network ?? null, filters.protocol ?? null, limit],
    );

    const pools: PoolSummary[] = [];
    for (const row of res.rows) {
      const poolId = row['pool_id'];
      if (typeof poolId !== 'string' || poolId.length === 0) continue;
      pools.push({
        poolId,
        protocol: typeof row['protocol'] === 'string' ? row['protocol'] : 'unknown',
        network: typeof row['network'] === 'string' ? row['network'] : 'unknown',
        observations: asNumber(row['observations']) ?? 0,
        firstSeen: asDate(row['first_seen']),
        lastSeen: asDate(row['last_seen']),
      });
    }
    return pools;
  }

  async facets(): Promise<PoolFacets> {
    // The two lists come back together because they are read together, and each is ordered in SQL
    // so the route never has to hold an arbitrary insertion order.
    const res = await this.runner.query(
      `SELECT 'network' AS kind, network AS value FROM pool_metrics_hourly GROUP BY network
        UNION
       SELECT 'protocol', protocol FROM pool_metrics_hourly GROUP BY protocol`,
    );
    const networks: string[] = [];
    const protocols: string[] = [];
    for (const row of res.rows) {
      const value = row['value'];
      if (typeof value !== 'string' || value.length === 0) continue;
      if (row['kind'] === 'network') networks.push(value);
      else if (row['kind'] === 'protocol') protocols.push(value);
    }
    return { networks: networks.sort(), protocols: protocols.sort() };
  }
}
