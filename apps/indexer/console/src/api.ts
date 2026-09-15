/**
 * The indexer API, as the console sees it.
 *
 * Every shape here was read off the running deployment rather than inferred from the handlers: a
 * renderer written against a guessed shape fails in the browser, and this surface is judged on
 * whether it tells the truth about what the API returned.
 */

/** Typed error contract from `_lib/http.ts`. The code is the part a caller can act on. */
export interface ApiError {
  readonly code: string;
  readonly message: string;
}

export interface PoolSummary {
  readonly poolId: string;
  readonly protocol: string;
  readonly network: string;
  readonly observations: number;
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
}

export interface PoolsResponse {
  readonly count: number;
  readonly limit: number;
  readonly pools: readonly PoolSummary[];
  readonly facets: {
    readonly networks: readonly string[];
    readonly protocols: readonly string[];
  };
  readonly latestObservationAt: string | null;
  readonly empty: boolean;
  readonly reading: string;
}

export interface MetricPoint {
  readonly bucketStart: string;
  readonly avg: number | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly samples: number;
}

export interface MetricsResponse {
  readonly poolId: string;
  readonly metric: string;
  readonly interval: string;
  readonly range: { readonly from: string; readonly to: string };
  readonly points: readonly MetricPoint[];
  readonly coverage: {
    readonly poolCount: number;
    readonly rowCount: number;
    readonly earliest: string | null;
    readonly latest: string | null;
  };
  readonly empty: boolean;
}

export interface ForecastStep {
  readonly index: number;
  readonly q10: number;
  readonly q50: number;
  readonly q90: number;
}

export interface ForecastResponse {
  readonly poolId: string;
  readonly metric: string;
  readonly source: string;
  readonly model: string;
  readonly latencyMs: number;
  readonly flags: {
    readonly quantileMonotonic: boolean;
    readonly scaleSuspicious: boolean;
  };
  readonly historyPoints: number;
  readonly steps: readonly ForecastStep[];
  readonly reading: string;
}

export interface RealizedYieldRow {
  readonly bucketStart: string;
  readonly avgApy: number | null;
  readonly minApy: number | null;
  readonly maxApy: number | null;
  readonly avgTvl: number | null;
  readonly samples: number;
}

export interface PerformanceResponse {
  readonly poolId: string;
  readonly range: { readonly from: string; readonly to: string };
  readonly realizedYield: readonly RealizedYieldRow[];
  readonly calibration: readonly unknown[];
  readonly decisionOutcomes: readonly unknown[];
  readonly empty: boolean;
  readonly reading: string;
}

export interface ServiceStatus {
  readonly service: string;
  readonly samples: number;
  readonly reachableSamples: number;
  readonly uptimePct: number | null;
  readonly p50LatencyMs: number | null;
  readonly p95LatencyMs: number | null;
  readonly lastProbedAt: string | null;
  readonly lastReachable: boolean | null;
}

export interface ModelStatusResponse {
  readonly window: {
    readonly requestedHours: number;
    readonly recordedSince: string | null;
    readonly recordedHours: number;
  };
  readonly services: readonly ServiceStatus[];
  readonly empty: boolean;
  readonly reading: string;
}

export interface HealthResponse {
  readonly service: string;
  readonly status: "ok" | "degraded";
  readonly degraded: readonly string[];
  readonly database: {
    readonly reachable: boolean;
    readonly error?: string;
    readonly viaDsn: boolean;
  };
  readonly timescaledb: {
    readonly vectorEnabled: boolean;
    readonly timescaleVersion: string;
  } | null;
  readonly timesfm3: {
    readonly url: string;
    readonly reachable: boolean;
    readonly status?: number;
    readonly error?: string;
  };
  readonly retrieval: "enabled" | "unconfigured";
  readonly risk: {
    readonly store: string;
    readonly bucket: string | null;
    readonly prefix: string;
  };
  readonly models: Record<string, string | null>;
}

export interface CacheEntry {
  readonly key: string;
  readonly path: string;
  readonly url: string;
  readonly fetchedAt: string;
  readonly changedAt: string;
  readonly sha256: string;
  readonly bytes: number | null;
}

export interface CacheManifestResponse {
  readonly configured: boolean;
  readonly cached: boolean;
  readonly version: number;
  readonly generatedAt: string | null;
  readonly expiresAt?: string | null;
  readonly entries: readonly CacheEntry[];
  readonly failures: readonly {
    readonly key: string;
    readonly error: string;
  }[];
  readonly reading: string;
}

export interface SearchHit {
  readonly content?: string;
  readonly literal?: string;
  readonly score?: number;
  readonly poolId?: string;
  readonly tsStart?: string;
  readonly kind?: string;
}

export interface SearchResponse {
  readonly query?: string;
  readonly hits?: readonly SearchHit[];
  readonly results?: readonly SearchHit[];
  readonly count?: number;
  readonly reading?: string;
}

/** A failed call, carrying the API's own typed code rather than a transport guess. */
export class ApiCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiCallError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });

  const text = await res.text();
  let payload: unknown;
  try {
    payload = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new ApiCallError(
      "BAD_RESPONSE",
      `Expected JSON and got ${text.slice(0, 120)}`,
      res.status,
    );
  }

  if (!res.ok) {
    const error = (payload as { error?: ApiError }).error;
    throw new ApiCallError(
      error?.code ?? "UNKNOWN",
      error?.message ?? `Request failed with ${res.status}`,
      res.status,
    );
  }
  return payload as T;
}

export const api = {
  pools: (filter?: { network?: string; protocol?: string }) => {
    const q = new URLSearchParams();
    if (filter?.network) q.set("network", filter.network);
    if (filter?.protocol) q.set("protocol", filter.protocol);
    return request<PoolsResponse>(`/api/pools${q.size > 0 ? `?${q}` : ""}`);
  },
  metrics: (poolId: string, metric: string, days: number) =>
    request<MetricsResponse>(
      `/api/metrics?poolId=${encodeURIComponent(poolId)}&metric=${metric}&days=${days}`,
    ),
  forecast: (poolId: string, horizon: number) =>
    request<ForecastResponse>(
      `/api/forecast?poolId=${encodeURIComponent(poolId)}&horizon=${horizon}`,
    ),
  performance: (poolId: string) =>
    request<PerformanceResponse>(
      `/api/performance?poolId=${encodeURIComponent(poolId)}`,
    ),
  modelStatus: (hours: number) =>
    request<ModelStatusResponse>(`/api/model-status?hours=${hours}`),
  health: () => request<HealthResponse>("/api/health"),
  cache: () => request<CacheManifestResponse>("/api/cache/manifest"),
  search: (query: string) =>
    request<SearchResponse>("/api/search", {
      method: "POST",
      body: JSON.stringify({ query }),
    }),
  agent: (body: {
    query: string;
    poolId?: string;
    mode?: "v01" | "deep";
    horizonDays?: number;
  }) =>
    request<Record<string, unknown>>("/api/agent", {
      method: "POST",
      body: JSON.stringify({ ...body, dry: false }),
    }),
};
