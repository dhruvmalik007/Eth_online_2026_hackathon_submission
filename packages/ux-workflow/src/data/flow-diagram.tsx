"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import { Badge } from "../primitives/badge.js";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../primitives/hover-card.js";
import { ScrollArea, ScrollBar } from "../primitives/scroll-area.js";

/**
 * FlowDiagram — a left-to-right node/edge canvas for anything that decomposes into stages.
 *
 * Extracted from `LiquidityFlowRoadmap`, which was already a general engine wearing a domain name:
 * column assignment, ribbon geometry, hover isolation, staggered entrance and the marching-dash
 * active flow are all independent of what the nodes mean. The desk wrapper still owns the Card, the
 * title, the currency and the legend; this owns the picture.
 *
 * Node height encodes magnitude, so a caller whose nodes are all the same size passes equal values —
 * a state machine wants uniform boxes and gets them, because the scale is derived from the largest
 * column rather than from each node's own value.
 *
 * `formatValue` is optional on purpose. When it is absent the diagram renders labels only, which is
 * what a diagram is for when the numbers are not the point — a stage name and its state, not a
 * quantity. Passing it restores the Sankey reading.
 *
 * Design: packages/ux-workflow/docs/liquidity-flow-roadmap-widget.md
 */

export type FlowTone = "revenue" | "profit" | "cost";

/**
 * Terminal Noir accent tokens. Two ways to color a node:
 * `tone` carries meaning (revenue/profit/cost → amber/green/red); `accent`
 * overrides the visual so callers with their own categorical palette
 * (e.g. the five portfolio strategies) keep their color coding.
 */
export type FlowAccent =
  "amber" | "up" | "down" | "graph" | "oneinch" | "uniswap" | "faint";

export interface FlowMetric {
  label: string;
  value: string;
}

export interface FlowLegendItem {
  label: string;
  accent: FlowAccent;
}

export interface FlowNode {
  id: string;
  label: string;
  /** Numeric magnitude in the caller's unit; drives the node's height. */
  value: number;
  /** Semantic meaning. Drives the default color; omit when using `accent`. */
  tone?: FlowTone;
  /** Explicit token color, overriding the tone-derived one. */
  accent?: FlowAccent;
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
  metrics?: FlowMetric[];
}

export interface FlowEdge {
  from: string;
  to: string;
  /** Flow magnitude; drives the ribbon thickness. */
  value: number;
  /** Ribbon tone. Defaults to the destination node's tone. */
  tone?: FlowTone;
  /** Ribbon color override. Defaults to the destination node's accent. */
  accent?: FlowAccent;
  /** Hover title. Defaults to "From → To". */
  label?: string;
  /** Contextual sentence shown in the hover card. */
  description?: string;
}

const ACCENT_BG: Record<FlowAccent, string> = {
  amber: "bg-amber",
  up: "bg-up",
  down: "bg-down",
  graph: "bg-graph",
  oneinch: "bg-oneinch",
  uniswap: "bg-uniswap",
  faint: "bg-fg-faint",
};

const ACCENT_TEXT: Record<FlowAccent, string> = {
  amber: "text-amber",
  up: "text-up",
  down: "text-down",
  graph: "text-graph-soft",
  oneinch: "text-oneinch",
  uniswap: "text-uniswap",
  faint: "text-fg-faint",
};

type BadgeVariant =
  "default" | "amber" | "up" | "down" | "graph" | "oneinch" | "uniswap";

/** Exported so a caller can put the same accent on a chip outside the canvas. */
export const ACCENT_BADGE: Record<FlowAccent, BadgeVariant> = {
  amber: "amber",
  up: "up",
  down: "down",
  graph: "graph",
  oneinch: "oneinch",
  uniswap: "uniswap",
  faint: "default",
};

export { ACCENT_BG };

const TONE_ACCENT: Record<FlowTone, FlowAccent> = {
  revenue: "amber",
  profit: "up",
  cost: "down",
};

export function accentOf(node: FlowNode): FlowAccent {
  return node.accent ?? TONE_ACCENT[node.tone ?? "revenue"];
}

const NODE_W = 148;
const NODE_GAP = 14;
const PAD_TOP = 10;
const PAD_RIGHT = 168;
const LABEL_MIN_H = 44;

/**
 * Compact magnitude formatting, for callers that render values.
 *
 * Sub-dollar amounts (gas, bridge and messaging fees) need more precision than
 * cents, or a $0.1156 fee renders as a misleading "$0.12".
 */
