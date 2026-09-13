// The DeFiLlama snapshot loader — the single source of truth for every
// on-screen number in the Agentic EMS film.
//
//NOTE:  This data is from another package data_fusion/defillama_metrics ( currently not committed but will be added in seperate PR #TODO).
// This module re-exports the handful of anchor records the scene prompts
// interpolate, typed, so a prompt that names a number can be traced back to
// the file it came from. The tokenized-TradFi anchors come from the
// tokenised-ETF dashboard captured in the project and are marked as such.

// --- scraped DeFiLlama anchors (data/defillama_metrics/sections/yields.json) ---
export interface YieldAnchor {
  pool: string;
  apy: string;
  tvl: string;
  source: "DefiLlama";
}

export const DEFILLAMA_YIELDS: ReadonlyArray<YieldAnchor> = [
  { pool: "LIDO stETH", apy: "2.18%", tvl: "$23.26B", source: "DefiLlama" },
  { pool: "AAVE v3", apy: "4.20%", tvl: "$18.41B", source: "DefiLlama" },
  { pool: "MORPHO WETH", apy: "3.20%", tvl: "$9.79B", source: "DefiLlama" },
  { pool: "SPARK USDS", apy: "5.18%", tvl: "$6.20B", source: "DefiLlama" },
  { pool: "ETHERNA USDe", apy: "11.04%", tvl: "$4.70B", source: "DefiLlama" },
  { pool: "COMP v3", apy: "4.50%", tvl: "n/a", source: "DefiLlama" },
];

// --- tokenized TradFi anchors (tokenised-ETF dashboard, captured in-project) ---
export interface TradFiAnchor {
  instrument: string;
  apy: string;
  aum: string;
  source: "RWA.xyz / tokenised-ETF dashboard";
}

export const TRADFI_ANCHORS: ReadonlyArray<TradFiAnchor> = [
  {
    instrument: "BUIDL",
    apy: "4.85%",
    aum: "$2.00B",
    source: "RWA.xyz / tokenised-ETF dashboard",
  },
  {
    instrument: "USDM",
    apy: "4.95%",
    aum: "$0.45B",
    source: "RWA.xyz / tokenised-ETF dashboard",
  },
  {
    instrument: "OUSG",
    apy: "4.78%",
    aum: "$0.38B",
    source: "RWA.xyz / tokenised-ETF dashboard",
  },
];

// --- fees anchors (data/defillama_metrics/sections/fees.json) ---
export const FEES_24H: ReadonlyArray<{ protocol: string; fees: string }> = [
  { protocol: "Lido", fees: "$1.53M" },
  { protocol: "Aave", fees: "$1.15M" },
  { protocol: "Morpho", fees: "$609K" },
];

// --- anchors with no public scrape in this repo — labelled illustrative ---
// impeccable craft-floor rule: claims come from supplied truth; label
// illustrative values honestly. These three groups exist because the film's
// sub-agents build perps / prediction / governance dashboards, and no
// DeFiLlama section covers them. They are market-shaped but invented, and
// are never presented as scraped DeFiLlama data.

export interface IllustrativeAnchor {
  label: string;
  value: string;
  labelled: "illustrative";
}

export const PERPS_ANCHORS: ReadonlyArray<IllustrativeAnchor> = [
  { label: "ETH-PERP funding / 8h", value: "0.0124%", labelled: "illustrative" },
  { label: "ETH-PERP open interest", value: "$412M", labelled: "illustrative" },
  { label: "long/short skew", value: "58/42", labelled: "illustrative" },
];

export const PREDICTION_ANCHORS: ReadonlyArray<IllustrativeAnchor> = [
  { label: "policy cut by March", value: "62c", labelled: "illustrative" },
  { label: "USDS depeg > 1% this quarter", value: "9c", labelled: "illustrative" },
];

export const GOVERNANCE_ANCHORS: ReadonlyArray<IllustrativeAnchor> = [
  { label: "proposal", value: "SPA-114", labelled: "illustrative" },
  { label: "quorum reached", value: "84%", labelled: "illustrative" },
  { label: "for / against", value: "61.4 / 38.6", labelled: "illustrative" },
  { label: "closes in", value: "14h", labelled: "illustrative" },
];

// --- Hyperliquid perps — REAL, fetched live from the public info API ---
// POST https://api.hyperliquid.xyz/info {"type":"metaAndAssetCtxs"} on
// 2026-09-04, via the hyperliquid-reader skill's field schema
// (markPx / fundingHrPct / fundingAprPct / openInterest / dayNtlVlm).

