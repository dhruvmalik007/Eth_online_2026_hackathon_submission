"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";

/**
 * HeatCell — concentration matrix cell with amber color intensity.
 */
export interface HeatCellProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number; // 0-1 normalized
  label?: string;
  size?: "sm" | "md" | "lg";
}

const sizeMap = { sm: "h-6 w-6", md: "h-8 w-8", lg: "h-10 w-10" };

export function HeatCell({
  className,
  value,
  label,
  size = "md",
  ...props
}: HeatCellProps) {
  const clampedValue = Math.max(0, Math.min(1, value));
  const opacity = 0.15 + clampedValue * 0.6;

  return (
    <div
      className={cn(
        "flex items-center justify-center border border-edge-2 font-mono text-[10px] text-fg",
        sizeMap[size],
        className,
      )}
      style={{
        background: `color-mix(in srgb, var(--tk-amber) ${opacity * 100}%, transparent)`,
      }}
      {...props}
    >
      {label ?? (clampedValue * 100).toFixed(0)}
    </div>
  );
}
