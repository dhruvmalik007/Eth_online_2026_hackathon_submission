import { readFileSync } from 'node:fs';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { z } from 'zod';

/**
 * Transport port (DIP): the client and every repository depend on this
 * abstraction, never on pg directly. `query` returns raw pg rows
 * (snake_case columns) — the validation frontier, mirroring the
 * SubgraphTransport pattern in `@ethonline2026/graph-fno-indexer`.
 */
export interface SqlRunner {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  /**
   * Run `fn` against one dedicated connection inside a transaction.
   *
   * Required for `SET LOCAL`: such a setting is scoped to a transaction on a
   * single connection, so issuing it through the pooled `query` above would
   * apply it to an arbitrary (possibly different) connection. The vector
   * layer uses this to raise ANN recall for the duration of one search.
   */
  transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T>;
}

export class TimeseriesRunnerError extends Error {
  constructor(message: string, readonly causeError: unknown) {
    super(message);
    this.name = 'TimeseriesRunnerError';
  }
}

/** Env keys the connection resolver reads. */
export const TIMESERIES_DEFAULT_ENV_KEYS = {
  url: 'TIMESERIES_DATABASE_URL',
  host: 'TIMESERIES_DB_HOST',
  port: 'TIMESERIES_DB_PORT',
  database: 'TIMESERIES_DB_NAME',
  user: 'TIMESERIES_DB_USER',
  password: 'TIMESERIES_DB_PASSWORD',
  maxConnections: 'TIMESERIES_DB_MAX_CONNECTIONS',
} as const;

/**
 * Connection environment. `TIMESERIES_DATABASE_URL` (Tiger Cloud / any
 * Postgres DSN) takes precedence; the discrete keys remain as a fallback so
 * local development does not require a DSN.
 */
export const TimeseriesEnvSchema = z.object({
  TIMESERIES_DATABASE_URL: z.string().min(1).optional(),
  TIMESERIES_DB_HOST: z.string().min(1).default('localhost'),
  TIMESERIES_DB_PORT: z.coerce.number().int().positive().max(65_535).default(5432),
  TIMESERIES_DB_NAME: z.string().min(1).default('agentic_ems'),
  TIMESERIES_DB_USER: z.string().min(1).default('postgres'),
  TIMESERIES_DB_PASSWORD: z.string().default(''),
  /** Tiger Cloud free tier is connection-capped; keep this small. */
  TIMESERIES_DB_MAX_CONNECTIONS: z.coerce.number().int().positive().max(20).default(5),
});

export type TimeseriesEnv = z.infer<typeof TimeseriesEnvSchema>;

/**
 * Validate and coerce the connection environment. The source is typed loosely
 * because a process env only ever holds strings while tests inject literals —
 * the schema's `coerce` calls normalize both.
 */
