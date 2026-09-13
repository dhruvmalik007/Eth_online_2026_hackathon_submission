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
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../primitives/hover-card.js";
import { ScrollArea, ScrollBar } from "../primitives/scroll-area.js";

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
 * Design: packages/ux-workflow/docs/liquidity-flow-roadmap-widget.md
 */

export type LiquidityFlowTone = "revenue" | "profit" | "cost";

/**
 * Terminal Noir accent tokens. Two ways to color a node:
 * `tone` carries meaning (revenue/profit/cost → amber/green/red); `accent`
 * overrides the visual so callers with their own categorical palette
 * (e.g. the five portfolio strategies) keep their color coding.
 */
export type LiquidityFlowAccent =
  | "amber"
  | "up"
  | "down"
  | "graph"
  | "oneinch"
  | "uniswap"
  | "faint";

export interface LiquidityFlowMetric {
  label: string;
  value: string;
}

export interface LiquidityFlowLegendItem {
  label: string;
  accent: LiquidityFlowAccent;
}

const DEFAULT_LEGEND: LiquidityFlowLegendItem[] = [
  { label: "revenue", accent: "amber" },
  { label: "profit", accent: "up" },
  { label: "cost", accent: "down" },
];

export interface LiquidityFlowNode {
  id: string;
  label: string;
  /** Numeric magnitude in `unit` terms; drives the node's height. */
  value: number;
  /** Semantic meaning. Drives the default color; omit when using `accent`. */
  tone?: LiquidityFlowTone;
  /** Explicit token color, overriding the tone-derived one. */
  accent?: LiquidityFlowAccent;
  /** Hover-card badge text. Defaults to the tone name. */
  badge?: string;
  /** Share of parent/total, 0-100. Shown in the hover card when present. */
  pct?: number;
  /** Explicit column (pipeline stage). Inferred from edges when omitted. */
  column?: number;
  /** Short caption under the label (e.g. "Q2 2026"). */
  subLabel?: string;
  /** Contextual sentence shown in the hover card. */
  description?: string;
  /** Extra rows rendered in the hover card (e.g. APY, VaR). */
  metrics?: LiquidityFlowMetric[];
}

export interface LiquidityFlowEdge {
  from: string;
  to: string;
  /** Flow magnitude; drives the ribbon thickness. */
  value: number;
  /** Ribbon tone. Defaults to the destination node's tone. */
  tone?: LiquidityFlowTone;
  /** Ribbon color override. Defaults to the destination node's accent. */
  accent?: LiquidityFlowAccent;
  /** Hover title. Defaults to "From → To". */
  label?: string;
  /** Contextual sentence shown in the hover card. */
  description?: string;
}

export interface LiquidityFlowRoadmapProps
  extends React.ComponentProps<typeof Card> {
  /** Card title. Default: "Income flow". */
  title?: string;
  /** Reporting period shown next to the title (e.g. "Q2 2026"). */
  period?: string;
  nodes: LiquidityFlowNode[];
  edges: LiquidityFlowEdge[];
  /** Currency/unit label. Default: "USD". */
  unit?: string;
  /** Chart height in px. Default: 300. */
  height?: number;
  /** Horizontal space per column in px. Default: 200. */
  columnWidth?: number;
  /** Persistently highlighted node (in addition to hover). */
  activeNodeId?: string;
  /** Legend chips. Defaults to revenue/profit/cost; pass [] to hide. */
  legend?: LiquidityFlowLegendItem[];
  /** Helper text under the legend. */
  hint?: string;
  /** Enables the staggered entrance and marching-dash flow. Default: true. */
  animate?: boolean;
  onNodeSelect?: (id: string) => void;
}

const ACCENT_BG: Record<LiquidityFlowAccent, string> = {
  amber: "bg-amber",
  up: "bg-up",
  down: "bg-down",
  graph: "bg-graph",
  oneinch: "bg-oneinch",
  uniswap: "bg-uniswap",
  faint: "bg-fg-faint",
};

const ACCENT_TEXT: Record<LiquidityFlowAccent, string> = {
  amber: "text-amber",
  up: "text-up",
  down: "text-down",
  graph: "text-graph-soft",
  oneinch: "text-oneinch",
  uniswap: "text-uniswap",
  faint: "text-fg-faint",
};

type BadgeVariant =
  | "default"
  | "amber"
  | "up"
  | "down"
  | "graph"
  | "oneinch"
  | "uniswap";

const ACCENT_BADGE: Record<LiquidityFlowAccent, BadgeVariant> = {
  amber: "amber",
  up: "up",
  down: "down",
  graph: "graph",
  oneinch: "oneinch",
  uniswap: "uniswap",
  faint: "default",
};

