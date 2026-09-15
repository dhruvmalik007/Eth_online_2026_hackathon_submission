"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import { Badge } from "../primitives/badge.js";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "../primitives/card.js";
import {
  ACCENT_BADGE,
  FlowDiagram,
  formatValue,
  type FlowAccent,
  type FlowEdge,
  type FlowLegendItem,
  type FlowMetric,
  type FlowNode,
  type FlowTone,
} from "../data/flow-diagram.js";

/**
 * LiquidityFlowRoadmap — an income-flow / P&L waterfall for the trading desk.
 *
 * Models the DeFiLlama-style Sankey in `example-ui-workflow-roadmap-widget.mov`:
 * a left-to-right decomposition of revenue into profit and cost lines, where
 * every node AND every flow segment is hoverable and reveals a detail card.
 *
 * Terminal Noir translation of the source: angular (not curved) ribbons drawn
 * with CSS clip-path, sharp corners, mono-first type, and amber/green/red used
 * semantically (revenue / profit / cost). Hovering a node or a ribbon isolates
 * that path and dims everything not connected to it.
 *
 * The picture itself now lives in `FlowDiagram`, which was already generic — column assignment,
 * ribbon geometry, hover isolation and the marching-dash active flow have nothing to do with income.
 * What stays here is what is specific to the desk: the Card, the title and period, the currency, the
 * legend, and the total being decomposed. A consumer whose nodes are not money uses the engine
 * directly rather than inheriting semantics it does not have.
 *
 * Design: packages/ux-workflow/docs/liquidity-flow-roadmap-widget.md
 */

/** Accent tokens, re-exported under the names the desk surfaces already import. */
export type LiquidityFlowAccent = FlowAccent;
export type LiquidityFlowTone = FlowTone;
export type LiquidityFlowMetric = FlowMetric;
export type LiquidityFlowLegendItem = FlowLegendItem;
export type LiquidityFlowNode = FlowNode;
export type LiquidityFlowEdge = FlowEdge;

const DEFAULT_LEGEND: FlowLegendItem[] = [
  { label: "revenue", accent: "amber" },
  { label: "profit", accent: "up" },
  { label: "cost", accent: "down" },
];

export interface LiquidityFlowRoadmapProps
  extends React.ComponentProps<typeof Card> {
  /** Card title. Default: "Income flow". */
  title?: string;
  /** Reporting period shown next to the title (e.g. "Q2 2026"). */
  period?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Currency/unit label. Default: "USD". */
  unit?: string;
  /** Chart height in px. Default: 300. */
  height?: number;
  /** Horizontal space per column in px. Default: 200. */
  columnWidth?: number;
  /** Persistently highlighted node (in addition to hover). */
  activeNodeId?: string;
  /** Legend chips. Defaults to revenue/profit/cost; pass [] to hide. */
  legend?: FlowLegendItem[];
  /** Helper text under the legend. */
  hint?: string;
  /** Enables the staggered entrance and marching-dash flow. Default: true. */
  animate?: boolean;
  onNodeSelect?: (id: string) => void;
}

export function LiquidityFlowRoadmap({
  className,
  title = "Income flow",
  period,
  nodes,
  edges,
  unit = "USD",
  height = 300,
  columnWidth = 200,
  activeNodeId,
  legend = DEFAULT_LEGEND,
  hint = "hover a stage or a flow for its breakdown",
  animate = true,
  onNodeSelect,
  ...props
}: LiquidityFlowRoadmapProps) {
  // The one figure the engine cannot know: the total being decomposed, which is the sum of the roots.
  const total = React.useMemo(() => {
    const hasIncoming = new Set(edges.map((edge) => edge.to));
    return nodes
      .filter((node) => !hasIncoming.has(node.id))
      .reduce((sum, node) => sum + Math.max(node.value, 0), 0);
  }, [nodes, edges]);

  const currency = React.useCallback(
    (value: number) => formatValue(value, unit),
    [unit],
  );

  return (
    <Card className={cn("", className)} {...props}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
          {period ? <span className="mr-3 text-fg-faint">{period}</span> : null}
          <span className="tabular-nums text-fg">{formatValue(total, unit)}</span>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3">
        <FlowDiagram
          nodes={nodes}
          edges={edges}
          height={height}
          columnWidth={columnWidth}
          animate={animate}
          formatValue={currency}
          ariaLabel={title}
          {...(activeNodeId === undefined ? {} : { activeNodeId })}
          {...(onNodeSelect === undefined ? {} : { onNodeSelect })}
        />

        <div className="flex flex-wrap items-center gap-2">
          {legend.map((item) => (
            <Badge key={item.label} variant={ACCENT_BADGE[item.accent]}>
              {item.label}
            </Badge>
          ))}
          <span className="ml-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-faint">
            {hint}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
