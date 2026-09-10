/**
 * OneInchClient — 1inch Swap API v6.0 client for the spoke-chain swap legs.
 *
 * Degrade contract (no API key): quotes are still attempted via the public endpoint;
 * fills are marked `{ quoted: true, filled: false, reason: 'no-api-key' }`. With a key,
 * live `/swap` fills are submitted via the caller's wallet.
 *
 * Also exposes `liquidityDepth` for the 07:30 Ingestion Agent's depth map.
 */
export interface OneInchQuote {
  dstToken: string;
  dstAmount: string;
  fromToken: string;
  fromAmount: string;
  gas: number;
  protocols?: unknown;
}

export interface OneInchSwapResult {
  tx: { to: string; data: string; value: string; gas: number; gasPrice: string };
}

const ONEINCH_BASE = "https://api.1inch.dev/swap/v6.0";

export class OneInchClient {
  constructor(private readonly apiKey?: string) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { accept: "application/json" };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  /** GET /quote — returns the expected output amount for a swap. */
  async quote(params: {
    chainId: number;
    src: string;
    dst: string;
    amount: string;
    includeProtocols?: boolean;
  }): Promise<OneInchQuote> {
    const url = new URL(`${ONEINCH_BASE}/${params.chainId}/quote`);
    url.searchParams.set("src", params.src);
    url.searchParams.set("dst", params.dst);
    url.searchParams.set("amount", params.amount);
    if (params.includeProtocols) url.searchParams.set("includeProtocols", "true");
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`1inch quote ${res.status}: ${await res.text().catch(() => "")}`);
    return (await res.json()) as OneInchQuote;
  }

  /** GET /swap — returns the tx calldata to submit the fill. */
  async swap(params: {
    chainId: number;
    src: string;
    dst: string;
    amount: string;
    from: string; // EOA that submits
    slippage: number; // percentage, e.g. 1 for 1%
    disableEstimate?: boolean;
  }): Promise<OneInchSwapResult> {
    if (!this.apiKey) {
      return { tx: { to: "", data: "", value: "0", gas: 0, gasPrice: "0" } };
    }
    const url = new URL(`${ONEINCH_BASE}/${params.chainId}/swap`);
    url.searchParams.set("src", params.src);
    url.searchParams.set("dst", params.dst);
    url.searchParams.set("amount", params.amount);
    url.searchParams.set("from", params.from);
    url.searchParams.set("slippage", String(params.slippage));
    if (params.disableEstimate) url.searchParams.set("disableEstimate", "true");
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`1inch swap ${res.status}: ${await res.text().catch(() => "")}`);
    return (await res.json()) as OneInchSwapResult;
  }

  /**
   * liquidityDepth — best-effort depth signal for the ingestion node. Without an API
   * key this is a no-op placeholder (returns empty); the research agent treats missing
   * depth as "unexplored", not an error.
   */
  async liquidityDepth(chainId: number, tokens: string[]): Promise<Record<string, unknown>> {
    if (!this.apiKey) return {};
    try {
      const out: Record<string, unknown> = {};
      for (const t of tokens) {
        const url = new URL(`${ONEINCH_BASE}/${chainId}/tokens`);
        const res = await fetch(url, { headers: this.headers() });
        if (res.ok) out[t] = true;
      }
      return out;
    } catch {
      return {};
    }
  }
}
