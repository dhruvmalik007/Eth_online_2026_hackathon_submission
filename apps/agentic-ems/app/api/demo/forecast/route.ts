import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "aave",
  "morpho",
  "lido",
  "rocketpool",
  "polymarket",
  "hyperliquid",
  "uniswap",
]);

const FILE_BY_KEY: Record<string, string> = {
  aave: "aave_forecast.json",
  morpho: "morpho_forecast.json",
  lido: "lido_forecast.json",
  rocketpool: "rocketpool_forecast.json",
  polymarket: "polymarket_forecast.json",
  hyperliquid: "hyperliquid_forecast.json",
  uniswap: "uniswap_forecast.json",
};

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("protocol") ?? "";
  if (!ALLOWED.has(key)) {
    return NextResponse.json({ error: `unknown protocol: ${key}` }, { status: 400 });
  }
  const file = FILE_BY_KEY[key];
  // Repo-root data/ in dev; traced output on Vercel (cwd is the app dir there).
  const candidates = [
    path.resolve(process.cwd(), "data/forecasts", file),
    path.resolve(process.cwd(), "../../data/forecasts", file),
  ];
  for (const p of candidates) {
    try {
      const raw = await readFile(p, "utf8");
      return NextResponse.json(JSON.parse(raw), {
        headers: { "cache-control": "public, max-age=300" },
      });
    } catch {}
  }
  return NextResponse.json({ error: `forecast not found for ${key}` }, { status: 404 });
}
