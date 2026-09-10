import { Pool, type PoolConfig } from 'pg';

/**
 * Transport port (DIP): the client depends on this abstraction, never on pg
 * directly. `query` returns raw pg rows (snake_case columns) — the validation
 * frontier, mirroring the SubgraphTransport pattern.
 */
export interface SqlRunner {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export class TimeseriesRunnerError extends Error {
  constructor(message: string, readonly causeError: unknown) {
    super(message);
    this.name = 'TimeseriesRunnerError';
  }
}

/** pg.Pool adapter — the composition root wires this in once. */
export class PgSqlRunner implements SqlRunner {
  private readonly pool: Pool;

  constructor(config: PoolConfig | string) {
    this.pool = new Pool(typeof config === 'string' ? { connectionString: config } : config);
  }

  async query(text: string, values: readonly unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    try {
      const result = await this.pool.query(text, values as unknown[]);
      return { rows: result.rows as Record<string, unknown>[] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new TimeseriesRunnerError(`TimescaleDB query failed: ${message}`, err);
    }
  }
}

export const TIMESERIES_DEFAULT_ENV_KEYS = {
  host: 'TIMESERIES_DB_HOST',
  port: 'TIMESERIES_DB_PORT',
  database: 'TIMESERIES_DB_NAME',
  user: 'TIMESERIES_DB_USER',
  password: 'TIMESERIES_DB_PASSWORD',
} as const;
