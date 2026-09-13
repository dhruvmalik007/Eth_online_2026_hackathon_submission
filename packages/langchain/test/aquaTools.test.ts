import { describe, expect, it } from "vitest";
import { createAquaTools } from "../src/tools/aqua/AquaTools.js";
import { readProgram } from "@ethonline2026/oneinch-aqua";

const MAKER = "0x2222222222222222222222222222222222222222";
const USDC = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85";
const WETH = "0x4200000000000000000000000000000000000006";

const tools = createAquaTools();

const FLIGHT_INPUT = {
  chain: "optimism",
  yieldApyBps: 100,
  realisedVolBps: 800,
  liquidityDepthUsd: 500_000,
  currentWeightBps: 5_000,
  targetWeightBps: 5_000,
  onchainFloorApyBps: 250,
  onchainVolCapBps: 1_500,
};

describe("aqua_flight_decision", () => {
  it("returns an action with its reasoning and the thresholds behind it", async () => {
    const result = JSON.parse(String(await tools.flightDecisionTool.invoke(FLIGHT_INPUT)));

    expect(result.action).toBe("FLIGHT_TO_STABLE");
    expect(result.reason).toBe("yield_below_floor");
    expect(result.thresholds.yieldFloorBps).toBe(250);
  });

  it("says the action is an opinion rather than a permission", async () => {
    // The tool must not read as though it had authorised anything. The operator authorises.
    const result = JSON.parse(String(await tools.flightDecisionTool.invoke(FLIGHT_INPUT)));

    expect(result.note).toContain("not a permission");
  });

  it("reports the vault leg as unevaluated instead of inventing a destination", async () => {
    // Ranking a vault needs a live read of its share price. An empty candidate list would report
    // `protocol_absent_on_chain`, which is a claim about the chain rather than about this tool's reach.
    const result = JSON.parse(String(await tools.flightDecisionTool.invoke(FLIGHT_INPUT)));

    expect(result.vaultLeg.evaluated).toBe(false);
  });

  it("holds when the on-chain guard disagrees with the thresholds", async () => {
    // The instruction would reject the take, so attempting it would be a wasted revert.
    const result = JSON.parse(
      String(await tools.flightDecisionTool.invoke({ ...FLIGHT_INPUT, onchainFloorApyBps: 300 })),
    );

    expect(result.action).toBe("HOLD");
    expect(result.reason).toBe("signal_desync");
  });
});

describe("aqua_enablement", () => {
  it("recommends when the gain is worth the change", async () => {
    const result = JSON.parse(
      String(await tools.enablementTool.invoke({ chain: "optimism", efficiencyBps: 40, minEfficiencyBps: 20 })),
    );

    expect(result.recommendation).toBe("recommend");
  });

  it("does not treat a trivial gain as worth switching for", async () => {
    const result = JSON.parse(
      String(await tools.enablementTool.invoke({ chain: "optimism", efficiencyBps: 5, minEfficiencyBps: 20 })),
    );

    expect(result.recommendation).toBe("not_worthwhile");
  });

  it("keeps the decision with a person unless the mandate says otherwise", async () => {
    const result = JSON.parse(
      String(await tools.enablementTool.invoke({ chain: "optimism", efficiencyBps: 40 })),
    );

    expect(result.consentGranter).toBe("user");
    expect(result.note).toContain("a person's");
  });

  it("lets an agent act only above the mandate's own bar", async () => {
    const below = JSON.parse(
      String(
        await tools.enablementTool.invoke({
          chain: "optimism",
          efficiencyBps: 40,
          agentMayEnable: true,
          agentMinEfficiencyBps: 100,
        }),
      ),
    );
    const above = JSON.parse(
      String(
        await tools.enablementTool.invoke({
          chain: "optimism",
          efficiencyBps: 150,
          agentMayEnable: true,
          agentMinEfficiencyBps: 100,
        }),
      ),
    );

    expect(below.consentGranter).toBe("user");
    expect(above.consentGranter).toBe("user-or-agent");
  });
});

describe("aqua_order_bytes", () => {
  const input = { maker: MAKER, tokenA: USDC, tokenB: WETH, maxRateOut: 3_400_000_000 };

  it("places the clamp after the curve in the program", async () => {
    // Order is the only structure a program has, so a clamp before the curve would bound the input
    // rather than the output.
    const result = JSON.parse(String(await tools.orderBytesTool.invoke(input)));
    const decoded = readProgram(result.program);

    expect(decoded.map((entry: { label: string }) => entry.label)).toEqual(["XYCSwap", "YieldBandFlight", "Salt"]);
  });

  it("returns the bytes that would actually be shipped", async () => {
    const result = JSON.parse(String(await tools.orderBytesTool.invoke(input)));

    expect(result.program).toMatch(/^0x5000b340/);
    expect(result.order.traits).toMatch(/^\d+$/);
  });

  it("is deterministic, so the same strategy produces the same bytes", async () => {
    const first = JSON.parse(String(await tools.orderBytesTool.invoke(input)));
    const second = JSON.parse(String(await tools.orderBytesTool.invoke(input)));

    expect(first.program).toBe(second.program);
    expect(first.orderHash).toBe(second.orderHash);
  });

  it("warns that the strategy needs our router, not the canonical one", async () => {
    // Shipping opcode 0xb3 to the canonical router reverts, and an operator should learn that here
    // rather than from a failed transaction.
    const result = JSON.parse(String(await tools.orderBytesTool.invoke(input)));

    expect(result.note).toContain("UnknownOpcode");
  });
});

describe("aqua_decode_receipt", () => {
  it("returns nothing for a receipt with no Aqua events rather than guessing", async () => {
    const result = JSON.parse(String(await tools.decodeReceiptTool.invoke({ logs: [] })));

    expect(result.count).toBe(0);
    expect(result.events).toEqual([]);
  });
});
