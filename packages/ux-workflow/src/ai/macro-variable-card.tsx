"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import { Card } from "../primitives/card.js";
import { Sparkline } from "../data/sparkline.js";

/**
 * MacroVariableCard — displays a single macro indicator with trend sparkline.
 *
 * Built on shadcn/ui Card as the container, with a custom Sparkline for the trend.
 * Used for TimesFM-3 context: shows one macro variable (e.g., USDC supply APY,
 * ETH utilization) with its current value, trend, and covariate status.
 */

export interface MacroVariableCardProps extends React.ComponentProps<typeof Card> {
  label: string;
  value: number;
  unit?: string;
  change?: number;
  sparklineData?: number[];
  covariates?: { label: string; active: boolean }[];
  status?: "up" | "down" | "flat";
}

export function MacroVariableCard({
  className,
  label,
  value,
  unit = "%",
  change,
  sparklineData = [],
  covariates = [],
  status,
  ...props
}: MacroVariableCardProps) {
  const computedStatus = status ?? (change !== undefined ? (change > 0.01 ? "up" : change < -0.01 ? "down" : "flat") : "flat");
  const statusColor = computedStatus === "up" ? "text-up" : computedStatus === "down" ? "text-down" : "text-fg-dim";
  const sparkColor =
    computedStatus === "up"
      ? "var(--tk-up)"
      : computedStatus === "down"
        ? "var(--tk-down)"
        : "var(--tk-fg-dim)";

  return (
    <Card className={cn("p-4", className)} {...props}>
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-dim">
            {label}
          </p>
          <p className={cn("mt-1 font-mono text-3xl font-semibold tabular-nums", statusColor)}>
            {value.toFixed(2)}
            <span className="ml-1 text-sm text-fg-dim">{unit}</span>
          </p>
          {change !== undefined && (
            <p className={cn("mt-1 font-mono text-xs tabular-nums", statusColor)}>
              {change > 0 ? "▲" : change < 0 ? "▼" : "–"} {Math.abs(change).toFixed(2)}%
            </p>
          )}
        </div>

        {sparklineData.length > 0 && (
          <Sparkline data={sparklineData} width={60} height={20} color={sparkColor} />
        )}
      </div>

      {covariates.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {covariates.map((c, i) => (
            <span
              key={i}
              className={cn(
                "border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em]",
                c.active
                  ? "border-amber/40 bg-amber/10 text-amber"
                  : "border-edge-2 bg-panel-2 text-fg-faint",
              )}
            >
              {c.label}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
