/**
 * Arc settlement tools — net-position aggregation, CCTP V2 bridging via the
 * Arc App Kit Bridge, StableFX settlement, unified balance, and the §4.4
 * `bridge_route` router. All call `@ethonline2026/arc-client` (low-level).
 */
import { tool } from "@langchain/core/tools";
import * as z from "zod";
import { createArcClient, type ArcClientEnv, CCTP_DOMAINS } from "@ethonline2026/arc-client";

function arcEnv(): ArcClientEnv {
  return process.env as ArcClientEnv;
}

function client() {
  return createArcClient(arcEnv());
}

/**
 * §4.4 router — pure decision logic (no I/O), unit-testable:
 *   Arc leg          → App Kit Bridge (CCTP V2)
 *   same-asset spoke↔spoke → CCTP direct
 *   conversion mid-route on spokes → 1inch Fusion (Fusion+ only if both legs 1inch-enabled)
 *   FX pair          → App Kit Swap → StableFX (Arc)
 */
export function bridgeRouteDecision(input: {
  asset: string;
  fromChain: string;
  toChain: string;
  latencyNeed: "fast" | "standard";
}): {
  lane: "appkit-bridge" | "cctp-direct" | "oneinch-fusion" | "oneinch-fusion-plus" | "stablefx";
  reason: string;
  note: string;
} {
  const isArcLeg = input.fromChain.startsWith("arc") || input.toChain.startsWith("arc");
  // Only USDC rides CCTP/App Kit Bridge — non-USDC stables (incl. EURC) must
  // convert via StableFX on Arc first.
  const sameAsset = input.asset.toUpperCase() === "USDC";

  if (isArcLeg) {
    if (!sameAsset) {
      return {
        lane: "stablefx",
        reason: "Arc leg with a non-USD asset → App Kit Swap routes through StableFX (Arc-native FX).",
        note: "Settle non-USD legs into USD on Arc before/after bridging.",
      };
    }
    return {
      lane: "appkit-bridge",
      reason:
        input.latencyNeed === "fast"
          ? "Arc leg + fast latency → App Kit Bridge (CCTP V2 Fast Transfer, seconds, 0–13 bps)."
          : "Arc leg + cost-sensitive → App Kit Bridge (CCTP V2 Standard, ~13–19 min, near-free).",
      note: "1inch cannot reach Arc; App Kit Bridge is the only sanctioned path.",
    };
  }

  if (sameAsset) {
    return {
      lane: "cctp-direct",
      reason: "Same-asset spoke↔spoke USDC → CCTP direct burn-and-mint (no auction, no slippage).",
      note: "App Kit Bridge also works here when an Arc leg is added later.",
    };
  }

  return {
    lane: "oneinch-fusion",
    reason:
      "Spoke↔spoke with asset conversion → 1inch Fusion (gasless intent, Dutch auction). " +
      "Fusion+ only when both legs have 1inch deployments.",
    note: "1inch chains: ETH, ARB, OPT, Polygon, Base, … (no Arc — see §4.2).",
  };
}

export const bridgeRouteTool = tool(
  async ({ asset, fromChain, toChain, latencyNeed }) => {
    const decision = bridgeRouteDecision({ asset, fromChain, toChain, latencyNeed });
    return JSON.stringify({
      lane: decision.lane,
      reason: decision.reason,
      note: decision.note,
      cctpDomains: { ...CCTP_DOMAINS },
    });
  },
  {
    name: "bridge_route",
    description:
      "§4.4 routing decision (pure logic, no I/O): pick the correct cross-chain lane — App Kit Bridge (Arc legs), CCTP direct (same-asset spokes), 1inch Fusion (spoke conversion), StableFX (FX pairs).",
    schema: z.object({
      asset: z.string().describe("Asset symbol, e.g. USDC, EURC"),
      fromChain: z.string().describe("Source chain label (arc-* or spoke name)"),
      toChain: z.string().describe("Destination chain label"),
      latencyNeed: z.enum(["fast", "standard"]).describe("fast: seconds (App Kit Fast Transfer); standard: minutes, cheaper"),
    }),
  },
);

