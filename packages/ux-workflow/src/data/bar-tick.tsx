"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";

/**
 * BarTick — single bar for volume, utilization, etc.
 * Uses Terminal Noir color tokens.
 */
export interface BarTickProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number; // 0-1 normalized
  label?: string;
  color?: string;
  height?: number;
}

export function BarTick({
  className,
  value,
  label,
  color = "var(--tk-amber)",
  height = 40,
  ...props
}: BarTickProps) {
  const clampedValue = Math.max(0, Math.min(1, value));

  return (
    <div className={cn("flex flex-col items-center gap-1", className)} {...props}>
      <div className="w-3 overflow-hidden bg-panel-2" style={{ height }}>
        <div
          className="w-full transition-all"
          style={{
            height: `${clampedValue * 100}%`,
            marginTop: `${(1 - clampedValue) * 100}%`,
            background: color,
          }}
        />
      </div>
      {label && <span className="font-mono text-[9px] text-fg-faint">{label}</span>}
    </div>
  );
}
