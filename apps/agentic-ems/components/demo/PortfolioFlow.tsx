"use client";

import * as React from "react";
import { LiquidityFlowRoadmap } from "@ethonline2026/ux-workflow";
import type {
  LiquidityFlowAccent,
  LiquidityFlowEdge,
  LiquidityFlowLegendItem,
  LiquidityFlowNode,
} from "@ethonline2026/ux-workflow";
import { allocationsFor, TOTAL_BALANCE } from "@/lib/demo/data";
import type { RiskProfile } from "@/lib/demo/data";

/**
 * PortfolioFlow — renders every position in a user's portfolio as a
 * liquidity-flow (Sankey) diagram: NAV → the strategy legs it is deployed into.
 *
 * Every figure comes from `allocationsFor(risk)` in lib/demo/data.ts; nothing
 * is invented here. The five strategy colors are already Terminal Noir accent
 * tokens, so the dashboard's existing color coding carries over unchanged.
 */

const ACCENT_BY_HEX: Record<string, LiquidityFlowAccent> = {
  "#16c784": "up",
  "#6747ee": "graph",
  "#ffb300": "amber",
  "#12aab5": "oneinch",
  "#ff007a": "uniswap",
};

const RISK_LABEL: Record<RiskProfile, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  yieldmax: "Yield-max",
};

export interface PortfolioFlowProps {
  risk?: RiskProfile;
  /** Height of the flow canvas in px. */
  height?: number;
  /** Node id to keep highlighted (e.g. the strategy selected elsewhere). */
  activeNodeId?: string;
  onNodeSelect?: (id: string) => void;
  className?: string;
}

export function PortfolioFlow({
  risk = "balanced",
  height = 320,
  activeNodeId,
  onNodeSelect,
  className,
}: PortfolioFlowProps) {
  const { nodes, edges, legend, strategyIds } = React.useMemo(() => {
    const alloc = allocationsFor(risk);

    const flowNodes: LiquidityFlowNode[] = [
      {
        id: "nav",
        label: "Portfolio NAV",
        value: TOTAL_BALANCE,
        accent: "faint",
        badge: "nav",
        column: 0,
        subLabel: RISK_LABEL[risk],
        description: `Total deployed across ${alloc.length} agent-managed strategies. Risk profile: ${RISK_LABEL[risk]}.`,
        metrics: [
          { label: "Positions", value: String(alloc.length) },
          { label: "Agents", value: "5 active" },
        ],
      },
      ...alloc.map(({ strategy, pct, usd }) => ({
        id: strategy.id,
        label: strategy.label,
        value: usd,
        accent: ACCENT_BY_HEX[strategy.color] ?? "faint",
        badge: "position",
        pct,
        subLabel: strategy.agentName,
        description: strategy.description,
        metrics: [
          { label: "APY (est)", value: `${strategy.apy.toFixed(2)}%` },
          { label: "VaR95 (1d)", value: strategy.var95 },
          { label: "Risk", value: strategy.riskLabel },
          { label: "Protocols", value: strategy.protocols.join(" · ") },
        ],
      })),
    ];

    const flowEdges: LiquidityFlowEdge[] = alloc.map(({ strategy, usd }) => ({
      from: "nav",
      to: strategy.id,
      value: usd,
      accent: ACCENT_BY_HEX[strategy.color] ?? "faint",
      label: `Portfolio NAV → ${strategy.label}`,
    }));

    const flowLegend: LiquidityFlowLegendItem[] = alloc.map(({ strategy }) => ({
      label: strategy.label,
      accent: ACCENT_BY_HEX[strategy.color] ?? "faint",
    }));

    return {
      nodes: flowNodes,
      edges: flowEdges,
      legend: flowLegend,
      strategyIds: new Set(alloc.map(({ strategy }) => strategy.id)),
    };
  }, [risk]);

  // The NAV root is not a position: only forward real strategy ids so consumers
  // selecting on a node can safely assume the id exists in their strategy list.
  const handleSelect = React.useCallback(
    (id: string) => {
      if (strategyIds.has(id)) onNodeSelect?.(id);
    },
    [strategyIds, onNodeSelect],
  );

  return (
    <LiquidityFlowRoadmap
      className={className}
      title="Portfolio flow · NAV → strategies"
      period={RISK_LABEL[risk]}
      height={height}
      columnWidth={220}
      nodes={nodes}
      edges={edges}
      legend={legend}
      hint="hover a position for APY, VaR and the owning agent"
      activeNodeId={activeNodeId}
      onNodeSelect={handleSelect}
    />
  );
}