export const arcNetPositionTool = tool(
  async ({ positions }) => {
    // Aggregate net exposure per chain from the agent-supplied book (values from
    // live subgraph tools). Pure math here — the aggregation itself is deterministic.
    const netByChain = new Map<string, number>();
    for (const p of positions) {
      const signed = p.side === "short" ? -p.amountUsdc : p.amountUsdc;
      netByChain.set(p.chain, (netByChain.get(p.chain) ?? 0) + signed);
    }
    const rows = [...netByChain.entries()].map(([chain, netUsdc]) => ({
      chain,
      netUsdc: +netUsdc.toFixed(2),
    }));
    const totalUsdc = +rows.reduce((s, r) => s + r.netUsdc, 0).toFixed(2);
    const largest = rows.reduce((m, r) => (Math.abs(r.netUsdc) > Math.abs(m.netUsdc) ? r : m), rows[0] ?? { chain: "none", netUsdc: 0 });
    return JSON.stringify({
      netByChain: rows,
      totalUsdc,
      settlementSuggestion:
        rows.length > 0
          ? `Bridge net ${largest.netUsdc >= 0 ? "surplus" : "deficit"} on ${largest.chain} via ${bridgeRouteDecision({ asset: "USDC", fromChain: largest.chain, toChain: "arc-testnet", latencyNeed: "fast" }).lane}`
          : "no positions",
    });
  },
  {
    name: "arc_net_position",
    description: "Aggregate the book's net USD exposure per chain and suggest which chain's net flow settles to Arc first.",
    schema: z.object({
      positions: z
        .array(
          z.object({
            chain: z.string(),
            amountUsdc: z.number(),
            side: z.enum(["long", "short"]),
          }),
        )
        .describe("Current USD-denominated positions (amounts signed by direction)"),
    }),
  },
);

