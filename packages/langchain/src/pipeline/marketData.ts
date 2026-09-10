/**
 * fetchMarketSnapshot — the data-acquisition block, extracted verbatim from the
 * shipped `V4FixedIncomeStrategyTool` so the pipeline's `fetchMarketData` node and
 * the desk session's `ingestion` node can reuse it with zero behavior change.
 *
 * Pipeline (live reads from The Graph):
 *   1. v4 subgraph: volume-ordered pools + hooked books (DualPool-style candidates)
 *   2. per finalist: 14d day data → feeAPY; 168h hourly closes → realized vol σ
 *   3. Aave V3 subgraph: lending APY for the hook's idle-capital leg
 *
 * Pure I/O (no math beyond the RAY→percent lending conversion) — the quant lives in
 * `strategy.ts`. Returns a `MarketSnapshot` with per-finalist provenance.
 */
import { ProtocolRegistry, loadEnv as loadGraphEnv } from "@ethonline2026/graph-fno-indexer";
import {
  dexV4TopPools,
  dexV4HookedPools,
  dexV4PoolDayData,
  dexV4PoolHourData,
  lendingAaveV3Reserves,
  V4_ZERO_HOOK,
  type V4PoolSummary,
  type AaveReserve,
} from "@ethonline2026/graph-fno-indexer";
import { createV4SubgraphClient } from "../tools/uniswapv4/UniswapV4Tools.js";
import { feeApyFromDayData, realizedVolFromHourlyCloses } from "../tools/fixedIncomeMath.js";
import { loadEnv } from "../config/env.js";

export const ZERO_HOOK = V4_ZERO_HOOK;

export const STABLES = new Set([
  "USDC", "USDT", "DAI", "USDS", "USDE", "GHO", "FRAX", "PYUSD", "FDUSD", "RLUSD", "USD1", "TUSD",
]);

export interface AaveRateRow {
  symbol: string;
  liquidityRate: string; // RAY
  totalLiquidity: string;
  decimals: number;
}

/** Ray (1e27) APR → percent. */
export function rayToPercent(ray: string): number {
  return (parseFloat(ray) || 0) / 1e27 * 100;
}

export interface MarketLegInput {
  poolId: string;
  pair: string;
  hook: string | null;
  sigma: number; // decimal
  leverage: number;
  feeApy: number; // decimal (feeApyFromDayData)
  feeSlopeK: number; // decimal (feeApy/sigma when feeSlopeMode=estimated)
  idleFraction: number;
  lendingApy: number; // DECIMAL (percent / 100)
  volumeUsd: number;
}

export interface MarketSnapshot {
  legs: MarketLegInput[];
  aaveRates: Record<string, number>; // percent by symbol
  aaveBlock: number | null;
  v4Block: number | null;
  v4SubgraphId: string;
  aaveSubgraphId: string;
  dataNotes: string[];
  constraints: {
    maxCandidates: number;
    minVolumeUsd: number;
    feeSlopeMode: "estimated" | "static";
    idleFractionHooked: number;
    leverageStable: number;
    leverageVolatile: number;
  };
}

export interface FetchMarketOptions {
  minApr?: number;
  vegaBudget?: number;
  sizeUsd?: number;
  maxCandidates?: number;
  leverageStable?: number;
  leverageVolatile?: number;
  idleFractionHooked?: number;
  minVolumeUsd?: number;
  feeSlopeMode?: "estimated" | "static";
}

