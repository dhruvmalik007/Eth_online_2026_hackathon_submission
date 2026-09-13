"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import { Progress } from "../primitives/progress.js";

/**
 * ConstraintMeter — limit usage gauge (VaR, concentration, duration, etc.).
 *
 * Built on shadcn/ui Progress. Shows current usage vs. limit with color semantics:
 * - green (< 70%), amber (70–90%), red (> 90%).
 */

export interface ConstraintMeterProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  current: number;
  limit: number;
  unit?: string;
  showPercentage?: boolean;
}

export function ConstraintMeter({
  className,
  label,
  current,
  limit,
  unit = "",
  showPercentage = true,
  ...props
}: ConstraintMeterProps) {
  const pct = limit > 0 ? (current / limit) * 100 : 0;
  const color =
    pct > 90 ? "bg-down" : pct > 70 ? "bg-amber" : "bg-up";

  return (
    <div className={cn("space-y-1.5", className)} {...props}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
          {label}
        </span>
        <span className="font-mono text-xs tabular-nums text-fg">
          {current.toFixed(2)}
          {unit} / {limit.toFixed(2)}
          {unit}
          {showPercentage && (
            <span className="ml-1 text-fg-faint">({pct.toFixed(0)}%)</span>
          )}
        </span>
      </div>
      <Progress
        value={Math.min(pct, 100)}
        className="h-1.5"
        indicatorClassName={color}
      />
    </div>
  );
}
