/**
 * Which tokens exist on each chain, and what they are worth.
 *
 * Both come from LI.FI's token list rather than a table kept here. That is deliberate: a hand-kept
 * address list is wrong the first time a chain migrates a USDC, and a wrong address does not error —
 * it reads a zero balance and reports a confident nothing. Taking the address, the decimals and the
 * price from one authoritative source means they cannot disagree with each other.
 *
 * The list is large (hundreds of KB per chain), so it is fetched once for all five chains, filtered
 * to {@link TRACKED_SYMBOLS}, and held in memory for ten minutes.
 */
import type { TokenRef } from "@ethonline2026/positions";
import { MAX_TOKENS_PER_CHAIN, PORTFOLIO_CHAINS, TRACKED_SYMBOLS } from "./chains";

const TOKENS_URL = "https://li.quest/v1/tokens";
const TTL_MS = 10 * 60 * 1000;

interface LiFiToken {
  readonly address?: unknown;
  readonly symbol?: unknown;
  readonly decimals?: unknown;
  readonly priceUSD?: unknown;
  readonly verificationStatus?: unknown;
}

export interface ChainTokenBook {
  readonly tokens: readonly TokenRef[];
  /** Address (lowercased) → price in USD, or null when LI.FI has no price for it. */
  readonly prices: ReadonlyMap<string, number | null>;
  readonly nativePriceUsd: number | null;
}

let cached: { at: number; books: Map<number, ChainTokenBook> } | undefined;

function isAddressLike(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function priceOf(value: unknown): number | null {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function bookFor(chain: { wrappedNativeSymbol: string }, list: readonly LiFiToken[]): ChainTokenBook {
  const tracked = new Set(TRACKED_SYMBOLS);
  const seen = new Set<string>();
  const tokens: TokenRef[] = [];
  const prices = new Map<string, number | null>();
  let nativePriceUsd: number | null = null;

  for (const entry of list) {
    const symbol = typeof entry.symbol === "string" ? entry.symbol.toUpperCase() : "";
    if (!tracked.has(symbol)) continue;
    // A token LI.FI has checked and rejected is a scam clone wearing a real symbol.
    if (typeof entry.verificationStatus === "string" && entry.verificationStatus !== "verified") continue;
    if (!isAddressLike(entry.address)) continue;
    const decimals = typeof entry.decimals === "number" ? entry.decimals : undefined;
    if (decimals === undefined || decimals < 0 || decimals > 36) continue;

    const key = entry.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push({ address: entry.address as TokenRef["address"], symbol, decimals });
    prices.set(key, priceOf(entry.priceUSD));

    if (nativePriceUsd === null && symbol === chain.wrappedNativeSymbol.toUpperCase()) {
      nativePriceUsd = priceOf(entry.priceUSD);
    }
  }

  // Deterministic order, so two loads of the same portfolio do not reshuffle.
  tokens.sort((left, right) => (left.symbol === right.symbol ? left.address.localeCompare(right.address) : left.symbol.localeCompare(right.symbol)));

  return {
    tokens: tokens.slice(0, MAX_TOKENS_PER_CHAIN),
    prices,
    nativePriceUsd,
  };
}

export async function loadTokenBook(fetchImpl: typeof fetch = fetch): Promise<Map<number, ChainTokenBook>> {
  if (cached !== undefined && Date.now() - cached.at < TTL_MS) return cached.books;

  const chains = PORTFOLIO_CHAINS.map((chain) => chain.chainId).join(",");
  const response = await fetchImpl(`${TOKENS_URL}?chains=${chains}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`LI.FI token list responded ${response.status}`);

  const body = (await response.json()) as { tokens?: Record<string, readonly LiFiToken[]> };
  const books = new Map<number, ChainTokenBook>();
  for (const chain of PORTFOLIO_CHAINS) {
    books.set(chain.chainId, bookFor(chain, body.tokens?.[String(chain.chainId)] ?? []));
  }

  cached = { at: Date.now(), books };
  return books;
}

/** Test seam: the next call refetches instead of trusting the process-wide cache. */
export function clearTokenBookCache(): void {
  cached = undefined;
}
