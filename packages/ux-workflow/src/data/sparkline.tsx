"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";

/**
 * Sparkline — minimal inline line chart built on Recharts.
 * Terminal Noir themed. No axes, no grid — just the trend line.
 */
export interface SparklineProps extends React.HTMLAttributes<SVGSVGElement> {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  strokeWidth?: number;
}

export function Sparkline({
  className,
  data,
  width = 80,
  height = 24,
  color = "var(--tk-fg)",
  fill = false,
  strokeWidth = 1.5,
  ...props
}: SparklineProps) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return [x, y] as const;
  });

  const linePath = points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
  const areaPath = `M 0 ${height} ${points.map(([x, y]) => `L ${x} ${y}`).join(" ")} L ${width} ${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      {...props}
    >
      {fill && <path d={areaPath} fill={color} opacity={0.15} />}
      <path d={linePath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
