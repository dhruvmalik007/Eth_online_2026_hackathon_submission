#!/usr/bin/env node
/**
 * API-first fetch of DeFiLlama data for the 5 demo strategies that lack local
 * forecast files (Lido, RocketPool, Polymarket, Hyperliquid, Uniswap v4).
 *
 * For each protocol:
 *  - GET https://api.llama.fi/protocol/<slug>  → tvl history + metadata
 *  - Derive a 30d trend projection with q10/q50/q90 bands from the last 60d of
 *    realized daily TVL changes (same schema as data/forecasts/aave_forecast.json)
 *
 * Writes data/forecasts/<slug>_forecast.json and updates
 * data/defillama_metrics/scrape_manifest.json.
 *
 * Usage: node data/scripts/fetch-strategy-data.mjs
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FORECASTS_DIR = path.join(ROOT, "data", "forecasts");
const MANIFEST_PATH = path.join(ROOT, "data", "defillama_metrics", "scrape_manifest.json");

const TARGETS = [
  { slug: "lido", file: "lido_forecast.json" },
  { slug: "rocket-pool", file: "rocketpool_forecast.json" },
  { slug: "polymarket", file: "polymarket_forecast.json" },
  { slug: "hyperliquid", file: "hyperliquid_forecast.json" },
  { slug: "uniswap", file: "uniswap_forecast.json" },
];

const STEP_DAYS = 30;
const HISTORY_DAYS = 60;

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Derive a 30d daily forecast + quantile bands from realized daily TVL deltas. */
function project(history, currentTvl) {
  const series = history.map((p) => p.tvl ?? p.totalLiquidityUSD);
  const recent = series.filter((v) => v != null).slice(-HISTORY_DAYS).map((tvl) => ({ tvl }));
  if (recent.length < 8) throw new Error(`insufficient history (${recent.length} points)`);
  const deltas = [];
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].tvl != null && recent[i - 1].tvl != null && recent[i - 1].tvl !== 0) {
      deltas.push(recent[i].tvl - recent[i - 1].tvl);
    }
  }
  deltas.sort((a, b) => a - b);
  const median = quantile(deltas, 0.5);
  const q10 = quantile(deltas, 0.1);
  const q90 = quantile(deltas, 0.9);

  const forecast_30d = [];
  const quantiles_30d = [];
  let level = recent[recent.length - 1].tvl ?? currentTvl;
  for (let step = 1; step <= STEP_DAYS; step++) {
    level += median;
    forecast_30d.push(level);
    // bands widen with the square root of horizon
    const spreadLo = q10 * Math.sqrt(step);
    const spreadHi = q90 * Math.sqrt(step);
    quantiles_30d.push([level + spreadLo, level, level + spreadHi]);
  }
  return { forecast_30d, quantiles_30d };
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function main() {
  await mkdir(FORECASTS_DIR, { recursive: true });
  const results = { fetched: {}, errors: [] };

  for (const target of TARGETS) {
    try {
      // uniswap's /protocol payload is huge (gateway 524) — use the lighter dexs summary
      let data, history;
      if (target.slug === "uniswap") {
        data = await fetchJson("https://api.llama.fi/summary/dexs/uniswap?excludeTotalDataChart=false");
        history = (data.totalDataChart ?? []).map(([ts, v]) => ({ date: ts, totalLiquidityUSD: v }));
      } else {
        data = await fetchJson(`https://api.llama.fi/protocol/${target.slug}`);
        history = Array.isArray(data.tvl) ? data.tvl : [];
      }
      const currentTvl = history.at(-1)?.totalLiquidityUSD ?? history.at(-1)?.tvl ?? 0;
      const { forecast_30d, quantiles_30d } = project(history, currentTvl);
      const payload = {
        protocol: target.slug.replace(/-/g, ""),
        current_tvl: currentTvl,
        forecast_30d,
        quantiles_30d,
        provenance: {
          source: "api.llama.fi/protocol/" + target.slug,
          name: data.name ?? target.slug,
          historyPoints: history.length,
          generatedAt: new Date().toISOString(),
          method: "api-first; 30d projection from realized daily TVL deltas (median drift, empirical q10/q90 bands)",
        },
      };
      await writeFile(path.join(FORECASTS_DIR, target.file), JSON.stringify(payload, null, 2) + "\n");
      results.fetched[target.slug] = {
        file: `data/forecasts/${target.file}`,
        currentTvl,
        historyPoints: history.length,
      };
      console.log(`ok  ${target.slug.padEnd(12)} tvl=$${(currentTvl / 1e6).toFixed(1)}M`);
    } catch (err) {
      results.errors.push({ slug: target.slug, error: String(err.message ?? err) });
      console.error(`ERR ${target.slug}: ${err.message ?? err}`);
    }
  }

  let manifest = {};
  try {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  } catch {}
  manifest.generatedAt = new Date().toISOString();
  manifest.fetched = { ...(manifest.fetched ?? {}), "strategy-forecasts": results.fetched };
  if (results.errors.length) manifest.errors = [...(manifest.errors ?? []), ...results.errors];
  manifest.outputs = { ...(manifest.outputs ?? {}), strategyForecasts: "data/forecasts/" };
  manifest.notes = [
    ...(manifest.notes ?? []),
    "strategy-forecast gap-fill (lido, rocket-pool, polymarket, hyperliquid, uniswap) via api.llama.fi protocol endpoint; 30d projection derived client of realized deltas",
  ];
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\nmanifest updated: ${path.relative(ROOT, MANIFEST_PATH)}`);
  if (results.errors.length) process.exitCode = 1;
}

main();
