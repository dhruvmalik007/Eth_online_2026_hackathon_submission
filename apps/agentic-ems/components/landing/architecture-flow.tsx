"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

/**
 * The full pipeline, one glance:
 * The Graph (standardized subgraphs, live) → data layer (this repo) →
 * agent layer (LangGraph/deepagents + math function table) → risk engine →
 * execution (1inch Aqua / Uniswap v4).
 */

type LayerStyle = {
  border: string;
  bg: string;
  accent: string;
  tag: string;
};

const LAYERS: Record<string, LayerStyle> = {
  graph: { border: "#6747EE", bg: "#14101f", accent: "#A292F5", tag: "THE GRAPH — LIVE" },
  data: { border: "#2A2E35", bg: "#101214", accent: "#9BA1AB", tag: "DATA LAYER — THIS REPO" },
  agent: { border: "#B37F00", bg: "#171208", accent: "#FFB300", tag: "AGENT LAYER" },
  risk: { border: "#16C784", bg: "#0C1712", accent: "#16C784", tag: "RISK ENGINE" },
  exec: { border: "#12AAB5", bg: "#0B1618", accent: "#12AAB5", tag: "EXECUTION" },
};

function node(
  id: string,
  x: number,
  y: number,
  layer: keyof typeof LAYERS,
  title: string,
  lines: string[],
  w = 230,
): Node {
  const s = LAYERS[layer];
  return {
    id,
    position: { x, y },
    style: { width: w, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 0 },
    data: {
      label: (
        <div className="text-left">
          <p className="font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: s.accent }}>
            {s.tag}
          </p>
          <p className="mt-1 font-mono text-[12px] font-semibold leading-tight text-[#e8eaed]">
            {title}
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {lines.map((l) => (
              <li key={l} className="font-mono text-[10px] leading-snug text-[#9ba1ab]">
                {l}
              </li>
            ))}
          </ul>
        </div>
      ),
    },
  };
}

const NODES: Node[] = [
  // The Graph layer
  node("g-lending", 0, 0, "graph", "Messari lending ×3 chains", [
    "aave-v3 eth · arb · opt",
    "one schema, one query",
    "reserves · rates · TVL",
  ]),
  node("g-v4", 0, 130, "graph", "Uniswap v4 PoolManager", [
    "pool registry · hook params",
    "hooks are first-class",
    "hour/day series",
  ]),
  node("g-poly", 0, 260, "graph", "Polymarket activity", [
    "conditions · markets",
    "redemption payouts",
  ]),

  // Data layer
  node("d-registry", 300, 60, "data", "ProtocolRegistry", [
    "protocol × network → source",
    "category filters",
    "health-gated fallback",
  ], 250),
  node("d-client", 300, 220, "data", "SubgraphClient", [
    "_meta gate · id_gt cursors",
    "_change_block deltas",
    "time-boxed transport",
  ], 250),

  // Agent layer
  node("a-agent", 610, 0, "agent", "DeepGraphAgent", [
    "deepagents harness · LangGraph",
    "40+ typed tools",
    "Subgraph MCP discovery",
  ], 250),
  node("a-math", 610, 150, "agent", "Math function table", [
    "calc_vega · calc_lvr",
    "calc_net_apy · calc_allocation",
    "golden-tested, no LLM math",
  ], 250),

  // Risk
  node("r-engine", 920, 70, "risk", "Fixed-income risk engine", [
    "LVR = L²σ²/8",
    "vega = k − L²σ/4",
    "VaR95/99 · stress ×1.5 ×2",
  ], 250),

  // Execution
  node("e-oneinch", 1230, 0, "exec", "1inch Aqua · SwapVM", [
    "strategies as data",
    "self-custodial shared liquidity",
    "agent-set allocations",
  ], 250),
  node("e-v4", 1230, 150, "exec", "Uniswap v4 dual-hook LP", [
    "idle capital → Aave leg",
    "dynamic fee hooks",
    "σ-triggered de-levering",
  ], 250),
];

const EDGES: Edge[] = [
  { id: "e1", source: "g-lending", target: "d-registry", label: "standardized GraphQL", animated: true },
  { id: "e2", source: "g-v4", target: "d-registry", label: "pools · hooks", animated: true },
  { id: "e3", source: "g-poly", target: "d-client", label: "odds · payouts" },
  { id: "e4", source: "d-registry", target: "a-agent", label: "tool calls", animated: true },
  { id: "e5", source: "d-client", target: "a-agent", label: "verified rows" },
  { id: "e6", source: "a-agent", target: "a-math", label: "arguments only", animated: true },
  { id: "e7", source: "a-math", target: "r-engine", label: "vega · η · var" },
  { id: "e8", source: "r-engine", target: "e-oneinch", label: "allocations", animated: true },
  { id: "e9", source: "r-engine", target: "e-v4", label: "L mandate per σ" },
];

export function ArchitectureFlow() {
  return (
    <div className="h-[540px] w-full border border-edge bg-ink">
      <ReactFlow
        nodes={NODES}
        edges={EDGES}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.4}
        maxZoom={1.4}
        nodesConnectable={false}
        edgesFocusable={false}
        nodesFocusable={false}
        defaultEdgeOptions={{
          type: "smoothstep",
          style: { stroke: "#3a4048", strokeWidth: 1.5 },
          labelStyle: { fill: "#9ba1ab", fontFamily: "var(--font-jetbrains)", fontSize: 10 },
          labelBgStyle: { fill: "#0a0b0d" },
          labelBgPadding: [4, 2],
          markerEnd: { type: MarkerType.ArrowClosed, color: "#5f6670", width: 14, height: 14 },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="#23262c" />
        <Controls
          showInteractive={false}
          className="!border !border-edge !bg-panel [&_button]:!bg-panel [&_button]:!border-edge [&_button_svg]:!fill-fg-dim"
        />
      </ReactFlow>
    </div>
  );
}
