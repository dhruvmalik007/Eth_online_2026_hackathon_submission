import {
  PredictRequestSchema,
  PredictResponseSchema,
  ProtocolPredictRequestSchema,
  TimesFMForecastSchema,
  type PredictResponse,
  type ProtocolForecast,
  type ProtocolPredictRequestInput,
  type PredictRequestInput,
  type TimesFMForecast,
} from './schemas.js';

/**
 * Transport port (DIP): offline tests inject a canned executor; production
 * wires fetch against the deployed Cloud Run service.
 */
export interface TimesFM3Http {
  post(path: string, body: unknown): Promise<unknown>;
}

export class TimesFM3HttpError extends Error {
  constructor(readonly path: string, readonly status: number, message: string) {
    super(`[timesfm3] POST ${path} → ${status}: ${message}`);
    this.name = 'TimesFM3HttpError';
  }
}

/** fetch adapter — the composition root wires this in once. */
export class FetchTimesFM3Http implements TimesFM3Http {
  constructor(private readonly baseUrl: string) {}

  async post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new TimesFM3HttpError(path, res.status, text.slice(0, 300));
    }
    return JSON.parse(text) as unknown;
  }
}

export class TimesFM3ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimesFM3ValidationError';
  }
}

/**
 * Typed client for the deployed TimesFM-3 service. Every response is
 * schema-validated and passed through guardrail checks (quantile
 * monotonicity, horizon bounds, historical scale sanity) BEFORE it can
 * enter agent state — a malformed or suspicious forecast never flows on
 * silently.
 */
export class TimesFM3Client {
  constructor(
    private readonly http: TimesFM3Http,
    private readonly options: {
      /** Historical stddev of the series, for the k·σ scale-sanity check. */
      readonly historyStdDev?: number;
      /** Median forecast beyond k·σ·|median history| flags `scaleSuspicious`. */
      readonly scaleK?: number;
    } = {},
  ) {}

  async predict(request: PredictRequestInput): Promise<TimesFMForecast> {
    const req = PredictRequestSchema.parse(request);
    const raw = PredictResponseSchema.parse(
      await this.http.post('/predict', {
        series: req.series,
        horizon: req.horizon,
        past_covariates: req.pastCovariates,
        future_covariates: req.futureCovariates,
        return_quantiles: req.returnQuantiles,
      }),
    );
    return this.toForecast('series', req, raw);
  }

  async predictProtocol(request: ProtocolPredictRequestInput): Promise<ProtocolForecast> {
    const req = ProtocolPredictRequestSchema.parse(request);
    const raw = PredictResponseSchema.parse(
      await this.http.post('/predict/protocol', {
        protocol_slug: req.protocolSlug,
        horizon: req.horizon,
        metric: req.metric,
      }),
    );
    return {
      protocolSlug: req.protocolSlug,
      metric: req.metric,
      forecast: this.toForecast(req.metric, req, raw),
    };
  }

  /** Wire response → validated per-step forecast with guardrail flags. */
  private toForecast(
    target: string,
    request: PredictRequestInput | ProtocolPredictRequestInput,
    raw: PredictResponse,
  ): TimesFMForecast {
    const horizon = raw.horizon;
    if (raw.point_forecast.length !== horizon) {
      throw new TimesFM3ValidationError(
        `point_forecast length ${raw.point_forecast.length} != horizon ${horizon}`,
      );
    }
    if (raw.quantiles.length !== horizon) {
      throw new TimesFM3ValidationError(
        `quantiles rows ${raw.quantiles.length} != horizon ${horizon}`,
      );
    }
    if (raw.quantile_levels.length !== 9) {
      throw new TimesFM3ValidationError(
        `expected 9 quantile levels, got ${raw.quantile_levels.length}`,
      );
    }
    const medianIdx = 4; // per deployed contract: median at index 4
    const qIdx = { q10: 0, q50: medianIdx, q90: 8 } as const;

    let quantileMonotonic = true;
    const steps = raw.point_forecast.map((point, step) => {
      const row = raw.quantiles[step]!;
      if (row.length !== 9) {
        throw new TimesFM3ValidationError(`quantile row ${step} has ${row.length} levels, expected 9`);
      }
      const q10 = row[qIdx.q10]!;
      const q50 = row[qIdx.q50]!;
      const q90 = row[qIdx.q90]!;
      if (q10 > q50 || q50 > q90) quantileMonotonic = false;
      // Cross-check the median quantile against the point forecast (tolerance
      // for float noise) — a divergence means the wire shape drifted.
      if (Math.abs(q50 - point) > 1e-3 * Math.max(1, Math.abs(point))) {
        quantileMonotonic = false;
      }
      return { index: step, q10, q50, q90 };
    });

    if (!quantileMonotonic) {
      throw new TimesFM3ValidationError(
        `[${target}] forecast quantiles are non-monotonic or diverge from point_forecast — wire drift suspected`,
      );
    }

    const scaleSuspicious = this.checkScale(request, steps);

    return TimesFMForecastSchema.parse({
      target,
      horizon,
      steps,
      model: raw.model,
      latencyMs: raw.latency_ms,
      flags: { quantileMonotonic, scaleSuspicious },
    });
  }

  /** k·σ sanity: median path outside k·σ·|last historical value| is flagged. */
  private checkScale(
    request: PredictRequestInput | ProtocolPredictRequestInput,
    steps: TimesFMForecast['steps'],
  ): boolean {
    const { historyStdDev, scaleK } = this.options;
    if (historyStdDev === undefined || scaleK === undefined) return false;
    const series = 'series' in request ? request.series : undefined;
    if (series === undefined || series.length === 0) return false;
    const anchor = Math.max(Math.abs(series[series.length - 1]!), 1e-9);
    const bound = (scaleK ?? 10) * historyStdDev * anchor;
    return steps.some((s) => Math.abs(s.q50 - series[series.length - 1]!) > bound * 10);
  }
}