const TONE_ACCENT: Record<LiquidityFlowTone, LiquidityFlowAccent> = {
  revenue: "amber",
  profit: "up",
  cost: "down",
};

function accentOf(node: LiquidityFlowNode): LiquidityFlowAccent {
  return node.accent ?? TONE_ACCENT[node.tone ?? "revenue"];
}

const NODE_W = 148;
const NODE_GAP = 14;
const PAD_TOP = 10;
const PAD_RIGHT = 168;
const LABEL_MIN_H = 44;

function formatValue(value: number, unit = "USD"): string {
  const symbol = unit === "USD" ? "$" : "";
  const suffix = unit === "USD" ? "" : ` ${unit}`;
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${symbol}${(value / 1e12).toFixed(2)}T${suffix}`;
  if (abs >= 1e9) return `${symbol}${(value / 1e9).toFixed(2)}B${suffix}`;
  if (abs >= 1e6) return `${symbol}${(value / 1e6).toFixed(2)}M${suffix}`;
  if (abs >= 1e3) return `${symbol}${(value / 1e3).toFixed(2)}K${suffix}`;
  // Sub-dollar amounts (gas, bridge and messaging fees) need more precision than
  // cents, or a $0.1156 fee renders as a misleading "$0.12".
  if (abs > 0 && abs < 1) return `${symbol}${value.toFixed(4)}${suffix}`;
  return `${symbol}${value.toFixed(2)}${suffix}`;
}

/** Longest-path column assignment from the graph's roots. */
function assignColumns(
  nodes: LiquidityFlowNode[],
  edges: LiquidityFlowEdge[],
): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const node of nodes) incoming.set(node.id, []);
  for (const edge of edges) incoming.get(edge.to)?.push(edge.from);

  const columns = new Map<string, number>();
  for (const node of nodes) {
    if (node.column !== undefined) columns.set(node.id, node.column);
  }

  const resolve = (id: string, seen: Set<string>): number => {
    const known = columns.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = incoming.get(id) ?? [];
    const column = parents.length
      ? Math.max(...parents.map((parent) => resolve(parent, seen) + 1))
      : 0;
    columns.set(id, column);
    return column;
  };

  for (const node of nodes) resolve(node.id, new Set());
  return columns;
}

type Slice = { top: number; bottom: number };

interface LaidNode {
  node: LiquidityFlowNode;
  column: number;
  x: number;
  y: number;
  h: number;
  inline: boolean;
  outSlices: Map<number, Slice>;
  inSlices: Map<number, Slice>;
}

interface LaidEdge {
  edge: LiquidityFlowEdge;
  index: number;
  accent: LiquidityFlowAccent;
  left: number;
  top: number;
  width: number;
  height: number;
  clipPath: string;
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
  const [hovered, setHovered] = React.useState<string | null>(null);

  const layout = React.useMemo(() => {
    const columns = assignColumns(nodes, edges);
    const byColumn = new Map<number, LiquidityFlowNode[]>();
    for (const node of nodes) {
      const column = columns.get(node.id) ?? 0;
      const bucket = byColumn.get(column);
      if (bucket) bucket.push(node);
      else byColumn.set(column, [node]);
    }

    const columnSums = [...byColumn.values()].map((bucket) =>
      bucket.reduce((sum, node) => sum + Math.max(node.value, 0), 0),
    );
    const columnGaps = [...byColumn.values()].map(
      (bucket) => Math.max(bucket.length - 1, 0) * NODE_GAP,
    );
    const maxSum = Math.max(...columnSums, 1);
    const maxGaps = Math.max(...columnGaps, 0);
    const available = Math.max(height - PAD_TOP * 2 - maxGaps, 1);
    const scale = available / maxSum;

    const laid = new Map<string, LaidNode>();
    const maxColumn = Math.max(0, ...byColumn.keys());

    for (const [column, bucket] of [...byColumn.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      const heights = bucket.map((node) =>
        Math.max(node.value * scale, 2),
      );
      // Labels sit inside the bar only when every bar in the column is tall
      // enough; mixing inline and outside labels within a column reads as noise.
      const columnInline = heights.every((barHeight) => barHeight >= LABEL_MIN_H);
      const contentH =
        heights.reduce((sum, h) => sum + h, 0) +
        Math.max(bucket.length - 1, 0) * NODE_GAP;
      let cursorY = PAD_TOP + Math.max((height - PAD_TOP * 2 - contentH) / 2, 0);
      const x = column * columnWidth + (columnWidth - NODE_W) / 2;

      bucket.forEach((node, index) => {
        laid.set(node.id, {
          node,
          column,
          x,
          y: cursorY,
          h: heights[index],
          inline: columnInline,
          outSlices: new Map(),
          inSlices: new Map(),
        });
        cursorY += heights[index] + NODE_GAP;
      });
    }

    // Allocate each node's vertical extent to its in/out edges proportionally.
    const allocate = (
      nodeId: string,
      picks: (edge: LiquidityFlowEdge) => boolean,
      key: (index: number) => number,
      field: "outSlices" | "inSlices",
    ) => {
      const source = laid.get(nodeId);
      if (!source) return;
      const selected = edges
        .map((edge, index) => ({ edge, index }))
        .filter(({ edge }) => picks(edge));
      const total = selected.reduce((sum, { edge }) => sum + Math.max(edge.value, 0), 0);
      if (total <= 0) return;
      let cursor = source.y;
      for (const { edge, index } of selected) {
        const sliceH = (Math.max(edge.value, 0) / total) * source.h;
        source[field].set(key(index), { top: cursor, bottom: cursor + sliceH });
        cursor += sliceH;
      }
    };

    for (const node of nodes) {
      allocate(node.id, (edge) => edge.from === node.id, (index) => index, "outSlices");
      allocate(node.id, (edge) => edge.to === node.id, (index) => index, "inSlices");
    }

    const laidEdges: LaidEdge[] = [];
    edges.forEach((edge, index) => {
      const source = laid.get(edge.from);
      const target = laid.get(edge.to);
      if (!source || !target) return;
      const from = source.outSlices.get(index) ?? {
        top: source.y,
        bottom: source.y + source.h,
      };
      const to = target.inSlices.get(index) ?? {
        top: target.y,
        bottom: target.y + target.h,
      };
      const x0 = source.x + NODE_W;
      const x1 = target.x;
      const xm = x0 + (x1 - x0) / 2;
      const yMin = Math.min(from.top, to.top);
      const yMax = Math.max(from.bottom, to.bottom);
      const points: Array<[number, number]> = [
        [0, from.top - yMin],
        [xm - x0, from.top - yMin],
        [xm - x0, to.top - yMin],
        [x1 - x0, to.top - yMin],
        [x1 - x0, to.bottom - yMin],
        [xm - x0, to.bottom - yMin],
        [xm - x0, from.bottom - yMin],
        [0, from.bottom - yMin],
      ];
      laidEdges.push({
        edge,
        index,
        accent: edge.accent ?? accentOf(target.node),
        left: x0,
        top: yMin,
        width: Math.max(x1 - x0, 1),
        height: Math.max(yMax - yMin, 1),
        clipPath: `polygon(${points
          .map(([px, py]) => `${px.toFixed(2)}px ${py.toFixed(2)}px`)
          .join(", ")})`,
      });
    });

    return {
      nodes: [...laid.values()],
      edges: laidEdges,
      width: (maxColumn + 1) * columnWidth + PAD_RIGHT,
    };
  }, [nodes, edges, height, columnWidth]);

  const sourceKey = hovered ?? (activeNodeId ? `node:${activeNodeId}` : null);

  const highlighted = React.useMemo(() => {
    const nodeIds = new Set<string>();
    const edgeIndexes = new Set<number>();
    if (!sourceKey) return { nodeIds, edgeIndexes, active: false };

    const [kind, raw] = [
      sourceKey.startsWith("edge:") ? "edge" : "node",
      sourceKey.slice(sourceKey.indexOf(":") + 1),
    ];

    if (kind === "node") {
      nodeIds.add(raw);
      edges.forEach((edge, index) => {
        if (edge.from === raw || edge.to === raw) {
          edgeIndexes.add(index);
          nodeIds.add(edge.from);
          nodeIds.add(edge.to);
        }
      });
    } else {
      const index = Number(raw);
      const edge = edges[index];
      if (edge) {
        edgeIndexes.add(index);
        nodeIds.add(edge.from);
        nodeIds.add(edge.to);
      }
    }
    return { nodeIds, edgeIndexes, active: true };
  }, [sourceKey, edges]);

  const openChange = (key: string) => (open: boolean) =>
    setHovered((current) => (open ? key : current === key ? null : current));

  const total = React.useMemo(() => {
    const hasIncoming = new Set(edges.map((edge) => edge.to));
    return nodes
      .filter((node) => !hasIncoming.has(node.id))
      .reduce((sum, node) => sum + Math.max(node.value, 0), 0);
  }, [nodes, edges]);

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
        <ScrollArea className="w-full">
          <div
            className="relative"
            style={{ width: layout.width, height }}
            role="group"
            aria-label={title}
          >
            {/* Flow ribbons */}
            {layout.edges.map(({ edge, index, accent, left, top, width, height: h, clipPath }) => {
              const key = `edge:${index}`;
              const isActive = highlighted.edgeIndexes.has(index);
              const isDim = highlighted.active && !isActive;
              return (
                <HoverCard key={key} openDelay={80} closeDelay={60} onOpenChange={openChange(key)}>
                  <HoverCardTrigger asChild>
                    <button
                      type="button"
                      aria-label={`${edge.from} to ${edge.to}, ${formatValue(edge.value, unit)}`}
                      className={cn(
                        "absolute cursor-pointer border-0 p-0 transition-opacity duration-150",
                        ACCENT_BG[accent],
                        isDim ? "opacity-10" : isActive ? "opacity-80" : "opacity-40",
                      )}
                      style={{ left, top, width, height: h, clipPath }}
                    >
                      {isActive && animate ? (
                        <span
                          className="absolute inset-0 animate-flow-dash"
                          style={{
                            backgroundImage:
                              "repeating-linear-gradient(90deg, color-mix(in srgb, var(--tk-fg) 55%, transparent) 0 2px, transparent 2px 16px)",
                          }}
                        />
                      ) : null}
                    </button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-64 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
                      {edge.label ??
                        `${labelOf(nodes, edge.from)} → ${labelOf(nodes, edge.to)}`}
                    </p>
                    <p className="mt-1.5 font-mono text-sm tabular-nums text-fg">
                      {formatValue(edge.value, unit)}
                    </p>
                    {edge.description ? (
                      <p className="mt-1.5 text-xs leading-relaxed text-fg-faint">
                        {edge.description}
                      </p>
                    ) : null}
                  </HoverCardContent>
                </HoverCard>
              );
            })}

            {/* Stage nodes */}
            {layout.nodes.map(({ node, column, x, y, h, inline }) => {
              const key = `node:${node.id}`;
              const isActive = highlighted.nodeIds.has(node.id);
              const isDim = highlighted.active && !isActive;
              return (
                <HoverCard
                  key={key}
                  openDelay={80}
                  closeDelay={60}
                  onOpenChange={openChange(key)}
                >
                  <HoverCardTrigger asChild>
                    <button
                      type="button"
                      aria-label={`${node.label}, ${formatValue(node.value, unit)}`}
                      onClick={() => onNodeSelect?.(node.id)}
                      className={cn(
                        "absolute flex flex-col justify-center overflow-visible border bg-panel-2 px-2 text-left transition-all duration-150",
                        inline ? "items-start" : "items-center",
                        isActive
                          ? "border-amber ring-1 ring-amber"
                          : "border-edge-2 hover:border-amber",
                        isDim && "opacity-30",
                        animate && "animate-fade-slide-up",
                      )}
                      style={{
                        left: x,
                        top: y,
                        width: NODE_W,
                        height: h,
                        animationDelay: animate ? `${column * 70}ms` : undefined,
                        animationFillMode: animate ? "backwards" : undefined,
                      }}
                    >
                      <span
                        className={cn("absolute left-0 top-0 h-full w-[3px]", ACCENT_BG[accentOf(node)])}
                      />
                      {inline ? (
                        <>
                          <span className="max-w-full truncate font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
                            {node.label}
                          </span>
                          <span
                            className={cn(
                              "font-mono text-sm tabular-nums",
                              ACCENT_TEXT[accentOf(node)],
                            )}
                          >
                            {formatValue(node.value, unit)}
                          </span>
                        </>
                      ) : (
                        <span className="absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap bg-panel px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
                          {node.label}{" "}
                          <span className={cn("tabular-nums", ACCENT_TEXT[accentOf(node)])}>
                            {formatValue(node.value, unit)}
                          </span>
                        </span>
                      )}
                    </button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-64 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={ACCENT_BADGE[accentOf(node)]}>
                        {node.badge ?? node.tone}
                      </Badge>
                      {node.subLabel ? (
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                          {node.subLabel}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
                      {node.label}
                    </p>
                    <p className="mt-1 font-mono text-sm tabular-nums text-fg">
                      {formatValue(node.value, unit)}
                      {node.pct !== undefined ? (
                        <span className="ml-2 text-fg-faint">({node.pct}%)</span>
                      ) : null}
                    </p>
                    {node.metrics?.length ? (
                      <dl className="mt-2 space-y-1 border-t border-edge pt-2">
                        {node.metrics.map((metric) => (
                          <div
                            key={metric.label}
                            className="flex items-center justify-between gap-2"
                          >
                            <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-faint">
                              {metric.label}
                            </dt>
                            <dd className="font-mono text-[11px] tabular-nums text-fg-dim">
                              {metric.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {node.description ? (
                      <p className="mt-1.5 text-xs leading-relaxed text-fg-faint">
                        {node.description}
                      </p>
                    ) : null}
                  </HoverCardContent>
                </HoverCard>
              );
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

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

function labelOf(nodes: LiquidityFlowNode[], id: string): string {
  return nodes.find((node) => node.id === id)?.label ?? id;
}