export interface HyperliquidAnchor {
  coin: string;
  mark: string;
  change24h: string;
  fundingHr: string;
  fundingApr: string;
  oiNotional: string;
  labelled: "real";
  source: "Hyperliquid info API";
}

export const HYPERLIQUID_ANCHORS: ReadonlyArray<HyperliquidAnchor> = [
  { coin: "BTC", mark: "79,465", change24h: "-1.84%", fundingHr: "+0.0009%/hr", fundingApr: "+8.1% APR", oiNotional: "$2.90B", labelled: "real", source: "Hyperliquid info API" },
  { coin: "ETH", mark: "2,448.1", change24h: "-2.43%", fundingHr: "+0.0013%/hr", fundingApr: "+10.9% APR", oiNotional: "$2.20B", labelled: "real", source: "Hyperliquid info API" },
  { coin: "SOL", mark: "101.7", change24h: "-1.93%", fundingHr: "+0.0009%/hr", fundingApr: "+7.7% APR", oiNotional: "$0.58B", labelled: "real", source: "Hyperliquid info API" },
  { coin: "HYPE", mark: "83.9", change24h: "-2.62%", fundingHr: "+0.0013%/hr", fundingApr: "+10.9% APR", oiNotional: "$1.95B", labelled: "real", source: "Hyperliquid info API" },
];

// --- BSM options analytics — the hedging overlay on the executed book ---
// The call premium is REAL output of simulation_engine.py (§7 metric lock);
// IV / delta are the pricing inputs around it, labelled illustrative.

export interface OptionsAnchor {
  label: string;
  value: string;
  labelled: "real (sim)" | "illustrative";
}

export const OPTIONS_ANCHORS: ReadonlyArray<OptionsAnchor> = [
  { label: "BSM call premium", value: "0.4355", labelled: "real (sim)" },
  { label: "implied vol", value: "42.5%", labelled: "illustrative" },
  { label: "delta", value: "0.58", labelled: "illustrative" },
  { label: "risk-free", value: "4.3%", labelled: "illustrative" },
];

// --- the one FICT anchor — the trade subject of the film ---
export const FICT_ANCHOR = {
  instrument: "SPDR UST BASKET",
  cusip: "U5051",
  spot: "99.217",
  yield: "4.620",
  coupon: "1.734",
  maturity: "07/22/27",
  sizeK: "52890",
  method: "Mid",
  maturitySel: "Worst",
  schedule: "8.4M × 10 slices",
} as const;

// Every numeral a scene prompt may name. validate.ts checks prompts against
// this allow-list — a number that appears nowhere here and is not the FICT
// anchor fails the build before anything is enqueued.
export const ALLOWED_NUMBERS: ReadonlySet<string> = new Set([
  // DeFiLlama APYs / TVLs
  "2.18", "4.20", "3.20", "5.18", "11.04", "4.50",
  "23.26", "18.41", "9.79", "6.20", "4.70",
  // tokenised-ETF dashboard
  "4.85", "4.95", "4.78", "2.00", "0.45", "0.38",
  "10", "56.87", "674,994",
  // fees 24h
  "1.53", "1.15", "609",
  // forecast threshold + the film's two clocks
  "5.00", "23:52", "23:47", "23:59",
  // the FICT anchor fields
  "99.217", "4.620", "1.734", "07/22/27", "52890", "8.4",
  // bp moves quoted in dialogue
  "8", "12",
  // the copilot's desk count ("Desks — X/5 mounted")
  "5",
  // perps anchors (illustrative) — funding voiced as "longs paying", OI visual-only
  "58", "42", "412",
  // prediction anchors (illustrative)
  "62", "9",
  // governance anchors (illustrative)
  "114", "84", "61.4", "38.6", "14",
  // Hyperliquid perps (real, fetched live)
  "79465", "1.84", "2448.1", "2.43", "101.7", "83.9", "2.62",
  "0.0009", "0.0013", "8.1", "10.9", "7.7", "2.90", "2.20", "1.95", "0.58",
  // BSM options analytics (call = real sim output; inputs illustrative)
  "0.4355", "42.5",
  // strategy-simulation output (illustrative): expected basis-carry across
  // tokenized funds vs the perp hedge, from the Monte Carlo sim card
  "128",
  // storyline v2 narrative anchors (health-factor crisis arc)
  "1.42", "1.19", "1.15", "1.38", "2890", "2850",
  // Label 7 observability board (LangSmith-style run metrics, illustrative)
  "1847", "214", "340", "2.1", "18.40", "4.6",
  // clock faces (Label 7's board clock, spoken-time digits)
  "45",
]);
