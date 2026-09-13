/**
 * The forecasting port — TimesFM-3 behind a seam.
 *
 * Two things the production path must respect, both learned from the deployed
 * service contract (`packages/langchain/docs/timesfm3-service.md`):
 *
 *   1. The service runs `--workers 1 --limit-concurrency 4`. Fanning out N
 *      parallel forecasts is counter-productive; dispatch is serialised and
 *      cached by `(target, metric, horizon)` — ROADMAP T5.2.
 *   2. Every response passes quantile-monotonicity and scale guardrails inside
 *      `TimesFM3Client` BEFORE it enters agent state. A suspicious forecast must
 *      surface as a failed check, never as a silent number.
 *
 * The client itself is `@ethonline2026/langchain-agent`'s `TimesFM3Client`.
 */
import {
  FetchTimesFM3Http,
  TimesFM3Client,
  type TimesFM3Http,
} from "@ethonline2026/langchain-agent";

export const FORECAST_METRICS = ["tvl", "apy", "volume"] as const;
export type ForecastMetric = (typeof FORECAST_METRICS)[number];

export type ForecastRequest =
  | { readonly kind: "series"; readonly series: readonly number[]; readonly horizon: number }
  | {
      readonly kind: "protocol";
      readonly protocolSlug: string;
      readonly metric: ForecastMetric;
      readonly horizon: number;
    };

export interface ForecastResult {
  readonly point: readonly number[];
  readonly q10: readonly number[];
  readonly q50: readonly number[];
  readonly q90: readonly number[];
  readonly model: string;
  readonly latencyMs: number;
  /** Guardrail outcome — `false` means the forecast must not be trusted. */
  readonly quantileMonotonic: boolean;
  readonly scaleSuspicious: boolean;
}

export interface ForecastPort {
  predict(request: ForecastRequest): Promise<ForecastResult>;
  healthy(): Promise<boolean>;
}

/** A request that will never reach the service, because it is malformed. */
export class ForecastRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForecastRequestError";
  }
}

/**
 * Production adapter over `TimesFM3Client`.
 *
 * Two behaviours are the port's own rather than the client's:
 *
 * **Serialised dispatch.** The service declares `--workers 1`, so N concurrent
 * requests queue inside it and each waits for the ones ahead. Issuing them in
 * parallel therefore buys nothing and costs a timeout risk on the tail, so this
 * chains every call onto a single in-process queue.
 *
 * **Cached by request.** The same `(target, metric, horizon)` is asked for by
 * the forecast widget, the risk decomposition and the pool tool within one turn.
 * The service would recompute each time; a turn should not pay for that.
 *
 * The queue is deliberately *not* a cancellation mechanism: a queued call still
 * runs even if its caller has moved on, because the service holds one worker
 * either way and aborting mid-flight would leave the queue's ordering ambiguous.
 */
export class TimesFM3ForecastPort implements ForecastPort {
  readonly #client: TimesFM3Client;
  readonly #cacheTtlMs: number;
  readonly #cache = new Map<string, { readonly at: number; readonly value: ForecastResult }>();
  /** Tail of the in-process queue. Every call chains onto it. */
  #tail: Promise<unknown> = Promise.resolve();

  constructor(baseUrl: string, cacheTtlMs = 300_000, http?: TimesFM3Http) {
    this.#client = new TimesFM3Client(http ?? new FetchTimesFM3Http(baseUrl));
    this.#cacheTtlMs = cacheTtlMs;
  }

  async predict(request: ForecastRequest): Promise<ForecastResult> {
    assertPredictable(request);

    const key = JSON.stringify(request);
    const cached = this.#cache.get(key);
    if (cached !== undefined && Date.now() - cached.at < this.#cacheTtlMs) return cached.value;

    const run = async (): Promise<ForecastResult> => {
      const startedAt = Date.now();
      const forecast =
        request.kind === "series"
          ? await this.#client.predict({ series: [...request.series], horizon: request.horizon })
          : (
              await this.#client.predictProtocol({
                protocolSlug: request.protocolSlug,
                metric: request.metric,
                horizon: request.horizon,
              })
            ).forecast;

      return {
        // The wire type carries no separate point array: the median *is* the point estimate, and the
        // client already cross-checked it against `point_forecast` before returning.
        point: forecast.steps.map((step) => step.q50),
        q10: forecast.steps.map((step) => step.q10),
        q50: forecast.steps.map((step) => step.q50),
        q90: forecast.steps.map((step) => step.q90),
        model: forecast.model,
        // The service's own latency, not ours: ours would include queueing and cache misses, which is
        // not what "how slow is the model" means.
        latencyMs: forecast.latencyMs ?? Date.now() - startedAt,
        quantileMonotonic: forecast.flags.quantileMonotonic,
        scaleSuspicious: forecast.flags.scaleSuspicious,
      };
    };

    const queued = this.#tail.then(run, run);
    // Keep the chain alive on failure: a rejected tail would make every later call reject with the
    // *previous* call's error, which is worse than the original failure.
    this.#tail = queued.catch(() => undefined);

    const value = await queued;
    this.#cache.set(key, { at: Date.now(), value });
    return value;
  }

  /**
   * A real forecast rather than a `/health` probe.
   *
   * The client's transport exposes only `post`, and a shallow endpoint check would pass while the
   * model was broken — the failure worth detecting is "the service cannot produce a number", so the
   * check produces one.
   */
  async healthy(): Promise<boolean> {
    try {
      await this.predict({ kind: "series", series: [1, 1, 1, 1, 1, 1, 1, 1], horizon: 1 });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Reject locally what the service would reject remotely.
 *
 * The service's schema requires at least eight observations, so a short series is a caller bug
 * rather than a service condition — and sending it would consume the single worker to learn that.
 */
function assertPredictable(request: ForecastRequest): void {
  if (request.kind === "series") {
    if (request.series.length < 8) {
      throw new ForecastRequestError(
        `a series forecast needs at least 8 observations, got ${request.series.length}`,
      );
    }
  }
  if (!Number.isInteger(request.horizon) || request.horizon < 1 || request.horizon > 365) {
    throw new ForecastRequestError(`horizon must be an integer in 1..365, got ${request.horizon}`);
  }
}

/**
 * The port when no forecasting service is configured.
 *
 * The alternative is constructing the real port against an empty base URL, which turns every call
 * into a transport error whose message says nothing about the setting that is missing. This says
 * which setting, once, where the caller can act on it.
 */
export class UnconfiguredForecastPort implements ForecastPort {
  async predict(_request: ForecastRequest): Promise<ForecastResult> {
    throw new ForecastRequestError(
      "No forecasting service is configured: set TIMESFM3_SERVICE_URL to the TimesFM-3 service. " +
        "Forecasts are unavailable until then, and no number is invented in their place.",
    );
  }

  async healthy(): Promise<boolean> {
    return false;
  }
}
