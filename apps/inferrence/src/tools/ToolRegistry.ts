/**
 * Tool registry + execution-placement policy.
 *
 * `packages/langchain` ships the tool factories; this module answers a different
 * question: for each tool group, does it run in the control plane (typed, pure,
 * in-process) or inside the sandbox (networked, parsing, untrusted)?
 *
 * The policy is data, not prose, so it is testable and so the sandbox surface
 * stays the minimum needed — a wider sandbox is a wider blast radius. Adapters
 * that construct the tools are ROADMAP T6.1.
 */
import type { AgentMode } from "../events/contract.js";

export const TOOL_PLACEMENTS = ["in-process", "sandbox"] as const;
export type ToolPlacement = (typeof TOOL_PLACEMENTS)[number];

export interface ToolGroupDescriptor {
  readonly id: string;
  /** The `packages/langchain` factory that provides it. */
  readonly factory: string;
  readonly placement: ToolPlacement;
  readonly modes: readonly AgentMode[];
  readonly note: string;
}

export const TOOL_GROUPS: readonly ToolGroupDescriptor[] = [
  {
    id: "math",
    factory: "createMathTools",
    placement: "in-process",
    modes: ["v01", "deep"],
    note: "Pure arithmetic; every number in a report must come from here.",
  },
  {
    id: "fixed-income",
    factory: "createFixedIncomeTools",
    placement: "in-process",
    modes: ["v01", "deep"],
    note: "Deterministic bond maths (duration, convexity, DV01).",
  },
  {
    id: "risk",
    factory: "createRiskTools",
    placement: "in-process",
    modes: ["v01", "deep"],
    note: "Reads validated snapshots through RiskProfileReader.",
  },
  {
    id: "timeseries",
    factory: "createTimeseriesTools",
    placement: "in-process",
    modes: ["v01", "deep"],
    note: "SQL over TimescaleDB; typed repository calls, never ad-hoc SQL.",
  },
  {
    id: "timesfm3",
    factory: "createTimesFM3Tools",
    placement: "in-process",
    modes: ["v01"],
    note: "Calls the self-hosted TimesFM-3 service; serialised + cached (T5.2).",
  },
  {
    id: "uniswap-v4",
    factory: "createUniswapV4Tools",
    placement: "in-process",
    modes: ["v01", "deep"],
    note: "Subgraph reads through the Graph client.",
  },
  {
    id: "lending",
    factory: "createLendingTools",
    placement: "in-process",
    modes: ["v01", "deep"],
    note: "Aave/Morpho subgraph reads.",
  },
  {
    id: "dex",
    factory: "createDexTools",
    placement: "in-process",
    modes: ["v01", "deep"],
    note: "DEX subgraph reads.",
  },
  {
    id: "prediction",
    factory: "createPredictionTools",
    placement: "in-process",
    modes: ["deep"],
    note: "Polymarket reads.",
  },
  {
    id: "arc-settlement",
    factory: "createArcSettlementTools",
    placement: "in-process",
    modes: ["v01", "deep"],
    note: "Arc CCTP/StableFX settlement intents — produces intents, never signs.",
  },
  {
    id: "aqua",
    factory: "createAquaTools",
    placement: "in-process",
    modes: ["v01", "deep"],
    note: "Aqua/SwapVM flight policy, enablement and order encoding — pure, so it needs no deps.",
  },
  {
    id: "acp",
    factory: "createAcpTools",
    placement: "in-process",
    modes: ["deep"],
    note: "ERC-8183 agentic-commerce job intents.",
  },
  {
    id: "untrusted-code",
    factory: "(sandbox worker)",
    placement: "sandbox",
    modes: ["v01", "deep"],
    note: "Anything executing generated code or parsing an untrusted document.",
  },
];

export function toolsForMode(mode: AgentMode): ToolGroupDescriptor[] {
  return TOOL_GROUPS.filter((group) => group.modes.includes(mode));
}

export function sandboxTools(): ToolGroupDescriptor[] {
  return TOOL_GROUPS.filter((group) => group.placement === "sandbox");
}