export function formatValue(value: number, unit = "USD"): string {
  const symbol = unit === "USD" ? "$" : "";
  const suffix = unit === "USD" ? "" : ` ${unit}`;
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${symbol}${(value / 1e12).toFixed(2)}T${suffix}`;
  if (abs >= 1e9) return `${symbol}${(value / 1e9).toFixed(2)}B${suffix}`;
  if (abs >= 1e6) return `${symbol}${(value / 1e6).toFixed(2)}M${suffix}`;
  if (abs >= 1e3) return `${symbol}${(value / 1e3).toFixed(2)}K${suffix}`;
  if (abs > 0 && abs < 1) return `${symbol}${value.toFixed(4)}${suffix}`;
  return `${symbol}${value.toFixed(2)}${suffix}`;
}

/** Longest-path column assignment from the graph's roots. */
export function assignColumns(
  nodes: FlowNode[],
  edges: FlowEdge[],
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
  node: FlowNode;
  column: number;
  x: number;
  y: number;
  h: number;
  inline: boolean;
  outSlices: Map<number, Slice>;
  inSlices: Map<number, Slice>;
}

interface LaidEdge {
  edge: FlowEdge;
  index: number;
  accent: FlowAccent;
  left: number;
  top: number;
  width: number;
  height: number;
  clipPath: string;
}

export interface FlowDiagramProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Canvas height in px. Default: 300. */
  height?: number;
  /** Horizontal space per column in px. Default: 200. */
  columnWidth?: number;
  /** Persistently highlighted node (in addition to hover). */
  activeNodeId?: string;
  /** Enables the staggered entrance and marching-dash flow. Default: true. */
  animate?: boolean;
  /**
   * Renders each node's magnitude. Omit for a diagram where magnitude is not the point — labels
   * render alone, and the hover card drops its value row rather than showing a meaningless one.
   */
  formatValue?: (value: number) => string;
  /**
   * A fixed height for every node, for a diagram where magnitude is not the point.
   *
   * Without it, heights are proportional to `value`, which is right for a flow and wrong for a
   * state graph: columns of different lengths centre independently and the inline/outside label
   * rule flips on height, so equal-valued nodes still end up looking like different kinds of thing.
   */
  nodeHeight?: number;
  /** Accessible name for the canvas. */
  ariaLabel?: string;
  onNodeSelect?: (id: string) => void;
  className?: string;
}

export function FlowDiagram({
  nodes,
  edges,
  height = 300,
  columnWidth = 200,
  activeNodeId,
  animate = true,
  formatValue: format,
  nodeHeight,
  ariaLabel = "Flow diagram",
  onNodeSelect,
  className,
}: FlowDiagramProps) {
  const [hovered, setHovered] = React.useState<string | null>(null);

  const layout = React.useMemo(() => {
    const columns = assignColumns(nodes, edges);
    const byColumn = new Map<number, FlowNode[]>();
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
    let lastColumnInline = true;

    for (const [column, bucket] of [...byColumn.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      const heights = bucket.map(
        (node) => nodeHeight ?? Math.max(node.value * scale, 2),
      );
      // Labels sit inside the bar only when every bar in the column is tall
      // enough; mixing inline and outside labels within a column reads as noise.
      const columnInline = heights.every(
        (barHeight) => barHeight >= LABEL_MIN_H,
      );
      if (column === maxColumn) lastColumnInline = columnInline;
      const contentH =
        heights.reduce((sum, h) => sum + h, 0) +
        Math.max(bucket.length - 1, 0) * NODE_GAP;
      let cursorY =
        PAD_TOP + Math.max((height - PAD_TOP * 2 - contentH) / 2, 0);
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
      picks: (edge: FlowEdge) => boolean,
      key: (index: number) => number,
      field: "outSlices" | "inSlices",
    ) => {
      const source = laid.get(nodeId);
      if (!source) return;
      const selected = edges
        .map((edge, index) => ({ edge, index }))
        .filter(({ edge }) => picks(edge));
      const total = selected.reduce(
        (sum, { edge }) => sum + Math.max(edge.value, 0),
        0,
      );
      if (total <= 0) return;
      let cursor = source.y;
      for (const { edge, index } of selected) {
        const sliceH = (Math.max(edge.value, 0) / total) * source.h;
        source[field].set(key(index), { top: cursor, bottom: cursor + sliceH });
        cursor += sliceH;
      }
    };

    for (const node of nodes) {
      allocate(
        node.id,
        (edge) => edge.from === node.id,
        (index) => index,
        "outSlices",
      );
      allocate(
        node.id,
        (edge) => edge.to === node.id,
        (index) => index,
        "inSlices",
      );
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
      // `PAD_RIGHT` is room for labels that sit *outside* the last column's nodes. When those nodes
      // are tall enough for an inline label — any diagram with a fixed node height, and most with
      // large magnitudes — reserving it leaves 168px of dead canvas, enough to push a five-column
      // diagram past its container and hand the reader a scrollbar over empty space.
      width:
        (maxColumn + 1) * columnWidth + (lastColumnInline ? 0 : PAD_RIGHT),
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

  return (
    <ScrollArea className={cn("w-full", className)}>
      <div
        className="relative"
        style={{ width: layout.width, height }}
        role="group"
        aria-label={ariaLabel}
      >
        {/* Flow ribbons */}
        {layout.edges.map(
          ({ edge, index, accent, left, top, width, height: h, clipPath }) => {
            const key = `edge:${index}`;
            const isActive = highlighted.edgeIndexes.has(index);
            const isDim = highlighted.active && !isActive;
            const magnitude = format ? format(edge.value) : undefined;
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
                    aria-label={
                      magnitude === undefined
                        ? `${edge.from} to ${edge.to}`
                        : `${edge.from} to ${edge.to}, ${magnitude}`
                    }
                    className={cn(
                      "absolute cursor-pointer border-0 p-0 transition-opacity duration-150",
                      ACCENT_BG[accent],
                      // Dimming has to leave a diagram readable. At 10% an unhighlighted ribbon is not
                      // quiet, it is absent — and on a canvas where one selection touches two of
                      // thirteen edges, that removes most of the picture rather than pointing at a
                      // part of it.
                      isDim
                        ? "opacity-25"
                        : isActive
                          ? "opacity-85"
                          : "opacity-50",
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
                  {magnitude === undefined ? null : (
                    <p className="mt-1.5 font-mono text-sm tabular-nums text-fg">
                      {magnitude}
                    </p>
                  )}
                  {edge.description ? (
                    <p className="mt-1.5 text-xs leading-relaxed text-fg-faint">
                      {edge.description}
                    </p>
                  ) : null}
                </HoverCardContent>
              </HoverCard>
            );
          },
        )}

        {/* Stage nodes */}
        {layout.nodes.map(({ node, column, x, y, h, inline }) => {
          const key = `node:${node.id}`;
          const isActive = highlighted.nodeIds.has(node.id);
          const isDim = highlighted.active && !isActive;
          const accent = accentOf(node);
          const magnitude = format ? format(node.value) : undefined;
          const badge = node.badge ?? node.tone;
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
                  aria-label={
                    magnitude === undefined
                      ? node.label
                      : `${node.label}, ${magnitude}`
                  }
                  onClick={() => onNodeSelect?.(node.id)}
                  className={cn(
                    "absolute flex flex-col justify-center overflow-visible border bg-panel-2 px-2 text-left transition-all duration-150",
                    inline ? "items-start" : "items-center",
                    isActive
                      ? "border-amber ring-1 ring-amber"
                      : "border-edge-2 hover:border-amber",
                    // Same reason as the ribbons: a node has to stay legible while something else is
                    // highlighted, or the diagram can only show one state at a time.
                    isDim && "opacity-55",
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
                    className={cn(
                      "absolute left-0 top-0 h-full w-[3px]",
                      ACCENT_BG[accent],
                    )}
                  />
                  {inline ? (
                    <>
                      <span className="max-w-full truncate font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
                        {node.label}
                      </span>
                      {magnitude === undefined ? null : (
                        <span
                          className={cn(
                            "font-mono text-sm tabular-nums",
                            ACCENT_TEXT[accent],
                          )}
                        >
                          {magnitude}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap bg-panel px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
                      {node.label}
                      {magnitude === undefined ? null : (
                        <>
                          {" "}
                          <span
                            className={cn("tabular-nums", ACCENT_TEXT[accent])}
                          >
                            {magnitude}
                          </span>
                        </>
                      )}
                    </span>
                  )}
                </button>
              </HoverCardTrigger>
              <HoverCardContent className="w-64 p-3">
                {badge === undefined && node.subLabel === undefined ? null : (
                  <div className="flex items-center justify-between gap-2">
                    {badge === undefined ? (
                      <span />
                    ) : (
                      <Badge variant={ACCENT_BADGE[accent]}>{badge}</Badge>
                    )}
                    {node.subLabel ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                        {node.subLabel}
                      </span>
                    ) : null}
                  </div>
                )}
                <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
                  {node.label}
                </p>
                {magnitude === undefined ? null : (
                  <p className="mt-1 font-mono text-sm tabular-nums text-fg">
                    {magnitude}
                    {node.pct !== undefined ? (
                      <span className="ml-2 text-fg-faint">({node.pct}%)</span>
                    ) : null}
                  </p>
                )}
                {node.metrics?.length ? (
                  <dl
                    className={cn(
                      "space-y-1 border-t border-edge pt-2",
                      magnitude === undefined ? "mt-1.5" : "mt-2",
                    )}
                  >
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
  );
}

function labelOf(nodes: FlowNode[], id: string): string {
  return nodes.find((node) => node.id === id)?.label ?? id;
}