export async function fetchMarketSnapshot(
  opts: FetchMarketOptions = {},
): Promise<MarketSnapshot> {
  const {
    maxCandidates = 6,
    leverageStable = 20,
    leverageVolatile = 1,
    idleFractionHooked = 0.3,
    minVolumeUsd = 1_000_000,
    feeSlopeMode = "estimated",
  } = opts;

  const agentEnv = loadEnv();
  const graphEnv = loadGraphEnv();
  const gatewayApiKey = process.env.GATEWAY_API_KEY;
  const v4 = createV4SubgraphClient({
    subgraphId: agentEnv.UNISWAP_V4_SUBGRAPH_ID,
    ...(gatewayApiKey !== undefined ? { gatewayApiKey } : {}),
  });

  // ── 1. Venues: volume-ranked + hooked books ─────────────────────────────
  const [topRes, hookedRes] = await Promise.all([
    v4.executeTemplate(dexV4TopPools, { first: 20, skip: 0 }),
    v4.executeTemplate(dexV4HookedPools, { first: 20, skip: 0, zeroHook: ZERO_HOOK }),
  ]);

  const byId = new Map<string, V4PoolSummary>();
  for (const p of [...topRes.pools, ...hookedRes.pools]) {
    if (!byId.has(p.id)) byId.set(p.id, p);
  }
  const candidates = [...byId.values()]
    .sort((a, b) => (parseFloat(b.volumeUSD ?? "0") || 0) - (parseFloat(a.volumeUSD ?? "0") || 0))
    .slice(0, maxCandidates);

  // ── 2. Lending leg: Aave V3 stablecoin supply APYs ──────────────────────
  let aaveRates: Record<string, number> = {};
  let aaveBlock: number | null = null;
  try {
    const registry = ProtocolRegistry.fromEnv(graphEnv);
    const aave = registry.getSource("aave-v3", "ethereum");
    if (aave) {
      const meta = await aave.client.health({ timeoutMs: 8_000 });
      aaveBlock = meta.blockNumber ?? null;
      const res = await aave.client.executeTemplate(lendingAaveV3Reserves, { first: 20 });
      aaveRates = Object.fromEntries(
        res.reserves
          .filter((r: AaveReserve) => STABLES.has(r.symbol))
          .map((r: AaveReserve) => [r.symbol, rayToPercent(r.liquidityRate)]),
      );
    }
  } catch {
    // lending leg unavailable → hooked books lose their idle yield; fee-only math still valid
  }
  const fallbackLendingApy = aaveRates["USDC"] ?? aaveRates["USDT"] ?? 0;

  // ── 3. Per-candidate market data → MarketLegInput ───────────────────────
  const legs: MarketLegInput[] = [];
  const dataNotes: string[] = [];

  for (const pool of candidates) {
    const s0 = pool.token0?.symbol ?? "?";
    const s1 = pool.token1?.symbol ?? "?";

    const [dayRes, hourRes] = await Promise.all([
      v4.executeTemplate(dexV4PoolDayData, {
        pool: pool.id,
        first: 14,
        startDate: Math.floor(Date.now() / 1000) - 14 * 86400,
      }),
      v4.executeTemplate(dexV4PoolHourData, {
        pool: pool.id,
        first: 168,
        startUnix: Math.floor(Date.now() / 1000) - 168 * 3600,
      }),
    ]);

    const days = dayRes.poolDayDatas;
    const latestDay = days[0];
    const tvl = parseFloat(latestDay?.tvlUSD ?? "0") || 0;
    if (tvl <= 0) {
      dataNotes.push(
        `${s0}/${s1}: excluded from leg math — non-positive TVL (v4 flash-accounting quirk), volume ranking only`,
      );
      continue;
    }
    const fees24h = parseFloat(latestDay?.feesUSD ?? "0") || 0;
    const feeApy = feeApyFromDayData(fees24h, tvl);

    const closes = hourRes.poolHourDatas.slice().reverse().map((h) => parseFloat(h.close ?? "0"));
    const sigma = realizedVolFromHourlyCloses(closes);

    const feeSlopeK = feeSlopeMode === "estimated" && sigma > 0 ? feeApy / sigma : 0;

    const isStableBook = STABLES.has(s0) && STABLES.has(s1);
    const hook = pool.hooks && pool.hooks !== ZERO_HOOK ? pool.hooks : null;

    legs.push({
      poolId: pool.id,
      pair: `${s0}/${s1}`,
      hook,
      sigma,
      leverage: isStableBook ? leverageStable : leverageVolatile,
      feeApy,
      feeSlopeK,
      idleFraction: hook ? idleFractionHooked : 0,
      lendingApy: fallbackLendingApy / 100, // percent → decimal (pure math is decimal)
      volumeUsd: parseFloat(pool.volumeUSD ?? "0") || 0,
    });
  }

  const meta = await v4.health({ timeoutMs: 8_000 }).catch(() => null);

  return {
    legs,
    aaveRates,
    aaveBlock,
    v4Block: meta?.blockNumber ?? null,
    v4SubgraphId: agentEnv.UNISWAP_V4_SUBGRAPH_ID,
    aaveSubgraphId: "Cd2gEDVeqnjBn1hSeqFMitw8Q1iiyV9FYUZkLNRcL87g",
    dataNotes,
    constraints: { maxCandidates, minVolumeUsd, feeSlopeMode, idleFractionHooked, leverageStable, leverageVolatile },
  };
}
