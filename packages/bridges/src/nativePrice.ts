/**
 * Native-token pricing — closes the gap where LayerZero fee lines reported $0.
 *
 * ## Why this exists
 *
 * Circle prices CCTP fees in the fee token **and tells us the rate**
 * (`metadata.exchangeRates.feeTokenUsd`), so CCTP lines carry a real dollar
 * figure. LayerZero does not: its endpoint returns a fee in **wei**, and nothing
 * about it is denominated in dollars.
 *
 * That asymmetry meant every LayerZero leg contributed `amountUsd: 0` to a
 * headline total, so a route comparison would silently understate the most
 * expensive part of the trade. `sumWalletCost()` sums those lines faithfully —
 * the input was simply wrong.
 *
 * ## Where the number comes from
 *
 * DefiLlama's coins API, keyless and already a data source in this project
 * (`defi-data` skill). It answers one question: USD per whole major unit.
 *
 * ## The decimals trap, and why it is explicit here
 *
 * The fee is in wei, but "wei" is not always `10^18`. **Arc uses USDC as its
 * native gas token**, so its 6 decimals would mis-scale by `10^12` — the same
 * class of units error the CCTP reader already hit once. Decimals are therefore
 * configuration with an 18 default, not an assumption.
 */
import { z } from "zod";

/** USD per one whole native unit, or `null` when it cannot be established. */
export interface NativePriceSource {
  priceUsd(chainId: number): Promise<number | null>;
  /**
   * Convert a native-wei amount to USD, or `null` when the price is unknown.
   *
   * Part of the port rather than a helper beside it, because the **decimals**
   * are chain-specific — Arc settles gas in USDC, which is 6, not 18 — and that
   * knowledge belongs with whoever holds the price and the chain mapping.
   */
  nativeToUsd(chainId: number, wei: string): Promise<number | null>;
}

/**
 * CoinGecko ids, because that is the key DefiLlama's coins API expects.
 *
 * Testnets map to their mainnet asset on purpose: Sepolia ETH has no market of
 * its own, and pricing a testnet fee at zero would defeat the purpose. The value
 * is an estimate for a fee figure, which is exactly what a quote is.
 */
const COINGECKO_BY_CHAIN: Readonly<Record<number, string>> = {
  1: "ethereum",
  11155111: "ethereum",
  8453: "ethereum",
  84532: "ethereum",
  42161: "ethereum",
  421614: "ethereum",
  137: "polygon-ecosystem-token",
  80002: "polygon-ecosystem-token",
};

/** DefiLlama returns a per-key object; only `price` is used. */
const PriceSchema = z.object({
  coins: z.record(z.string(), z.object({ price: z.number().optional() })),
});

export interface DefiLlamaPriceConfig {
  readonly baseUrl?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Decimals for the *native* token per chain. Defaults to 18.
   *
   * Arc Testnet settles gas in USDC (6), so it belongs here.
   */
  readonly nativeDecimalsByChain?: Readonly<Record<number, number>>;
  /** Short-lived cache: a quote does not need a fresh price per call. */
  readonly cacheTtlMs?: number;
}

export class DefiLlamaPriceSource implements NativePriceSource {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<number, { at: number; price: number | null }>();

  constructor(private readonly config: DefiLlamaPriceConfig = {}) {
    this.baseUrl = config.baseUrl ?? "https://coins.llama.fi";
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.cacheTtlMs = config.cacheTtlMs ?? 60_000;
  }

  /** Decimals of the chain's native gas token. */
  nativeDecimals(chainId: number): number {
    return this.config.nativeDecimalsByChain?.[chainId] ?? 18;
  }

  async priceUsd(chainId: number): Promise<number | null> {
    const cached = this.cache.get(chainId);
    if (cached !== undefined && Date.now() - cached.at < this.cacheTtlMs) return cached.price;

    const id = COINGECKO_BY_CHAIN[chainId];
    if (id === undefined) {
      // Unknown chain: returning null is honest, and the caller records the fee
      // as unpriced rather than inventing a zero.
      this.cache.set(chainId, { at: Date.now(), price: null });
      return null;
    }

    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/prices/current/coingecko:${id}`,
        { headers: { accept: "application/json" } },
      );
      if (!response.ok) {
        this.cache.set(chainId, { at: Date.now(), price: null });
        return null;
      }
      const parsed = PriceSchema.safeParse(await response.json());
      const price = parsed.success
        ? parsed.data.coins[`coingecko:${id}`]?.price ?? null
        : null;
      this.cache.set(chainId, { at: Date.now(), price });
      return price;
    } catch {
      this.cache.set(chainId, { at: Date.now(), price: null });
      return null;
    }
  }

  /**
   * Convert a native-wei amount to USD.
   *
   * `null` when the price is unknown — never `0`, because a zero would be
   * indistinguishable from a genuinely free leg once it reached the fee lines.
   */
  async nativeToUsd(chainId: number, wei: string): Promise<number | null> {
    const price = await this.priceUsd(chainId);
    if (price === null) return null;
    const units = Number(wei) / 10 ** this.nativeDecimals(chainId);
    return Number.isFinite(units) ? units * price : null;
  }
}
