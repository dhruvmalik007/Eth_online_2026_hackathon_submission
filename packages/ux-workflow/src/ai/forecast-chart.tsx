"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import {
  ChartContainer,
  ChartTooltip,
  Area,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  type ChartConfig,
} from "../primitives/chart.js";

/**
 * ForecastChart — renders TimesFM-3 multivariate forecast output.
 *
 * Built on shadcn/ui Chart (Recharts wrapper) with Terminal Noir palette.
 *
 * TimesFM-3 features visualized:
 * - Multiple targets: forecast multiple related time series simultaneously
 * - Past covariates: features only known historically
 * - Past-future (dynamic) covariates: known future events guide the forecast
 * - Non-autoregressive decode: entire horizon in a single forward pass
 * - 9 quantiles (10th–90th percentile) for probabilistic uncertainty
 *
 * The quantile band is rendered as an Area (gradient fill between q10 and q90),
 * the median as a dashed Line, and historical values as a solid Line.
 */

export interface ForecastPoint {
  timestamp: number;
  value: number;
  quantile10?: number;
  quantile50?: number;
  quantile90?: number;
}

export interface ForecastTarget {
  id: string;
  label: string;
  historical: ForecastPoint[];
  forecast: ForecastPoint[];
}

export interface ForecastChartProps extends React.HTMLAttributes<HTMLDivElement> {
  targets: ForecastTarget[];
  height?: number;
  showQuantiles?: boolean;
  unit?: string;
}

export function ForecastChart({
  className,
  targets,
  height = 280,
  showQuantiles = true,
  unit = "%",
  ...props
}: ForecastChartProps) {
  const [activeTargets, setActiveTargets] = React.useState<Set<string>>(
    () => new Set(targets.map((t) => t.id)),
  );

  const toggleTarget = (id: string) => {
    setActiveTargets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Merge historical + forecast into continuous series for each target
  // We create a "combined" dataset where each point has hist_<id> and fcst_<id> keys
  const allTimestamps = new Set<number>();
  const targetMap = new Map<string, ForecastTarget>();
  targets.forEach((t) => {
    targetMap.set(t.id, t);
    t.historical.forEach((p) => allTimestamps.add(p.timestamp));
    t.forecast.forEach((p) => allTimestamps.add(p.timestamp));
  });

  const sortedTimestamps = [...allTimestamps].sort((a, b) => a - b);

  const data = sortedTimestamps.map((ts) => {
    const row: Record<string, number | undefined> = { timestamp: ts };
    targets.forEach((t) => {
      const histPoint = t.historical.find((p) => p.timestamp === ts);
      const fcstPoint = t.forecast.find((p) => p.timestamp === ts);
      if (histPoint) {
        row[`hist_${t.id}`] = histPoint.value;
      }
      if (fcstPoint) {
        row[`fcst_${t.id}`] = fcstPoint.value;
        if (showQuantiles) {
          row[`q10_${t.id}`] = fcstPoint.quantile10 ?? fcstPoint.value;
          row[`q90_${t.id}`] = fcstPoint.quantile90 ?? fcstPoint.value;
        }
      }
    });
    return row;
  });

  // Build chart config
  const config: ChartConfig = {};
  targets.forEach((t, i) => {
    const color = CHART_COLORS[i % CHART_COLORS.length];
    config[`hist_${t.id}`] = { label: `${t.label} (hist)`, color };
    config[`fcst_${t.id}`] = { label: `${t.label} (fcst)`, color };
  });

  return (
    <div className={cn("border border-edge bg-panel p-4", className)} {...props}>
      {/* Target toggles */}
      <div className="mb-3 flex flex-wrap gap-2">
        {targets.map((t, i) => (
          <button
            key={t.id}
            onClick={() => toggleTarget(t.id)}
            className={cn(
              "flex items-center gap-1.5 border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
              activeTargets.has(t.id)
                ? "border-amber/50 bg-amber/10 text-amber"
                : "border-edge-2 bg-panel-2 text-fg-faint",
            )}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
            />
            {t.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <ChartContainer config={config} className="w-full" style={{ height }}>
        <ComposedChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
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
          <YAxis
            className="text-[9px] text-fg-faint"
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}${unit}`}
          />
          <ChartTooltip content={<ChartTooltip />} />

          {targets
            .filter((t) => activeTargets.has(t.id))
            .map((t, i) => {
              const color = CHART_COLORS[i % CHART_COLORS.length];
              return (
                <React.Fragment key={t.id}>
                  {/* Quantile band */}
                  {showQuantiles && (
                    <Area
                      dataKey={`q90_${t.id}`}
                      stroke="none"
                      fill={color}
                      fillOpacity={0.12}
                      connectNulls
                    />
                  )}
                  {/* Historical line */}
                  <Line
                    dataKey={`hist_${t.id}`}
                    stroke={color}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    type="monotone"
                  />
                  {/* Forecast line (dashed) */}
                  <Line
                    dataKey={`fcst_${t.id}`}
                    stroke={color}
                    strokeWidth={1.5}
                    strokeDasharray="4 2"
                    dot={false}
                    connectNulls
                    type="monotone"
                  />
                </React.Fragment>
              );
            })}
        </ComposedChart>
      </ChartContainer>
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
