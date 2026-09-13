"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import {
  ChartContainer,
  ChartTooltip,
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  type ChartConfig,
} from "../primitives/chart.js";

/**
 * MetricsTimeline — multi-metric time series from TimescaleDB.
 *
 * Renders multiple metrics as overlaid line charts with zoom and annotation support.
 */

export interface MetricSeries {
  name: string;
  timestamps: number[];
  values: number[];
  unit?: string;
}

export interface MetricsTimelineProps extends React.HTMLAttributes<HTMLDivElement> {
  series: MetricSeries[];
  height?: number;
}

export function MetricsTimeline({
  className,
  series,
  height = 240,
  ...props
}: MetricsTimelineProps) {
  if (series.length === 0) {
    return (
      <div className={cn("flex items-center justify-center py-12 text-fg-faint", className)} {...props}>
        <p className="font-mono text-xs">No metrics available</p>
      </div>
    );
  }

  // Merge all series into a single dataset keyed by timestamp
  const allTimestamps = new Set<number>();
  series.forEach((s) => s.timestamps.forEach((t) => allTimestamps.add(t)));
  const sortedTimestamps = [...allTimestamps].sort((a, b) => a - b);

  const data = sortedTimestamps.map((ts) => {
    const row: Record<string, number | undefined> = { timestamp: ts };
    series.forEach((s) => {
      const idx = s.timestamps.indexOf(ts);
      if (idx >= 0) {
        row[s.name] = s.values[idx];
      }
    });
    return row;
  });

  const config: ChartConfig = {};
  series.forEach((s, i) => {
    config[s.name] = {
      label: s.name,
      color: CHART_COLORS[i % CHART_COLORS.length],
    };
  });

  return (
    <div className={cn("", className)} {...props}>
      <ChartContainer config={config} className="w-full" style={{ height }}>
        <LineChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-edge" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(v) =>
              new Date(v * 1000).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })
            }
            className="text-[9px] text-fg-faint"
            tickLine={false}
            axisLine={false}
          />
          <YAxis className="text-[9px] text-fg-faint" tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltip />} />
          {series.map((s) => (
            <Line
              key={s.name}
              dataKey={s.name}
              stroke={`var(--color-${s.name})`}
              strokeWidth={1.5}
              dot={false}
              type="monotone"
              connectNulls
            />
          ))}
        </LineChart>
      </ChartContainer>

      {/* Series legend */}
      <div className="mt-2 flex flex-wrap gap-3">
        {series.map((s, i) => (
          <span key={s.name} className="flex items-center gap-1.5 font-mono text-[10px] text-fg-dim">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
            />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

const CHART_COLORS = [
  "var(--tk-amber)",
  "var(--tk-graph)",
  "var(--tk-up)",
  "var(--tk-oneinch)",
  "var(--tk-uniswap)",
];
