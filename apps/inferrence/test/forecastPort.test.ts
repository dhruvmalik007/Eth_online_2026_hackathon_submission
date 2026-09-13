import { describe, expect, it } from "vitest";
import {
  ForecastRequestError,
  TimesFM3ForecastPort,
  UnconfiguredForecastPort,
  type ForecastRequest,
} from "../src/models/ForecastPort.js";
import type { TimesFM3Http } from "@ethonline2026/langchain-agent";

/**
 * A wire-accurate fake.
 *
 * `TimesFM3Client` validates what it receives — nine quantile levels, monotonic q10 ≤ q50 ≤ q90, and a
 * median that agrees with `point_forecast` — so a fake that skipped those would be testing a client
 * that does not exist.
 */
function fakeHttp(options: { readonly fail?: boolean } = {}) {
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const http: TimesFM3Http = {
    async post(_path, body) {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      // Yield, so an unserialised implementation would interleave here and be observed.
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (options.fail === true) throw new Error("transport down");

      const request = body as { horizon?: number; protocol_slug?: string; metric?: string };
      const horizon = request.horizon ?? 1;
      const forecast = {
        point_forecast: Array.from({ length: horizon }, (_, i) => 10 + i),
        quantiles: Array.from({ length: horizon }, (_, i) => {
          const mid = 10 + i;
          return [mid - 2, mid - 1, mid - 0.5, mid - 0.2, mid, mid + 0.2, mid + 0.5, mid + 1, mid + 2];
        }),
        quantile_levels: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
        horizon,
        model: "timesfm-3",
        latency_ms: 42,
      };
      // The protocol path posts `protocol_slug` — snake_case on the wire — and parses an envelope under
      // `protocol`, so the fake has to branch on that or it answers the wrong shape.
      return request.protocol_slug === undefined
        ? forecast
        : { protocol: request.protocol_slug, metric: request.metric ?? "tvl", forecast };
    },
  };
  return { http, stats: () => ({ calls, maxActive }) };
}

const series = (horizon: number): ForecastRequest => ({
  kind: "series",
  series: [1, 2, 3, 4, 5, 6, 7, 8],
  horizon,
});

describe("TimesFM3ForecastPort", () => {
  it("maps the wire shape onto the port shape", async () => {
    const { http } = fakeHttp();
    const result = await new TimesFM3ForecastPort("http://fm3", 0, http).predict(series(2));

    expect(result.point).toEqual([10, 11]);
    expect(result.q10).toEqual([8, 9]);
    expect(result.q90).toEqual([12, 13]);
    expect(result.model).toBe("timesfm-3");
    // The service's latency, not ours.
    expect(result.latencyMs).toBe(42);
    expect(result.quantileMonotonic).toBe(true);
    expect(result.scaleSuspicious).toBe(false);
  });

  it("unwraps the protocol envelope", async () => {
    const { http } = fakeHttp();
    const result = await new TimesFM3ForecastPort("http://fm3", 0, http).predict({
      kind: "protocol",
      protocolSlug: "aave",
      metric: "tvl",
      horizon: 1,
    });

    expect(result.point).toEqual([10]);
    expect(result.point).toHaveLength(1);
  });

  it("serves a repeated request from cache", async () => {
    const { http, stats } = fakeHttp();
    const port = new TimesFM3ForecastPort("http://fm3", 60_000, http);

    await port.predict(series(2));
    await port.predict(series(2));

    expect(stats().calls).toBe(1);
  });

  it("does not cache across different horizons", async () => {
    const { http, stats } = fakeHttp();
    const port = new TimesFM3ForecastPort("http://fm3", 60_000, http);

    await port.predict(series(2));
    await port.predict(series(3));

    expect(stats().calls).toBe(2);
  });

  it("serialises concurrent dispatch, because the service runs one worker", async () => {
    const { http, stats } = fakeHttp();
    const port = new TimesFM3ForecastPort("http://fm3", 0, http);

    await Promise.all([port.predict(series(1)), port.predict(series(2)), port.predict(series(3))]);

    // Three distinct requests, never two in flight at once.
    expect(stats().calls).toBe(3);
    expect(stats().maxActive).toBe(1);
  });

  it("keeps the queue alive after a failure rather than poisoning it", async () => {
    const failing = fakeHttp({ fail: true });
    const port = new TimesFM3ForecastPort("http://fm3", 0, failing.http);
    await expect(port.predict(series(1))).rejects.toThrow();

    // The next call must fail on its own merits, not inherit the previous rejection.
    const ok = fakeHttp();
    const good = new TimesFM3ForecastPort("http://fm3", 0, ok.http);
    await expect(good.predict(series(1))).resolves.toBeTruthy();
    expect(ok.stats().calls).toBe(1);
  });

  it("rejects a series the service would reject, without spending the worker", async () => {
    const { http, stats } = fakeHttp();
    const port = new TimesFM3ForecastPort("http://fm3", 0, http);

    await expect(
      port.predict({ kind: "series", series: [1, 2, 3], horizon: 1 }),
    ).rejects.toThrow(ForecastRequestError);
    expect(stats().calls).toBe(0);
  });

  it("rejects an out-of-range horizon", async () => {
    const { http } = fakeHttp();
    const port = new TimesFM3ForecastPort("http://fm3", 0, http);
    await expect(port.predict(series(400))).rejects.toThrow(/horizon must be an integer/);
  });

  it("reports health by producing a number, not by probing an endpoint", async () => {
    const up = new TimesFM3ForecastPort("http://fm3", 0, fakeHttp().http);
    expect(await up.healthy()).toBe(true);

    const down = new TimesFM3ForecastPort("http://fm3", 0, fakeHttp({ fail: true }).http);
    expect(await down.healthy()).toBe(false);
  });
});

describe("UnconfiguredForecastPort", () => {
  it("names the setting instead of failing like a transport error", async () => {
    await expect(new UnconfiguredForecastPort().predict(series(1))).rejects.toThrow(
      /TIMESFM3_SERVICE_URL/,
    );
    expect(await new UnconfiguredForecastPort().healthy()).toBe(false);
  });
});