export const arcBridgeNetFlowTool = tool(
  async ({ amountUsdc, fromChain, toChain, latencyNeed, mintRecipient }) => {
    try {
      const sourceIsArc = fromChain.startsWith("arc");
      const sourceDecimals = sourceIsArc ? 18 : 6; // Arc USDC = 18dp; spokes = 6dp
      const arc = client().cctp({
        sourceRpcUrl: process.env[`${fromChain.toUpperCase()}_RPC_URL`] ?? "",
        sourceUsdc: (process.env[`${fromChain.toUpperCase()}_USDC`] ?? "") as `0x${string}`,
        sourceTokenMessengerV2: (process.env[`${fromChain.toUpperCase()}_TOKEN_MESSENGER_V2`] ?? "") as `0x${string}`,
        sourceUsdcDecimals: sourceDecimals,
        sourceIsArc,
      });
      const burn = await arc.depositForBurn({
        amountUsdc,
        destinationDomain: toChain.startsWith("arc") ? arcCctpDomain() : spokeDomain(toChain),
        mintRecipient: mintRecipient as `0x${string}`,
        speed: latencyNeed === "fast" ? "fast" : "standard",
      });
      const attested = await arc.waitForAttestation(burn.messageHash);
      const destRpc = toChain.startsWith("arc") ? arcRpc() : (process.env[`${toChain.toUpperCase()}_RPC_URL`] ?? "");
      const destMessageV2 = toChain.startsWith("arc") ? arcMessageV2() : (process.env[`${toChain.toUpperCase()}_MESSAGE_V2`] ?? "");
      const mintTx = await arc.receiveMessage(destRpc, destMessageV2 as `0x${string}`, attested);
      return JSON.stringify({
        burnTx: burn.txHash,
        mintTx,
        amountUsdc,
        fromChain,
        toChain,
        speed: latencyNeed,
        note: "Native USDC minted on destination (CCTP V2 burn-and-mint — no wrapped asset).",
      });
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  },
  {
    name: "arc_bridge_netflow",
    description:
      "Execute a net settlement flow: CCTP V2 burn on the source chain → Iris attestation → mint native USDC on the destination. Fast (seconds, ~0–13bps) or Standard (~15min).",
    schema: z.object({
      amountUsdc: z.number().positive().describe("Net flow amount in USDC"),
      fromChain: z.string().describe("Source chain (spoke)"),
      toChain: z.string().describe("Destination chain (usually arc-*)"),
      latencyNeed: z.enum(["fast", "standard"]).describe("CCTP V2 speed"),
      mintRecipient: z.string().describe("Recipient address on the destination (0x…)"),
    }),
  },
);

export const arcSettleFxTool = tool(
  async ({ pair, amountInUsdc, fromToken, toToken }) => {
    try {
      const arc = client();
      const result = await arc.stablefx.settle(
        pair,
        amountInUsdc,
        fromToken as `0x${string}`,
        toToken as `0x${string}`,
      );
      return JSON.stringify({
        settled: true,
        pair,
        amountInUsdc: result.amountUsdc,
        venue: "StableFX (Arc native)",
        note: "24/7 on-chain FX — no prefunded venues, no T+1. Production settle requires KYB.",
      });
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  },
  {
    name: "arc_settle_fx",
    description:
      "Settle a non-USD exposure into USD (or vice versa) via StableFX on Arc — e.g. USDC/EURC. Amounts in USDC-normalized terms.",
    schema: z.object({
      pair: z.string().describe("FX pair, e.g. USDC/EURC, USDC/BRLA"),
      amountInUsdc: z.number().positive().describe("USD-side amount"),
      fromToken: z.string().describe("Source token address on Arc (0x…)"),
      toToken: z.string().describe("Destination token address on Arc (0x…)"),
    }),
  },
);

export const arcBalanceTool = tool(
  async () => {
    try {
      const arc = client();
      const rows = await arc.appKit.unifiedBalance();
      const total = +rows.reduce((s: number, r: { amountUsdc: number }) => s + r.amountUsdc, 0).toFixed(2);
      return JSON.stringify({ unifiedBalance: rows, totalUsdc: total, note: "Gateway — one balance across chains." });
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  },
  {
    name: "arc_balance",
    description: "Unified USDC balance across chains via Arc Gateway — the book as one number.",
    schema: z.object({}),
  },
);

function arcCctpDomain(): number {
  const network = process.env.ARC_NETWORK ?? "arc-testnet";
  const key = network === "arc-mainnet" ? "ARC_MAINNET_CCTP_DOMAIN" : "ARC_TESTNET_CCTP_DOMAIN";
  return Number(process.env[key] ?? 0);
}

function arcRpc(): string {
  const network = process.env.ARC_NETWORK ?? "arc-testnet";
  const key = network === "arc-mainnet" ? "ARC_MAINNET_RPC_URL" : "ARC_TESTNET_RPC_URL";
  return process.env[key] ?? "";
}

function arcMessageV2(): string {
  const network = process.env.ARC_NETWORK ?? "arc-testnet";
  const key = network === "arc-mainnet" ? "ARC_MAINNET_MESSAGE_V2" : "ARC_TESTNET_MESSAGE_V2";
  return process.env[key] ?? "";
}

function spokeDomain(chain: string): number {
  const domains: Record<string, number> = { ethereum: 0, optimism: 2, arbitrum: 3, base: 6, polygon: 7 };
  const d = domains[chain.toLowerCase()];
  if (d === undefined) throw new Error(`unknown CCTP domain for chain: ${chain}`);
  return d;
}

/** The Arc settlement tool group. */
export function createArcSettlementTools() {
  return [bridgeRouteTool, arcNetPositionTool, arcBridgeNetFlowTool, arcSettleFxTool, arcBalanceTool];
}
