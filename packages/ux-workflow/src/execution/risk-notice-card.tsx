"use client";

/**
 * The risk notice — an add-on card that sits beside an execution component.
 *
 * ## What it is for
 *
 * The execution view prices slippage and gas, which are exit-liquidity questions at the moment of the
 * trade. It cannot answer whether you can get out *later*, or what happens to that exit if the chain's
 * sequencer stalls — and for a position held for yield and exited on a decision, those decide whether
 * the yield is real. So this card carries the chain's risk verdict and the position's alpha, beta and
 * gamma alongside the cost, rather than instead of it.
 *
 * ## Three things it must not do
 *
 * **Imply a verdict where none exists.** An unreported chain renders as `unreported`, never as `low`.
 * An all-clear that nothing observed is the most expensive thing this card could say.
 *
 * **Show a factor without its meaning.** Alpha, beta and gamma are legible only with the sentence
 * explaining what the number *is* — a ratio of 0.5 means nothing without "moves half as much as the
 * underlying". Each factor arrives with both.
 *
 * **Hide that the level is derived.** The rationale is rendered, not summarised away, because the
 * point of surfacing risk is that an operator can disagree with it — which requires seeing what drove
 * it. `provenance` names the source and the moment.
 *
 * ## Why the types are restated
 *
 * Same reason as `AquaFlightPanel`: this package keeps one React peer dependency and stays buildable
 * without the execution stack. The closed unions below mean a new level upstream fails the `Record`
 * check here rather than rendering as a blank chip.
 */

import * as React from "react";
import { cn } from "../lib/utils.js";
import { Badge } from "../primitives/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../primitives/card.js";
import { Separator } from "../primitives/separator.js";

/** Mirrors `RiskLevel` upstream, plus `unreported` for "no verdict yet". */
export type RiskNoticeLevel = "low" | "moderate" | "elevated" | "high" | "unreported";

export interface RiskMetricView {
  readonly id: string;
  readonly label: string;
  readonly value: number | string;
  readonly unit?: string;
  readonly source: string;
  readonly observedAt?: string;
}

export interface RiskFactorView {
  readonly id: "alpha" | "beta" | "gamma";
  readonly label: string;
  /** Null when nothing was supplied — never zero, which would read as a measurement. */
  readonly value: number | null;
  readonly unit?: string;
  readonly meaning: string;
  readonly reading: string;
}

export interface RiskNoticeView {
  readonly level: RiskNoticeLevel;
  readonly headline: string;
  readonly detail: string;
  readonly metrics: readonly RiskMetricView[];
  readonly provenance: { readonly source: string; readonly asOf: string; readonly inferredBy?: string } | null;
}

export interface RiskNoticeCardProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly notice: RiskNoticeView;
  /** Alpha, beta and gamma for the position. Absent means the position's factors are not shown. */
  readonly factors?: readonly RiskFactorView[];
  /** Collapses the metric list for a compact placement beside a timeline. */
  readonly compact?: boolean;
}

type BadgeVariant = "outline" | "up" | "amber" | "down";

const LEVEL_META: Record<RiskNoticeLevel, { label: string; variant: BadgeVariant }> = {
  unreported: { label: "no verdict", variant: "outline" },
  low: { label: "low", variant: "up" },
  moderate: { label: "moderate", variant: "amber" },
  elevated: { label: "elevated", variant: "amber" },
  high: { label: "high", variant: "down" },
};

/** Render a metric with its unit attached — a number without one is the commonest misreading. */
export function formatMetric(metric: RiskMetricView): string {
  if (typeof metric.value === "string") return metric.value;
  const rendered =
    metric.id.endsWith("_usd") || metric.unit === "USD"
      ? metric.value.toLocaleString("en-US", { maximumFractionDigits: 0 })
      : String(metric.value);
  return metric.unit === undefined || metric.unit === "USD" ? rendered : `${rendered} ${metric.unit}`;
}

export function RiskNoticeCard({
  notice,
  factors,
  compact = false,
  className,
  ...props
}: RiskNoticeCardProps) {
  const meta = LEVEL_META[notice.level];

  return (
    <Card
      className={cn(
        "border-edge-2/60",
        // A high reading is allowed to look like one. Warning colour is information, not decoration —
        // and nothing here blocks, so nothing here needs to shout.
        notice.level === "high" && "border-down/40",
        className,
      )}
      data-risk-level={notice.level}
      {...props}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="text-sm">Risk</span>
          <Badge variant={meta.variant}>{meta.label}</Badge>
          {notice.provenance?.inferredBy ? (
            <span className="font-mono text-xs text-fg-faint">{notice.provenance.inferredBy}</span>
          ) : null}
        </CardTitle>
        <CardDescription>{notice.headline}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* The rationale, not a summary of it: disagreeing with a verdict requires seeing what drove it. */}
        <p className="text-sm text-fg-dim">{notice.detail}</p>

        {factors !== undefined && factors.length > 0 ? (
          <>
            <Separator />
            <ul className="space-y-3" aria-label="Position risk factors">
              {factors.map((factor) => (
                <li key={factor.id} className="space-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium">{factor.label}</span>
                    <span
                      className={cn(
                        "font-mono text-sm tabular-nums",
                        // Negative gamma is the one that hurts, and it is the one usually omitted.
                        factor.value === null ? "text-fg-faint" : factor.value < 0 ? "text-down" : "text-fg",
                      )}
                    >
                      {factor.value === null ? "not supplied" : factor.value.toFixed(2)}
                    </span>
                  </div>
                  {/* The plain sentence is the point: the number alone is not legible. */}
                  <p className="text-xs text-fg-dim">{factor.reading}</p>
                  {!compact ? <p className="text-xs text-fg-faint">{factor.meaning}</p> : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {!compact && notice.metrics.length > 0 ? (
          <>
            <Separator />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2" aria-label="Chain metrics">
              {notice.metrics.map((metric) => (
                <div key={metric.id} className="min-w-0">
                  <dt className="truncate text-xs text-fg-faint">{metric.label}</dt>
                  <dd className="font-mono text-sm tabular-nums">{formatMetric(metric)}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}

        {notice.provenance !== null ? (
          <p className="text-xs text-fg-faint">
            {notice.provenance.source} · as of {notice.provenance.asOf}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
