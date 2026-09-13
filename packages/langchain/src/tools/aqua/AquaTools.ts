import { tool } from "@langchain/core/tools";
import * as z from "zod";
import {
  DEFAULT_FLIGHT_THRESHOLDS,
  assessEnablement,
  buildProgram,
  buildYieldBandFlight,
  decodeAquaLogs,
  decideFlight,
  encodeAquaOrder,
  aquaOrderHash,
  salt,
  strategyHash,
  xycSwap,
  type ChainKey,
  type FlightInput,
} from "@ethonline2026/oneinch-aqua";
import { keccak256, toHex } from "viem";

/**
 * Aqua / SwapVM tools — the agent's view of what the venue would do.
 *
 * ## Why these are pure
 *
 * Every one of them answers a question about a *proposal*: should this position flee, is the venue
 * worth switching on, what exactly would be signed. None needs a node, and making them depend on one
 * would mean the agent could not reason about a strategy on a chain it cannot reach — which is
 * precisely when an operator wants an opinion. Where a fact would need a live read, the tool reports
 * the leg as **not evaluated** rather than assuming a value for it.
 *
 * ## The one thing they will not do
 *
 * They do not decide. `aqua_flight_decision` returns the policy's action and the reasoning behind it,
 * and the agent is free to disagree — the thresholds are in the payload so a disagreement can be with
 * the numbers rather than with the output. The same applies to `aqua_enablement`: whether a venue is
 * worth switching on is a preference about risk, not arithmetic, and the tool says who may decide it.
 */

