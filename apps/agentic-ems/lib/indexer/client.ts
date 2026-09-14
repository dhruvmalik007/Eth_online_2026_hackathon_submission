/**
 * Client for the deployed indexer (`apps/indexer`, Vercel Functions).
 *
 * The desk's forecast widget reads a snapshot from its own route; this is the path to the live
 * service, whose forecasts come from TimesFM-3 over the TimescaleDB window rather than a file.
 *
 * The base URL is read through a **literal** `process.env.NEXT_PUBLIC_*` member access. That is
 * load-bearing: Next.js inlines a statically-referenced public variable into the client bundle, but
 * a dynamic `env[name]` lookup on `process.env` is invisible to that analysis and reaches the
 * browser as `undefined`. `executionBaseUrl` had exactly that bug, and it made a correctly
 * configured deployment look unconfigured.
 *
 * Following the same rule as the execution client: absent configuration is a state to report, not
 * an error to throw at import time.
 */

export function indexerBaseUrl(
  // The literal member access is load-bearing... see the note above. The parameter exists so tests
  // can inject their own env without changing what the bundler can see.
  env: Record<string, string | undefined> = {
    NEXT_PUBLIC_INDEXER_URL: process.env.NEXT_PUBLIC_INDEXER_URL,
  },
): string | undefined {
  const url = env["NEXT_PUBLIC_INDEXER_URL"];
  const trimmed = url?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed.replace(/\/+$/, "") : undefined;
}

export interface IndexerHealth {
  readonly service: string;
  readonly status: "ok" | "degraded";
  readonly degraded: readonly string[];
  readonly database: { readonly reachable: boolean; readonly viaDsn?: boolean };
}

export interface PoolMetricPoint {
  readonly bucketStart: string;
  readonly values: Readonly<Record<string, number>>;
}

/** A failure that names the service and the status, so a caller can distinguish refuse from unreachable. */
export class IndexerRequestError extends Error {
  constructor(
    readonly path: string,
    readonly status: number | null,
    detail: string,
  ) {
    super(status === null ? `indexer unreachable for ${path}: ${detail}` : `indexer returned ${status} for ${path}: ${detail}`);
    this.name = "IndexerRequestError";
  }
}

interface RequestOptions {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

async function getJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const base = indexerBaseUrl();
  if (base === undefined) {
    throw new IndexerRequestError(path, null, "NEXT_PUBLIC_INDEXER_URL is not set");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${base}${path}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    // A network failure and an HTTP error are different operational facts; both are named.
    throw new IndexerRequestError(path, null, error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new IndexerRequestError(path, response.status, detail.slice(0, 200));
  }
  return (await response.json()) as T;
}

/** Is each dependency of the indexer actually usable right now? */
export function fetchIndexerHealth(options: RequestOptions = {}): Promise<IndexerHealth> {
  return getJson<IndexerHealth>("/api/health", options);
}

/**
 * A TimesFM-3 forecast for one pool, from the stored window.
 *
 * `inputPoints` is carried through because it is the number that decides whether the forecast
 * should be trusted at all — the model produces output on a short window, so only the count
 * separates a real result from a decorative one.
 */
export interface StoredForecast {
  readonly poolId: string;
  readonly inputPoints: number;
  readonly horizon: number;
  readonly model: string;
  readonly steps: readonly { readonly index: number; readonly q10: number; readonly q50: number; readonly q90: number }[];
}

export function fetchIndexerForecast(
  poolId: string,
  options: RequestOptions & { readonly horizon?: number } = {},
): Promise<StoredForecast> {
  const horizon = options.horizon === undefined ? "" : `&horizon=${options.horizon}`;
  return getJson<StoredForecast>(
    `/api/forecast?poolId=${encodeURIComponent(poolId)}${horizon}`,
    options,
  );
}

/** Time-bucketed pool metrics straight from the time-series store. */
export function fetchPoolMetrics(
  poolId: string,
  options: RequestOptions & { readonly metric?: string; readonly days?: number } = {},
): Promise<{ readonly count: number; readonly points: readonly PoolMetricPoint[] }> {
  const metric = options.metric ?? "apy";
  const days = options.days ?? 30;
  return getJson(
    `/api/metrics?poolId=${encodeURIComponent(poolId)}&metric=${encodeURIComponent(metric)}&days=${days}`,
    options,
  );
}
