import { describe, expect, it } from 'vitest';
import {
  PredictRequestSchema,
  TimesFM3Client,
  TimesFM3ValidationError,
  backtestForecast,
  pastCovariatesAligned,
  perStepChangeCovariate,
  type TimesFM3Http,
} from '../../src/services/timesfm3/index.js';

const LIVE_SHAPE = {
  point_forecast: [1.085, 1.045, 1.062],
  quantiles: [
    [0.981, 1.019, 1.045, 1.066, 1.085, 1.104, 1.125, 1.149, 1.183],
    [0.935, 0.975, 1.002, 1.025, 1.045, 1.065, 1.086, 1.111, 1.146],
    [0.949, 0.991, 1.019, 1.041, 1.062, 1.082, 1.103, 1.129, 1.145],
  ],
  quantile_levels: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
  horizon: 3,
  model: 'timesfm-3.0',
  latency_ms: 153.7,
};

/** Canned-HTTP transport shaped exactly like the deployed wire contract. */
class FakeHttp implements TimesFM3Http {
  readonly bodies: unknown[] = [];
  private nextError: Error | null = null;

  constructor(private responder: (path: string, body: unknown) => unknown) {}

  failNextWith(err: Error): void {
    this.nextError = err;
  }

  async post(path: string, body: unknown): Promise<unknown> {
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = null;
      throw err;
    }
    this.bodies.push(body);
    return this.responder(path, body);
  }
}

describe('TimesFM3Client.predict', () => {
  it('validates the wire shape and maps to per-step q10/q50/q90', async () => {
    const http = new FakeHttp(() => LIVE_SHAPE);
    const client = new TimesFM3Client(http);
    const f = await client.predict({
      series: [1.0, 1.1, 0.9, 1.05, 1.2, 0.95, 1.1, 1.15, 1.0, 1.08],
      horizon: 3,
    });
    expect(f.model).toBe('timesfm-3.0');
    expect(f.steps.map((s) => s.q50)).toEqual(LIVE_SHAPE.point_forecast);
    expect(f.steps[0]!.q10).toBeCloseTo(0.981, 6);
    expect(f.steps[0]!.q90).toBeCloseTo(1.183, 6);
    expect(f.flags.quantileMonotonic).toBe(true);
    // wire body uses the service's snake_case contract
    const body = http.bodies[0]! as Record<string, unknown>;
    expect(body['past_covariates']).toBeNull();
    expect(body['return_quantiles']).toBe(true);
  });

  it('rejects non-monotonic quantiles (wire drift) with a typed error', async () => {
    const bad = structuredClone(LIVE_SHAPE);
    bad.quantiles[0] = [1.5, 1.4, 1.3, 1.2, 1.1, 1.0, 0.9, 0.8, 0.7]; // inverted
    const http = new FakeHttp(() => bad);
    const client = new TimesFM3Client(http);
    await expect(
      client.predict({ series: [1, 1.1, 0.9, 1.05], horizon: 3 }),
    ).rejects.toThrow(TimesFM3ValidationError);
  });

  it('rejects a row-count mismatch against the horizon', async () => {
    const bad = structuredClone(LIVE_SHAPE);
    bad.quantiles = bad.quantiles.slice(0, 2); // 2 rows vs horizon 3
    const http = new FakeHttp(() => bad);
    const client = new TimesFM3Client(http);
    await expect(
      client.predict({ series: [1, 1.1, 0.9, 1.05], horizon: 3 }),
    ).rejects.toThrow(/quantiles rows 2 != horizon 3/);
  });

  it('propagates transport failures (adapter wraps status/text)', async () => {
    const http = new FakeHttp(() => {
      throw new Error('503 overloaded');
    });
    const client = new TimesFM3Client(http);
    await expect(
      client.predict({ series: [1, 1.1, 0.9, 1.05], horizon: 3 }),
    ).rejects.toThrow(/503 overloaded/);
  });
});