/** The tool set, keyed by purpose. */
export function createAquaTools() {
  const flightDecisionTool = tool(
    async (input: unknown) => {
      const parsed = input as {
        chain?: string;
        yieldApyBps: number;
        realisedVolBps: number;
        liquidityDepthUsd: number;
        currentWeightBps: number;
        targetWeightBps: number;
        onchainFloorApyBps: number;
        onchainVolCapBps: number;
        targetStable?: string;
        stableApyBps?: number;
      };

      const decision = decideFlight(
        {
          chain: (parsed.chain ?? "optimism") as ChainKey,
          targetStable: (parsed.targetStable ?? "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85") as `0x${string}`,
          yieldApyBps: parsed.yieldApyBps,
          realisedVolBps: parsed.realisedVolBps,
          liquidityDepthUsd: parsed.liquidityDepthUsd,
          currentWeightBps: parsed.currentWeightBps,
          targetWeightBps: parsed.targetWeightBps,
          onchain: { floorApyBps: parsed.onchainFloorApyBps, volCapBps: parsed.onchainVolCapBps },
          vaults: [],
        } as FlightInput,
        // No vault candidates are supplied, because ranking them needs a live read this tool does not
        // do. Passing an empty list would report `protocol_absent_on_chain`, which would be a claim
        // about the chain rather than about this tool's reach.
        { ...(parsed.stableApyBps === undefined ? {} : { stableApyBps: parsed.stableApyBps }) },
      );

      return JSON.stringify({
        action: decision.action,
        reason: decision.reason,
        detail: decision.detail,
        steps: decision.steps,
        vaultLeg: {
          evaluated: false,
          note:
            "No vault destination was evaluated, because ranking one needs a live read of its share " +
            "price. The action above is the risk decision and does not depend on it.",
        },
        thresholds: DEFAULT_FLIGHT_THRESHOLDS,
        note:
          "The action follows from the thresholds in this payload, so a disagreement is with one of " +
          "them or with an input — both are here. It is an opinion, not a permission.",
      });
    },
    {
      name: "aqua_flight_decision",
      description:
        "Whether a yield position should hold, rebalance, or flee into a stablecoin, given its " +
        "realised yield, volatility and the depth available to exit into. Returns the action with its " +
        "reasoning and the thresholds used. Use it before proposing a rebalance; do not present its " +
        "action as a decision the operator made.",
      schema: z.object({
        chain: z.string().optional().describe("Chain slug, e.g. optimism"),
        yieldApyBps: z.number().describe("Realised yield of the current position, in bps"),
        realisedVolBps: z.number().describe("Realised annualised volatility, in bps"),
        liquidityDepthUsd: z.number().describe("Liquidity actually available to exit into, in USD"),
        currentWeightBps: z.number().describe("Current weight of the leg, in bps"),
        targetWeightBps: z.number().describe("Target weight of the leg, in bps"),
        onchainFloorApyBps: z.number().describe("The floor the on-chain guard is armed with, in bps"),
        onchainVolCapBps: z.number().describe("The volatility cap the on-chain guard is armed with, in bps"),
        targetStable: z.string().optional().describe("The stablecoin to flee into"),
        stableApyBps: z.number().optional().describe("The stablecoin's own yield, to derive the floor from"),
      }),
    },
  );

  const enablementTool = tool(
    async (input: unknown) => {
      const parsed = input as {
        chain?: string;
        efficiencyBps: number;
        alreadyEnabled?: boolean;
        agentMayEnable?: boolean;
        minEfficiencyBps?: number;
        agentMinEfficiencyBps?: number;
      };

      const assessment = assessEnablement({
        chain: (parsed.chain ?? "optimism") as ChainKey,
        venueAvailable: true,
        alreadyEnabled: parsed.alreadyEnabled ?? false,
        efficiencyBps: parsed.efficiencyBps,
        minEfficiencyBps: parsed.minEfficiencyBps ?? 20,
        mandate: {
          allowAgentEnablement: parsed.agentMayEnable ?? false,
          minEfficiencyBpsForAgent: parsed.agentMinEfficiencyBps ?? 100,
        },
      });

      return JSON.stringify({
        ...assessment,
        note:
          "An efficiency below the bar is arithmetic and either the user or an agent may act on it; " +
          "below it, the choice is a preference about risk, which is a person's. Surface this rather " +
          "than switching the venue on.",
      });
    },
    {
      name: "aqua_enablement",
      description:
        "Whether the 1inch Aqua/SwapVM venue is worth routing through for a given efficiency gain, and " +
        "who is permitted to switch it on. Use it when a route via Aqua would be cheaper than the " +
        "baseline, so the operator is asked rather than silently re-routed.",
      schema: z.object({
        chain: z.string().optional(),
        efficiencyBps: z.number().describe("How much better than the baseline route, in bps"),
        alreadyEnabled: z.boolean().optional(),
        agentMayEnable: z.boolean().optional().describe("Whether the mandate lets an agent enable it"),
        minEfficiencyBps: z.number().optional().describe("Below this the gain is not worth the change"),
        agentMinEfficiencyBps: z.number().optional(),
      }),
    },
  );

  const orderBytesTool = tool(
    async (input: unknown) => {
      const parsed = input as {
        maker: string;
        tokenA: string;
        tokenB: string;
        maxRateOut: number;
        riskSource?: string;
        salt?: string;
      };

      // A deterministic default salt: the same strategy fields produce the same bytes, which is what
      // makes the output reproducible and checkable. A caller wanting a unique strategy passes one.
      const saltBytes = (parsed.salt ??
        keccak256(toHex(`${parsed.maker}${parsed.tokenA}${parsed.tokenB}${parsed.maxRateOut}`)).slice(0, 18)) as `0x${string}`;

      const program = buildProgram([
        xycSwap(),
        buildYieldBandFlight({
          riskSource: (parsed.riskSource ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
          maxRateOut: BigInt(parsed.maxRateOut),
        }),
        salt(saltBytes),
      ]);

      const order = encodeAquaOrder({
        maker: parsed.maker as `0x${string}`,
        tokenA: parsed.tokenA as `0x${string}`,
        tokenB: parsed.tokenB as `0x${string}`,
        program,
      });

      return JSON.stringify({
        program,
        order: { maker: order.maker, traits: order.traits.toString(), data: order.data },
        strategyHash: strategyHash(toHex(order.data)),
        orderHash: aquaOrderHash(order),
        note:
          "The clamp follows the curve in `program`, which is what makes it bound the output rather " +
          "than the input. This strategy uses opcode 0xb3, so it runs only on the AgenticEMS router — " +
          "the canonical router reverts UnknownOpcode.",
      });
    },
    {
      name: "aqua_order_bytes",
      description:
        "Build the SwapVM program and Aqua order for a stablecoin-flight strategy, returning the exact " +
        "bytes that would be shipped. Use it to show an operator what a strategy will execute before " +
        "it is registered, rather than describing it.",
      schema: z.object({
        maker: z.string().describe("The maker address that will ship the strategy"),
        tokenA: z.string().describe("One of the pair; the two are sorted internally"),
        tokenB: z.string(),
        maxRateOut: z.number().describe("The rate band: most stable out per volatile in, 1e18-scaled"),
        riskSource: z.string().optional().describe("The on-chain risk signal, or zero to apply the band always"),
        salt: z.string().optional().describe("A unique per-strategy salt; derived when omitted"),
      }),
    },
  );

  const decodeReceiptTool = tool(
    async (input: unknown) => {
      const parsed = input as {
        aqua?: string;
        logs?: { address: string; data: string; topics: string[] }[];
      };
      const events = decodeAquaLogs(
        (parsed.logs ?? []).map((log) => ({
          address: log.address,
          data: log.data as `0x${string}`,
          topics: log.topics as `0x${string}`[],
        })),
        parsed.aqua as `0x${string}` | undefined,
      );

      return JSON.stringify({
        events,
        count: events.length,
        note: "Logs that are not Aqua's are skipped, since a receipt mixes every contract the transaction touched.",
      });
    },
    {
      name: "aqua_decode_receipt",
      description:
        "Decode the Aqua events from a transaction receipt, so a fill can be described from what " +
        "actually happened rather than from what was planned.",
      schema: z.object({
        aqua: z.string().optional().describe("The Aqua registry, to filter logs by address"),
        logs: z
          .array(
            z.object({
              address: z.string(),
              data: z.string(),
              topics: z.array(z.string()),
            }),
          )
          .describe("The receipt's logs"),
      }),
    },
  );

  return { flightDecisionTool, enablementTool, orderBytesTool, decodeReceiptTool };
}
