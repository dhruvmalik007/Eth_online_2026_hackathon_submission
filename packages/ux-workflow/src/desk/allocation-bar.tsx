"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";

/**
 * AllocationBar — α/β/γ weight visualization with phase floor.
 *
 * Shows the portfolio allocation across three legs:
 * - α (LST / long-duration)
 * - β (money-market sweep)
 * - γ (dynamic pool fee)
 *
 * The β floor is shown as a minimum threshold line per session phase.
 */

export interface AllocationBarProps extends React.HTMLAttributes<HTMLDivElement> {
  alpha: number; // 0-1
  beta: number;  // 0-1
  gamma: number; // 0-1 (fee, typically small)
  betaFloor?: number; // minimum β per phase
  labels?: { alpha?: string; beta?: string; gamma?: string };
}

export function AllocationBar({
  className,
  alpha,
  beta,
  gamma,
  betaFloor = 0.5,
  labels,
  ...props
}: AllocationBarProps) {
  const total = alpha + beta + gamma;
  const normalized = total > 0 ? { alpha: alpha / total, beta: beta / total, gamma: gamma / total } : { alpha: 0, beta: 0, gamma: 0 };
  const isBelowFloor = beta < betaFloor;

  return (
    <div className={cn("space-y-2", className)} {...props}>
      {/* Stacked bar */}
      <div className="relative flex h-6 w-full overflow-hidden border border-edge bg-panel-2">
        {/* β floor indicator */}
        <div
          className="absolute bottom-0 left-0 h-full border-r-2 border-dashed border-down/50"
          style={{ width: `${betaFloor * 100}%` }}
        />
        {/* Segments */}
        <div
          className="h-full bg-graph transition-all"
          style={{ width: `${normalized.alpha * 100}%` }}
        />
        <div
          className={cn(
            "h-full transition-all",
            isBelowFloor ? "bg-down" : "bg-amber",
          )}
          style={{ width: `${normalized.beta * 100}%` }}
        />
        <div
          className="h-full bg-up transition-all"
          style={{ width: `${normalized.gamma * 100}%` }}
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 font-mono text-[10px]">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 bg-graph" />
          {labels?.alpha ?? "α (LST)"}: {(alpha * 100).toFixed(1)}%
        </span>
        <span className={cn("flex items-center gap-1.5", isBelowFloor ? "text-down" : "")}>
          <span className={cn("h-2 w-2", isBelowFloor ? "bg-down" : "bg-amber")} />
          {labels?.beta ?? "β (sweep)"}: {(beta * 100).toFixed(1)}%
          {isBelowFloor && <span className="text-down">↓ floor</span>}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 bg-up" />
          {labels?.gamma ?? "γ (fee)"}: {(gamma * 100).toFixed(2)}%
        </span>
      </div>
    </div>
  );
}