export function loadTimeseriesEnv(
  source: Readonly<Record<string, unknown>> = process.env,
): TimeseriesEnv {
  const parsed = TimeseriesEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid TimescaleDB environment: ${issues}`);
  }
  return parsed.data;
}

/** `pg` SSL option: off, or on with an explicit certificate policy. */
export type SslSetting =
  | false
  | { readonly rejectUnauthorized: boolean; readonly ca?: string };

/**
 * libpq SSL parameters. These are stripped from the DSN before it reaches
 * `pg`, because `ConnectionParameters` merges the parsed DSN *over* the
 * explicit config (`Object.assign({}, config, parse(connectionString))`) —
 * so a leftover `sslmode` silently overrides the policy resolved here.
 */
const SSL_DSN_PARAMS = [
  'sslmode',
  'ssl',
  'sslrootcert',
  'sslcert',
  'sslkey',
  'sslnegotiation',
  'uselibpqcompat',
] as const;

/** Drop libpq SSL parameters so our resolved `ssl` option is authoritative. */
export function stripSslParams(connectionString: string): string {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    return connectionString;
  }
  let changed = false;
  for (const param of SSL_DSN_PARAMS) {
    if (parsed.searchParams.has(param)) {
      parsed.searchParams.delete(param);
      changed = true;
    }
  }
  return changed ? parsed.toString() : connectionString;
}

export interface PgConnectionSpec {
  readonly connectionString: string;
  readonly ssl: SslSetting;
  readonly maxConnections: number;
  readonly applicationName: string;
  /** True when SSL was enabled automatically because the host is remote. */
  readonly sslAutoEnabled: boolean;
  /** True when the DSN form was used (vs. discrete keys). */
  readonly fromConnectionString: boolean;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/** Local hosts (and *.local) are the only ones we dial without TLS. */
export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return LOCAL_HOSTS.has(h) || h.endsWith('.local');
}

/**
 * TLS policy resolution (libpq semantics).
 *
 * Tiger Cloud terminates TLS with its own CA, so Node's bundled trust store
 * rejects the chain; `require`/`prefer` therefore encrypt without verifying,
 * exactly as libpq does. Supplying `sslrootcert` (a PEM path) upgrades the
 * connection to real verification, and `verify-full` demands it.
 */
export function resolveSsl(
  host: string,
  sslMode: string | null,
  caPem?: string,
): { readonly setting: SslSetting; readonly auto: boolean } {
  const mode = sslMode?.toLowerCase();
  const verified = (): SslSetting =>
    caPem === undefined
      ? { rejectUnauthorized: true }
      : { rejectUnauthorized: true, ca: caPem };

  switch (mode) {
    case 'disable':
      return { setting: false, auto: false };
    case 'verify-full':
      return { setting: verified(), auto: false };
    case 'verify-ca':
      // `verify-ca` cannot be expressed without a CA; without one we fall back
      // to the documented `no-verify` behaviour rather than failing open.
      return { setting: caPem === undefined ? { rejectUnauthorized: false } : verified(), auto: false };
    case 'allow':
    case 'prefer':
    case 'require':
    case 'no-verify':
      // libpq `require`: encrypt, do not verify.
      return {
        setting: caPem === undefined ? { rejectUnauthorized: false } : verified(),
        auto: false,
      };
    default:
      break;
  }
  if (isLocalHost(host)) return { setting: false, auto: false };
  return {
    setting: caPem === undefined ? { rejectUnauthorized: false } : verified(),
    auto: true,
  };
}

function parseConnectionUrl(url: string): URL {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.length === 0) throw new Error('missing host');
    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new TimeseriesRunnerError(
      `TIMESERIES_DATABASE_URL is not a valid Postgres DSN (${message})`,
      err,
    );
  }
}

/**
 * Env → connection-spec resolution. Reads the CA file when `sslrootcert` is
 * present in the DSN; everything else is pure so the DSN/SSL decisions are
 * unit-testable offline.
 */
export function resolveConnectionSpec(
  env: TimeseriesEnv,
  applicationName = 'agentic-ems',
): PgConnectionSpec {
  const maxConnections = env.TIMESERIES_DB_MAX_CONNECTIONS;
  const url = env.TIMESERIES_DATABASE_URL;

  if (url !== undefined) {
    const parsed = parseConnectionUrl(url);
    const caPem = readCaPem(parsed.searchParams.get('sslrootcert'));
    const { setting, auto } = resolveSsl(
      parsed.hostname,
      parsed.searchParams.get('sslmode'),
      caPem,
    );
    return {
      connectionString: stripSslParams(url),
      ssl: setting,
      maxConnections,
      applicationName,
      sslAutoEnabled: auto,
      fromConnectionString: true,
    };
  }

  const credentials =
    env.TIMESERIES_DB_PASSWORD.length > 0
      ? `${encodeURIComponent(env.TIMESERIES_DB_USER)}:${encodeURIComponent(env.TIMESERIES_DB_PASSWORD)}`
      : encodeURIComponent(env.TIMESERIES_DB_USER);
  const connectionString =
    `postgres://${credentials}@${env.TIMESERIES_DB_HOST}:${env.TIMESERIES_DB_PORT}` +
    `/${encodeURIComponent(env.TIMESERIES_DB_NAME)}`;
  const { setting, auto } = resolveSsl(env.TIMESERIES_DB_HOST, null);
  return {
    connectionString,
    ssl: setting,
    maxConnections,
    applicationName,
    sslAutoEnabled: auto,
    fromConnectionString: false,
  };
}

/** Load a PEM CA bundle referenced by `sslrootcert` (Tiger Cloud downloadable). */
function readCaPem(path: string | null): string | undefined {
  if (path === null || path.length === 0) return undefined;
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new TimeseriesRunnerError(
      `sslrootcert="${path}" could not be read (${message})`,
      err,
    );
  }
}