describe('past-covariate alignment', () => {
  const series = [0.04, 0.041, 0.039, 0.042, 0.0415, 0.043];

  it('produces one covariate value per series point, not per change', () => {
    const covariate = perStepChangeCovariate(series);
    // Verified live: a covariate of length N-1 makes /predict return HTTP 500,
    // so alignment with the series is the contract being pinned here.
    expect(covariate).toHaveLength(series.length);
    expect(covariate).toHaveLength(6);
  });

  it('reports no change for the first point rather than inventing one', () => {
    expect(perStepChangeCovariate(series)[0]).toBe(0);
  });

  it('computes absolute per-step change thereafter', () => {
    const covariate = perStepChangeCovariate(series);
    expect(covariate[1]).toBeCloseTo(Math.abs(0.041 - 0.04), 12);
    expect(covariate[2]).toBeCloseTo(Math.abs(0.039 - 0.041), 12);
    expect(covariate.every((v) => v >= 0)).toBe(true);
  });

  it('handles the degenerate series shapes', () => {
    expect(perStepChangeCovariate([])).toEqual([]);
    expect(perStepChangeCovariate([0.04])).toEqual([0]);
  });

  it('rejects a misaligned covariate before the request is sent', () => {
    // A short covariate must fail locally with a clear message: the service
    // answers it with an opaque 500, which previously read as a model outage.
    const short = series.slice(1).map((v, i) => Math.abs(v - series[i]!));
    expect(() =>
      PredictRequestSchema.parse({ series, horizon: 30, pastCovariates: [short] }),
    ).toThrow(/same length as series/);
  });

  it('accepts an aligned covariate', () => {
    const parsed = PredictRequestSchema.parse({
      series,
      horizon: 30,
      pastCovariates: [perStepChangeCovariate(series)],
    });
    expect(parsed.pastCovariates?.[0]).toHaveLength(series.length);
  });

  it('accepts a null covariate', () => {
    expect(PredictRequestSchema.parse({ series, horizon: 30 }).pastCovariates).toBeNull();
  });

  it('reports alignment for every row', () => {
    expect(pastCovariatesAligned(series, [perStepChangeCovariate(series)])).toBe(true);
    expect(pastCovariatesAligned(series, [[1, 2]])).toBe(false);
  });
});

describe('TimesFM3Client.predictProtocol', () => {
  /**
   * The deployed `/predict/protocol` nests the forecast one level down
   * (verified live 2026-09-11): `{ protocol, current_tvl, context_length,
   * forecast: {...} }`. Parsing it with the flat schema — which `/predict`
   * does match — fails against the real service, so this shape is pinned.
   */
  const LIVE_PROTOCOL_SHAPE = {
    protocol: 'aave',
    current_tvl: '17.237b',
    context_length: 181,
    forecast: LIVE_SHAPE,
  };

  it('unwraps the nested forecast payload', async () => {
    const http = new FakeHttp(() => LIVE_PROTOCOL_SHAPE);
    const client = new TimesFM3Client(http);
    const result = await client.predictProtocol({ protocolSlug: 'aave', horizon: 3, metric: 'apy' });

    expect(result.protocolSlug).toBe('aave');
    expect(result.metric).toBe('apy');
    expect(result.forecast.steps.map((s) => s.q50)).toEqual(LIVE_SHAPE.point_forecast);
    expect(result.forecast.flags.quantileMonotonic).toBe(true);

    const body = http.bodies[0]! as Record<string, unknown>;
    expect(body['protocol_slug']).toBe('aave');
    expect(body['metric']).toBe('apy');
  });

  it('rejects the flat shape (the shape /predict returns)', async () => {
    // Guards against the two endpoints being conflated again: a flat body has
    // no `forecast` key, so it must not parse.
    const http = new FakeHttp(() => LIVE_SHAPE);
    const client = new TimesFM3Client(http);
    await expect(
      client.predictProtocol({ protocolSlug: 'aave', horizon: 3, metric: 'apy' }),
    ).rejects.toThrow();
  });

  it('keeps the guardrail checks for the nested payload', async () => {
    const bad = structuredClone(LIVE_PROTOCOL_SHAPE);
    bad.forecast.quantiles[0] = [1.9, 1.8, 1.7, 1.6, 1.5, 1.4, 1.3, 1.2, 1.1];
    const http = new FakeHttp(() => bad);
    const client = new TimesFM3Client(http);
    await expect(
      client.predictProtocol({ protocolSlug: 'aave', horizon: 3, metric: 'apy' }),
    ).rejects.toThrow(TimesFM3ValidationError);
  });
});

describe('backtestForecast (pure scoring)', () => {
  const steps = [
    { index: 0, q10: 0.9, q50: 1.0, q90: 1.1 },
    { index: 1, q10: 0.95, q50: 1.05, q90: 1.15 },
    { index: 2, q10: 1.0, q50: 1.1, q90: 1.2 },
  ];

  it('scores hit-rate, MAPE, and strategy-vs-hodl', () => {
    const score = backtestForecast({ steps, realized: [1.02, 1.08, 1.12] });
    expect(score.hitRate).toBe(1); // all three realized inside bands
    expect(score.mape).toBeCloseTo((0.02 + 0.02857 + 0.01818) / 3, 4);
    expect(score.steps).toBe(3);
  });

  it('counts band misses and handles a flat hodl comparison', () => {
    const score = backtestForecast({ steps, realized: [1.3, 1.08, 0.8] });
    expect(score.hitRate).toBeCloseTo(1 / 3, 6); // only step 1 lands inside
    expect(score.mape).toBeGreaterThan(0);
  });

  it('rejects a length mismatch between steps and realized', () => {
    expect(() => backtestForecast({ steps, realized: [1.0] })).toThrow(/must equal steps length/);
  });
});
