"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import { Card, CardContent, CardHeader, CardTitle } from "../primitives/card.js";
import { Separator } from "../primitives/separator.js";
import {
  LiquidityFlowRoadmap,
  type LiquidityFlowAccent,
  type LiquidityFlowEdge,
  type LiquidityFlowLegendItem,
  type LiquidityFlowNode,
} from "../desk/liquidity-flow.js";

/**
 * FeeWaterfall — where the money actually goes, decomposed.
 *
 * Two levels of honesty this component exists to enforce:
 *
 * 1. A bridge/aggregator/messaging fee, a destination gas cost and a protocol
 *    fee are different things and are shown as separate lines, not one "fees".
 * 2. **A bound is not a cost.** Slippage tolerance and minReturn are maxima the
 *    user accepts; price impact and MEV exposure are market effects. None of
 *    them are summed into the headline, and they are rendered below a hard rule
 *    so they can never be read as part of it.
 *
 * The decomposition itself is the existing LiquidityFlowRoadmap (total → legs →
 * fee lines) so the fee story uses the same visual grammar as the portfolio one.
 */

export interface FeeLineView {
  id: string;
  label: string;
  amountUsd: number;
  bps?: number;
  token?: string;
  chain?: string;
  /** Provider semantics: already netted into the output amount (LI.FI). */
  included?: boolean;
  /** LayerZero MessagingFee denomination. */
  payIn?: "native" | "zro";
  provider?: string;
}

export interface FeeLegView {
  id: string;
  label: string;
  accent: LiquidityFlowAccent;
  costUsd: number;
  fees: FeeLineView[];
  /** True when the leg crosses chains — rendered as a route hint. */
  crossChain?: boolean;
}

export interface FeeWaterfallProps extends React.ComponentProps<typeof Card> {
  /** Sum of the `cost` tier only. Never includes bounds or market effects. */
  totalCostUsd: number;
  notionalUsd?: number;
  legs: FeeLegView[];
  /** Maxima the user accepts — explicitly NOT costs. */
  bounds?: { label: string; value: string; note?: string }[];
  /** Market effects — separated from costs for the same reason. */
  markets?: { label: string; value: string; note?: string }[];
  unit?: string;
  height?: number;
}

const TOTAL_ID = "__total_cost";

function pctOf(amountUsd: number, notionalUsd?: number): string | undefined {
  if (!notionalUsd || notionalUsd <= 0) return undefined;
  return `${((amountUsd / notionalUsd) * 10_000).toFixed(1)} bps`;
}

export function FeeWaterfall({
  className,
  totalCostUsd,
  notionalUsd,
  legs,
  bounds = [],
  markets = [],
  unit = "USD",
  height = 260,
  ...props
}: FeeWaterfallProps) {
  const { nodes, edges, legend } = React.useMemo(() => {
    const flowNodes: LiquidityFlowNode[] = [
      {
        id: TOTAL_ID,
        label: "Total cost",
        value: totalCostUsd,
        accent: "amber",
        badge: "total",
        subLabel: notionalUsd ? `on $${Math.round(notionalUsd).toLocaleString("en-US")}` : undefined,
        description:
          "Sum of every fee actually paid: protocol, bridge, aggregator, gas and destination execution. Slippage bounds and price impact are excluded — see below.",
        metrics: [
          { label: "Legs", value: String(legs.length) },
          ...(pctOf(totalCostUsd, notionalUsd)
            ? [{ label: "Effective", value: pctOf(totalCostUsd, notionalUsd)! }]
            : []),
        ],
      },
    ];

    const flowEdges: LiquidityFlowEdge[] = [];
    const flowLegend: LiquidityFlowLegendItem[] = [];

    for (const leg of legs) {
      flowNodes.push({
        id: leg.id,
        label: leg.label,
        value: leg.costUsd,
        accent: leg.accent,
        badge: leg.crossChain ? "cross-chain" : "same-chain",
        subLabel: leg.crossChain ? "bridged" : undefined,
        metrics: [
          { label: "Fees", value: `${leg.fees.length} lines` },
          ...(pctOf(leg.costUsd, notionalUsd)
            ? [{ label: "Effective", value: pctOf(leg.costUsd, notionalUsd)! }]
            : []),
        ],
      });
      flowEdges.push({
        from: TOTAL_ID,
        to: leg.id,
        value: leg.costUsd,
        accent: leg.accent,
      });
      flowLegend.push({ label: leg.label, accent: leg.accent });

      for (const fee of leg.fees) {
        const feeId = `${leg.id}::${fee.id}`;
        flowNodes.push({
          id: feeId,
          label: fee.label,
          value: Math.max(fee.amountUsd, 0),
          // An `included` line is already netted into the output: showing it in
          // the leg's accent would imply it is charged on top again.
          accent: fee.included ? "faint" : leg.accent,
          badge: fee.included ? "included" : "fee",
          subLabel: fee.included ? "in output" : undefined,
          metrics: [
            ...(fee.bps !== undefined ? [{ label: "Rate", value: `${fee.bps} bps` }] : []),
            ...(fee.token ? [{ label: "Token", value: fee.token }] : []),
            ...(fee.chain ? [{ label: "Chain", value: fee.chain }] : []),
            ...(fee.provider ? [{ label: "Provider", value: fee.provider }] : []),
            ...(fee.payIn ? [{ label: "Paid in", value: fee.payIn.toUpperCase() }] : []),
          ],
        });
        flowEdges.push({
          from: leg.id,
          to: feeId,
          value: Math.max(fee.amountUsd, 0),
          accent: fee.included ? "faint" : leg.accent,
        });
      }
    }

    return { nodes: flowNodes, edges: flowEdges, legend: flowLegend };
  }, [legs, totalCostUsd, notionalUsd]);

  return (
    <Card className={cn("", className)} {...props}>
      <CardHeader>
        <CardTitle>Fee breakdown</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <LiquidityFlowRoadmap
          title="Cost decomposition"
          height={height}
          nodes={nodes}
          edges={edges}
          legend={legend}
          hint="hover a leg or a fee line for its rate, token and chain"
          className="border-0 bg-transparent"
          unit={unit}
        />

        {(bounds.length > 0 || markets.length > 0) && (
          <>
            <Separator />
            {/* Everything below this line is NOT part of the total above. */}
            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
                Not included in the total
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {bounds.map((bound) => (
                  <div key={bound.label} className="border border-edge-2 bg-panel-2 px-3 py-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                      {bound.label}
                    </p>
                    <p className="mt-0.5 font-mono text-xs tabular-nums text-amber">{bound.value}</p>
                    {bound.note ? (
                      <p className="mt-1 text-[10px] leading-snug text-fg-faint">{bound.note}</p>
                    ) : null}
                  </div>
                ))}
                {markets.map((market) => (
                  <div key={market.label} className="border border-edge-2 bg-panel-2 px-3 py-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                      {market.label}
                    </p>
                    <p className="mt-0.5 font-mono text-xs tabular-nums text-graph-soft">
                      {market.value}
                    </p>
                    {market.note ? (
                      <p className="mt-1 text-[10px] leading-snug text-fg-faint">{market.note}</p>
                    ) : null}
                  </div>
                ))}
              </div>
              <p className="font-mono text-[10px] leading-relaxed text-fg-faint">
                Bounds are the worst case you accept, not an amount charged. Price impact is the
                market&apos;s reaction to your size, not a fee line.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
