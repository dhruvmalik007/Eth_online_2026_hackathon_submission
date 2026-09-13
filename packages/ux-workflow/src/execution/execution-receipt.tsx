"use client";

import * as React from "react";
import { ArrowUpRight, CheckCircle2, ExternalLink, MinusCircle } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Badge } from "../primitives/badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "../primitives/card.js";
import { Separator } from "../primitives/separator.js";
import { StepPill, type ExecutionStepState } from "./step-pill.js";
import type { LiquidityFlowAccent } from "../desk/liquidity-flow.js";

/**
 * ExecutionReceipt — the settled outcome.
 *
 * The trust signal here is **actual vs quoted**: a run that came in at or under
 * the quote is the strongest evidence the fee decomposition above was honest,
 * so the comparison is shown rather than the cost alone. Everything remains
 * labelled synthetic while the adapter is simulated.
 */

const ACCENT_TEXT: Record<LiquidityFlowAccent, string> = {
  amber: "text-amber",
  up: "text-up",
  down: "text-down",
  graph: "text-graph-soft",
  oneinch: "text-oneinch",
  uniswap: "text-uniswap",
  faint: "text-fg-faint",
};

export interface ReceiptLegResult {
  id: string;
  label: string;
  accent: LiquidityFlowAccent;
  deployedUsd: number;
  costUsd: number;
  state: ExecutionStepState;
  /** Optional explorer link to the leg's final transaction. */
  explorerUrl?: string;
}

export interface ExecutionReceiptProps extends React.ComponentProps<typeof Card> {
  planId: string;
  notionalUsd: number;
  quotedCostUsd: number;
  actualCostUsd: number;
  legs: ReceiptLegResult[];
  /** Where the durable transaction record lives. */
  dashboardHref?: string;
  simulated?: boolean;
}

function usd(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function ExecutionReceipt({
  className,
  planId,
  notionalUsd,
  quotedCostUsd,
  actualCostUsd,
  legs,
  dashboardHref,
  simulated = false,
  ...props
}: ExecutionReceiptProps) {
  const settled = legs.filter((leg) => leg.state === "confirmed").length;
  const failed = legs.filter((leg) => leg.state === "failed").length;
  const complete = settled === legs.length;
  const deployed = legs
    .filter((leg) => leg.state === "confirmed")
    .reduce((sum, leg) => sum + leg.deployedUsd, 0);
  const delta = actualCostUsd - quotedCostUsd;
  const atOrUnder = delta <= 0;

  return (
    <Card className={cn("", className)} {...props}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span>{complete ? "Execution complete" : "Execution partial"}</span>
          {simulated ? <Badge variant="amber">simulated</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          {complete ? (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-up" aria-hidden />
          ) : (
            <MinusCircle className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden />
          )}
          <div>
            <p className="text-sm text-fg">
              {complete
                ? `${legs.length} of ${legs.length} legs settled.`
                : `${settled} of ${legs.length} legs settled${failed ? `, ${failed} failed` : ""}.`}
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-fg-faint">
              plan {planId} · {simulated ? "no funds moved (simulated)" : "recorded to the dashboard"}
            </p>
          </div>
        </div>

        <div className="grid gap-px bg-edge sm:grid-cols-3">
          <div className="bg-panel px-3 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">Deployed</p>
            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-fg">
              {usd(deployed)}
            </p>
          </div>
          <div className="bg-panel px-3 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
              Cost (actual)
            </p>
            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-amber">
              {usd(actualCostUsd)}
            </p>
          </div>
          <div className="bg-panel px-3 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
              vs quote
            </p>
            <p
              className={cn(
                "mt-0.5 font-mono text-sm font-semibold tabular-nums",
                atOrUnder ? "text-up" : "text-down",
              )}
            >
              {delta >= 0 ? "+" : "−"}
              {usd(Math.abs(delta))}
            </p>
          </div>
        </div>

        <p className="font-mono text-[10px] leading-relaxed text-fg-faint">
          Notional routed {usd(notionalUsd)} · quoted {usd(quotedCostUsd)} ·{" "}
          {atOrUnder ? "settled at or under quote" : "overran the quote"}
        </p>

        <Separator />

        <ul className="divide-y divide-edge">
          {legs.map((leg) => (
            <li key={leg.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={cn("font-mono text-[10px] uppercase tracking-[0.12em]", ACCENT_TEXT[leg.accent])}>
                  {leg.label}
                </span>
                <StepPill state={leg.state} />
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] tabular-nums text-fg-dim">
                  {usd(leg.deployedUsd)}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-fg-faint">
                  fee {usd(leg.costUsd)}
                </span>
                {leg.explorerUrl ? (
                  <a
                    href={leg.explorerUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-fg-faint hover:text-amber"
                    aria-label={`Open ${leg.label} transaction in explorer`}
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        {dashboardHref ? (
          <a
            href={dashboardHref}
            className="inline-flex items-center gap-1.5 border border-edge-2 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim hover:border-amber/60 hover:text-amber"
          >
            Open agent dashboard
            <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}
