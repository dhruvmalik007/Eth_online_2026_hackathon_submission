import { describe, it, expect } from "vitest";
import {
  bridgeRouteDecision,
  bridgeRouteTool,
  arcNetPositionTool,
} from "../../src/tools/arc/ArcSettlementTools.js";
import { createAcpTools } from "../../src/tools/erc8183/AcpTools.js";

/**
 * §4.4 routing decision + net-position aggregation.
 * These run without network — the Arc/cctp paths are integration-tested on
 * testnet (Phase E); here we verify the decision table and the deterministic
 * math the agent relies on.
 */
describe("Arc settlement — routing + aggregation", () => {
  it("bridge_route: Arc legs → App Kit Bridge (the ONLY path touching Arc)", () => {
    const d = bridgeRouteDecision({ asset: "USDC", fromChain: "ethereum", toChain: "arc-testnet", latencyNeed: "fast" });
    expect(d.lane).toBe("appkit-bridge");
    expect(d.reason).toMatch(/CCTP V2 Fast/);
  });

  it("bridge_route: cost-sensitive Arc leg picks Standard", () => {
    const d = bridgeRouteDecision({ asset: "USDC", fromChain: "arc-testnet", toChain: "polygon", latencyNeed: "standard" });
    expect(d.lane).toBe("appkit-bridge");
    expect(d.reason).toMatch(/Standard/);
  });

  it("bridge_route: non-USD asset on an Arc leg → StableFX", () => {
    const d = bridgeRouteDecision({ asset: "EURC", fromChain: "arc-testnet", toChain: "ethereum", latencyNeed: "fast" });
    expect(d.lane).toBe("stablefx");
  });

  it("bridge_route: same-asset spoke↔spoke → CCTP direct (no auction)", () => {
    const d = bridgeRouteDecision({ asset: "USDC", fromChain: "ethereum", toChain: "optimism", latencyNeed: "fast" });
    expect(d.lane).toBe("cctp-direct");
  });

  it("bridge_route: spoke conversion → 1inch Fusion with the Fusion+ caveat", () => {
    const d = bridgeRouteDecision({ asset: "WETH", fromChain: "ethereum", toChain: "polygon", latencyNeed: "fast" });
    expect(d.lane).toBe("oneinch-fusion");
    expect(d.note).toMatch(/no Arc/);
  });

  it("arc_net_position: aggregates signed exposure per chain", async () => {
    const res = JSON.parse(
      await arcNetPositionTool.invoke({
        positions: [
          { chain: "ethereum", amountUsdc: 100_000, side: "long" },
          { chain: "arbitrum", amountUsdc: 30_000, side: "short" },
          { chain: "ethereum", amountUsdc: 20_000, side: "long" },
        ],
      }),
    );
    expect(res.netByChain).toContainEqual({ chain: "ethereum", netUsdc: 120_000 });
    expect(res.netByChain).toContainEqual({ chain: "arbitrum", netUsdc: -30_000 });
    expect(res.totalUsdc).toBe(90_000);
  });

  it("bridge_route tool output carries CCTP domains for grounding", async () => {
    const res = JSON.parse(await bridgeRouteTool.invoke({ asset: "USDC", fromChain: "ethereum", toChain: "arc-testnet", latencyNeed: "fast" }));
    expect(res.cctpDomains.ethereum).toBe(0);
  });

  it("ERC-8183 lifecycle tools are registered", () => {
    const names = createAcpTools().map((x) => x.name);
    expect(names).toContain("acp_create_job");
    expect(names).toContain("acp_submit_job");
    expect(names).toContain("acp_complete_job");
    expect(names).toContain("acp_claim_refund");
  });
});
