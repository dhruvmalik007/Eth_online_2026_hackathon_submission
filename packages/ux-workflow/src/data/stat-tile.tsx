"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import { Card, CardContent } from "../primitives/card.js";

/**
 * StatTile — KPI tile with number, delta, and label.
 * Built on shadcn/ui Card as the container.
 */
export interface StatTileProps extends React.ComponentProps<typeof Card> {
  label: string;
  value: string | number;
  delta?: number;
  unit?: string;
  trend?: "up" | "down" | "flat";
}

export function StatTile({
  className,
  label,
  value,
  delta,
  unit,
  trend,
  ...props
}: StatTileProps) {
  const computedTrend = trend ?? (delta !== undefined ? (delta > 0.01 ? "up" : delta < -0.01 ? "down" : "flat") : "flat");
  const trendColor = computedTrend === "up" ? "text-up" : computedTrend === "down" ? "text-down" : "text-fg-dim";

  return (
    <Card className={cn("", className)} {...props}>
      <CardContent className="p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-dim">
          {label}
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-mono text-2xl font-semibold tabular-nums text-fg">
            {value}
          </span>
          {unit && <span className="font-mono text-xs text-fg-dim">{unit}</span>}
        </div>
        {delta !== undefined && (
          <p className={cn("mt-1 font-mono text-xs tabular-nums", trendColor)}>
            {computedTrend === "up" ? "▲" : computedTrend === "down" ? "▼" : "–"}{" "}
            {Math.abs(delta).toFixed(2)}%
          </p>
        )}
      </CardContent>
    </Card>
  );
}
