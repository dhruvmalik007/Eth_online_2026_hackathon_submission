/**
 * parseMandate — deterministic keyword/regex extraction of a trader mandate into a
 * MandateIntent. No LLM: the pipeline's money path must not depend on model output.
 *
 * Recognised clauses (all optional, documented defaults applied otherwise):
 *   $25M / $25 million / 25m USD  → sizeUsd
 *   APR ≥ 6% / apr 6 / return ≥ 6  → minAprPercent
 *   vega ≤ 0.5 / vega budget 0.5   → vegaBudget
 *   hooked only / dual-pool only    → hookedOnly
 *   chains: eth, arb, optimism       → chains
 *   asset: USDC / in USDC            → asset
 */
import type { MandateIntent } from "../state.js";

const DEFAULTS: MandateIntent = {
  sizeUsd: 10_000_000,
  minAprPercent: 6,
  vegaBudget: 0.5,
  chains: ["ethereum", "arbitrum", "optimism", "polygon"],
  hookedOnly: false,
  asset: "USDC",
  maxCandidates: 6,
  leverageStable: 20,
  leverageVolatile: 1,
  idleFractionHooked: 0.3,
  minVolumeUsd: 1_000_000,
  feeSlopeMode: "estimated",
};

const CHAIN_ALIASES: Record<string, string> = {
  eth: "ethereum",
  ethereum: "ethereum",
  arb: "arbitrum",
  arbitrum: "arbitrum",
  opt: "optimism",
  optimism: "optimism",
  poly: "polygon",
  polygon: "polygon",
  base: "base",
};

export function parseMandate(mandate: string): MandateIntent {
  const text = mandate.toLowerCase();
  const intent: MandateIntent = { ...DEFAULTS };

  // ── size ────────────────────────────────────────────────────────────────
  const sizeMatch = text.match(/\$\s*([\d.]+)\s*(m|million|k|billion|b)?/i);
  if (sizeMatch) {
    const n = parseFloat(sizeMatch[1]!);
    const unit = (sizeMatch[2] || "").toLowerCase();
    if (unit.startsWith("b")) intent.sizeUsd = n * 1_000_000_000;
    else if (unit.startsWith("m")) intent.sizeUsd = n * 1_000_000;
    else if (unit.startsWith("k")) intent.sizeUsd = n * 1_000;
    else intent.sizeUsd = n;
  }

  // ── APR ─────────────────────────────────────────────────────────────────
  const aprMatch = text.match(/(?:apr|return|yield)\s*(?:≥|>=|at least|minimum|min)?\s*([\d.]+)\s*%?/i);
  if (aprMatch) intent.minAprPercent = parseFloat(aprMatch[1]!);

  // ── vega budget ─────────────────────────────────────────────────────────
  const vegaMatch = text.match(/vega\s*(?:≤|<=|budget|max|at most)?\s*([\d.]+)/i);
  if (vegaMatch) intent.vegaBudget = parseFloat(vegaMatch[1]!);

  // ── hooked-only ─────────────────────────────────────────────────────────
  if (/hooked\s*only|dual[ -]?pool\s*only|hooked\s*books/.test(text)) intent.hookedOnly = true;

  // ── asset ───────────────────────────────────────────────────────────────
  const assetMatch = text.match(/(?:asset|in|denominated)\s*(?:in\s+)?(usdc|usdt|dai|usds|gho)/i);
  if (assetMatch) intent.asset = assetMatch[1]!.toUpperCase();

  // ── chains ──────────────────────────────────────────────────────────────
  const chainMatch = text.match(/chains?\s*[:\s]*([\w\s,]+?)(?:\.|;|$|\s+(?:apr|vega|asset|hooked|size|with|and))/i);
  if (chainMatch?.[1]) {
    const parsed = chainMatch[1]
      .split(/[,\s]+/)
      .map((c) => CHAIN_ALIASES[c.trim().toLowerCase()])
      .filter((c): c is string => !!c);
    if (parsed.length > 0) intent.chains = parsed;
  }

  return intent;
}