export function toPoolConfig(spec: PgConnectionSpec): PoolConfig {
  return {
    connectionString: spec.connectionString,
    ssl:
      spec.ssl === false
        ? false
        : spec.ssl.ca === undefined
          ? { rejectUnauthorized: spec.ssl.rejectUnauthorized }
          : { rejectUnauthorized: spec.ssl.rejectUnauthorized, ca: spec.ssl.ca },
    max: spec.maxConnections,
    application_name: spec.applicationName,
    // Serverless instances idle-freeze; keep sockets short-lived so a
    // throttled Tiger tier does not accumulate dead connections.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };
}

function poolKey(spec: PgConnectionSpec): string {
  const sslFlag = spec.ssl === false ? 'off' : `on:${String(spec.ssl.rejectUnauthorized)}`;
  return `${spec.connectionString}|max=${spec.maxConnections}|ssl=${sslFlag}`;
}

interface GlobalPoolRegistry {
  __agenticEmsPgPools?: Map<string, Pool>;
}

const globalScope = globalThis as unknown as GlobalPoolRegistry;

/**
 * Module-level pools die with serverless instances but are re-created on every
 * warm invocation; hanging them off globalThis means one pool per process,
 * which is what keeps connection counts inside the Tiger free-tier cap.
 */
function poolRegistry(): Map<string, Pool> {
  globalScope.__agenticEmsPgPools ??= new Map<string, Pool>();
  return globalScope.__agenticEmsPgPools;
}

function getSharedPool(spec: PgConnectionSpec): Pool {
  const registry = poolRegistry();
  const key = poolKey(spec);
  const existing = registry.get(key);
  if (existing !== undefined) return existing;
  const pool = new Pool(toPoolConfig(spec));
  pool.on('error', () => {
    // Idle-client errors must not crash the process; the next query surfaces
    // the failure through TimeseriesRunnerError instead.
  });
  registry.set(key, pool);
  return pool;
}

/** Drain every cached pool — used by scripts and tests so the process exits. */
export async function closeAllPools(): Promise<void> {
  const registry = poolRegistry();
  const pools = [...registry.values()];
  registry.clear();
  await Promise.all(pools.map((p) => p.end().catch(() => undefined)));
}

/** pg.Pool adapter — the composition root wires this in once. */
export class PgSqlRunner implements SqlRunner {
  private readonly spec: PgConnectionSpec;
  private readonly pool: Pool;

  constructor(spec: PgConnectionSpec) {
    this.spec = spec;
    this.pool = getSharedPool(spec);
  }

  /** Composition-root helper: validate env, resolve the DSN, return a runner. */
  static fromEnv(env: TimeseriesEnv = loadTimeseriesEnv()): PgSqlRunner {
    return new PgSqlRunner(resolveConnectionSpec(env));
  }

  /** The resolved connection (SSL + DSN decisions) for diagnostics/health. */
  get connection(): PgConnectionSpec {
    return this.spec;
  }

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    try {
      const result = await this.pool.query(text, values as unknown[]);
      return { rows: result.rows as Record<string, unknown>[] };
    } catch (err) {
      throw new TimeseriesRunnerError(`TimescaleDB query failed: ${describeDriverError(err)}`, err);
    }
  }

  /** Release this runner's shared pool (scripts/tests). */
  async close(): Promise<void> {
    const registry = poolRegistry();
    const key = poolKey(this.spec);
    const pool = registry.get(key);
    if (pool === undefined) return;
    registry.delete(key);
    await pool.end();
  }

  async transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> {
    const client = await this.connectOrThrow();
    try {
      await client.query('BEGIN');
      const scoped: SqlRunner = {
        query: async (text, values = []) => {
          const result = await client.query(text, values as unknown[]);
          return { rows: result.rows as Record<string, unknown>[] };
        },
        // Nested transactions would need savepoints to stay correct. The
        // vector layer never nests, so fail loudly rather than silently
        // running the inner block outside a transaction.
        transaction: () => Promise.reject(
          new TimeseriesRunnerError('nested transactions are not supported', null),
        ),
      };
      const out = await fn(scoped);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Acquire a pooled client, naming the failure when the host is unreachable.
   *
   * Separated from `transaction` so the acquisition failure is distinguishable
   * from a failure *inside* the transaction: the first is a connectivity problem,
   * the second is the caller's own work failing, and conflating them sends an
   * operator looking in the wrong place.
   *
   * @returns A client checked out from the shared pool.
   * @throws {TimeseriesRunnerError} When no connection could be established.
   */
  private async connectOrThrow(): Promise<PoolClient> {
    try {
      return await this.pool.connect();
    } catch (err) {
      throw new TimeseriesRunnerError(
        `TimescaleDB connection failed: ${describeDriverError(err)}`,
        err,
      );
    }
  }
}

/**
 * Render a driver error so the message is never empty.
 *
 * Node reports a failed multi-address connection as an `AggregateError` whose
 * `message` is the empty string, so the obvious `err.message` produces
 * "TimescaleDB query failed: " — a message carrying no information at all, which
 * is exactly what a wrong host or a refused connection looks like. This walks the
 * aggregate's inner errors and falls back to the error's `code`, so the failure
 * names itself instead of sending someone to inspect a query that was never run.
 *
 * @param err - The error thrown by the driver.
 * @returns A non-empty description.
 */
function describeDriverError(err: unknown): string {
  if (err instanceof AggregateError) {
    const inner = err.errors.map(describeDriverError).filter((message) => message.length > 0);
    if (inner.length > 0) return inner.join('; ');
    return errorCode(err) ?? 'AggregateError with no detail';
  }
  if (err instanceof Error) {
    if (err.message.length > 0) return err.message;
    return errorCode(err) ?? err.name;
  }
  const rendered = String(err);
  return rendered.length > 0 ? rendered : 'unknown error';
}

/**
 * Read the driver's `code` without a cast.
 *
 * A pg connection failure carries `ECONNREFUSED`/`ENOTFOUND` on a `code`
 * property that `Error` does not declare, so the property is read through a
 * narrowing check rather than asserted.
 *
 * @param err - The error to inspect.
 * @returns The code when it is a non-empty string.
 */
function errorCode(err: object): string | null {
  const code: unknown = Reflect.get(err, 'code');
  return typeof code === 'string' && code.length > 0 ? code : null;
}
