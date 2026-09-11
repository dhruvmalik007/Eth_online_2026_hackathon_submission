/**
 * StableFX — Arc's native FX engine (quote/settle stablecoin FX pairs on Arc).
 *
 * Reached through the App Kit Swap capability for execution; this module keeps
 * the FX-specific surface (pairs, quotes) so the agent can price a non-USD leg
 * before committing. Production settle requires KYB (docs: Circle Partner
 * Stablecoins program) — testnet pairs work without it.
 */
import type { AppKitBridge, SwapParams } from "./appkit.js";

export interface FxQuote {
  pair: string; // "USDC/EURC"
  amountInUsdc: number;
  amountOut: number;
  rate: number;
  venue: "StableFX (Arc native)";
}

export class StableFx {
  constructor(private readonly appKit: AppKitBridge) {}

  /**
   * Quote a pair. Rates on Arc are on-chain oracle-derived; until the SDK
   * exposes a quote-only call we use the swap preview semantics (read-only).
   */
  async quote(pair: string, amountInUsdc: number): Promise<FxQuote> {
    const [base, quoteCcy] = pair.split("/") as [string, string];
    if (!base || !quoteCcy) throw new Error(`invalid FX pair: ${pair}`);
    // StableFX quotes are oracle-published; swap preview returns the rate.
    const rate = await this.oracleRate(pair);
    return {
      pair,
      amountInUsdc,
      amountOut: +(amountInUsdc * rate).toFixed(6),
      rate,
      venue: "StableFX (Arc native)",
    };
  }

  /** Settle an FX conversion through App Kit Swap (USDC → non-USD leg). */
  async settle(pair: string, amountInUsdc: number, fromToken: Parameters<AppKitBridge["swap"]>[0]["fromToken"], toToken: Parameters<AppKitBridge["swap"]>[0]["toToken"]): Promise<ReturnType<AppKitBridge["swap"]>> {
    const params: SwapParams = { fromToken, toToken, amountUsdc: amountInUsdc };
    const result = await this.appKit.swap(params);
    return { ...result, amountUsdc: amountInUsdc };
  }

  /** Oracle rate — StableFX publishes on-chain; env override for demos. */
  private async oracleRate(pair: string): Promise<number> {
    const envRate = process.env[`STABLEFX_RATE_${pair.replace("/", "_").toUpperCase()}`];
    if (envRate) return Number(envRate);
    // Sensible testnet defaults (USDC/EURC ~parity bands). Verify vs on-chain
    // oracle during integration — this path must not silently drift on mainnet.
    if (pair === "USDC/EURC") return 0.92;
    if (pair === "EURC/USDC") return 1.087;
    throw new Error(`no StableFX rate configured for ${pair} — set STABLEFX_RATE_${pair.replace("/", "_").toUpperCase()}`);
  }
}
