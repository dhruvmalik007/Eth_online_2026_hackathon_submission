/**
 * Arc App Kit wrappers (`@circle-fin/app-kit`) — Send / Bridge / Swap / Unified Balance.
 *
 * The SDK is imported DYNAMICALLY so the package stays installable even if the
 * App Kit's peer matrix shifts; every method is time-boxed. The server-side
 * wallet adapter (AgentWallet) is passed through — App Kit supports building an
 * adapter from wallet credentials per its docs.
 *
 * Per docs.arc.io/app-kit/bridge: Bridge "abstracts the underlying CCTP flow so
 * you can bridge without orchestrating the low-level burn, attestation, and mint
 * steps yourself."
 */
import type { Address } from "viem";
import type { AgentWallet } from "./wallet.js";

export interface AppKitOptions {
  /** Circle Console API key — optional for Swap, lifts rate limits (docs §installation). */
  apiKey?: string;
  /** App Kit environment: "testnet" | "mainnet". */
  environment: "testnet" | "mainnet";
  /** The agent's scoped wallet (server-side adapter). */
  wallet: AgentWallet;
}

/** Internal accessor — dynamic import keeps cold start light. */
async function appKitModule(): Promise<Record<string, unknown>> {
  return (await import("@circle-fin/app-kit")) as unknown as Record<string, unknown>;
}

export interface BridgeParams {
  amountUsdc: number;
  fromChain: string; // source chain label (e.g. "ethereum")
  toChain: string; // destination label — the Arc leg uses arc-testnet/arc-mainnet
}

export interface SwapParams {
  fromToken: Address; // e.g. USDC on Arc
  toToken: Address; // e.g. EURC on Arc (StableFX leg)
  amountUsdc: number;
}

export class AppKitBridge {
  constructor(private readonly opts: AppKitOptions) {}

  /**
   * Bridge USDC to/from Arc via the App Kit (CCTP V2 under the hood).
   * The SDK handles burn → attestation → mint; we surface the result hash.
   */
  async bridge(p: BridgeParams): Promise<{ status: string; fromChain: string; toChain: string; amountUsdc: number }> {
    const mod = await appKitModule();
    const bridge = mod.bridge as ((params: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined;
    if (typeof bridge !== "function") {
      // SDK surface drift guard — fail loud, never silently no-op.
      throw new Error("@circle-fin/app-kit: bridge() not found — verify SDK version (docs.arc.io/app-kit/bridge)");
    }
    const result = (await bridge({
      amount: p.amountUsdc,
      sourceChain: p.fromChain,
      destinationChain: p.toChain,
      token: "USDC",
      sender: this.opts.wallet.address,
    })) as Record<string, unknown>;

    return {
      status: String(result.status ?? "submitted"),
      fromChain: p.fromChain,
      toChain: p.toChain,
      amountUsdc: p.amountUsdc,
    };
  }

  /** Same-chain USDC transfer on Arc (Send capability). */
  async send(p: { to: Address; amountUsdc: number }): Promise<{ status: string }> {
    const mod = await appKitModule();
    const send = mod.send as ((params: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined;
    if (typeof send !== "function") {
      throw new Error("@circle-fin/app-kit: send() not found — verify SDK version");
    }
    const result = (await send({
      amount: p.amountUsdc,
      destinationAddress: p.to,
      token: "USDC",
      sender: this.opts.wallet.address,
    })) as Record<string, unknown>;
    return { status: String(result.status ?? "submitted") };
  }

  /** Swap on Arc — the StableFX leg (USDC ↔ EURC etc.). Server-side capability. */
  async swap(p: SwapParams): Promise<{ status: string; fromToken: Address; toToken: Address; amountUsdc: number }> {
    const mod = await appKitModule();
    const swap = mod.swap as ((params: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined;
    if (typeof swap !== "function") {
      throw new Error("@circle-fin/app-kit: swap() not found — verify SDK version (docs.arc.io/app-kit — Swap is server-side)");
    }
    const result = (await swap({
      fromToken: p.fromToken,
      toToken: p.toToken,
      amount: p.amountUsdc,
      wallet: this.opts.wallet.address,
    })) as Record<string, unknown>;

    return {
      status: String(result.status ?? "submitted"),
      fromToken: p.fromToken,
      toToken: p.toToken,
      amountUsdc: p.amountUsdc,
    };
  }

  /** Gateway unified balance — the book as one number across chains. */
  async unifiedBalance(): Promise<Array<{ chain: string; amountUsdc: number }>> {
    const mod = await appKitModule();
    const unifiedBalance = mod.unifiedBalance as
      | ((params: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>)
      | undefined;
    if (typeof unifiedBalance !== "function") {
      throw new Error("@circle-fin/app-kit: unifiedBalance() not found — verify SDK version");
    }
    const rows = await unifiedBalance({ wallet: this.opts.wallet.address });
    return rows.map((r) => ({
      chain: String(r.chain ?? "unknown"),
      amountUsdc: Number(r.amount ?? 0),
    }));
  }
}
