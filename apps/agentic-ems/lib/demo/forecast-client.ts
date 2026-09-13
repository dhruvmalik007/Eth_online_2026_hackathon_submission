import type { ForecastPayload } from "./data";

/**
 * Client-side forecast fetch, used only for the on-demand chat widget. Everything
 * else — the dashboard, the landing page — reads this data on the server via
 * `lib/server/demo-data.ts`, which caches it and avoids the request entirely.
 */
export async function fetchForecast(protocol: string): Promise<ForecastPayload> {
  const res = await fetch(`/api/demo/forecast?protocol=${encodeURIComponent(protocol)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`forecast fetch failed: ${res.status}`);
  return res.json();
}
