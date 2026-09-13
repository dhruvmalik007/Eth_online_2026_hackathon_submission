"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import {
  ChartContainer,
  ChartTooltip,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  type ChartConfig,
} from "../primitives/chart.js";

/**
 * BacktestResult — shows predicted vs actual time series with error metrics.
 *
 * Built on shadcn/ui Chart (Recharts wrapper) with Terminal Noir palette.
 *
 * Visualizes TimesFM-3 backtesting output:
 * - Predicted (forecast) vs actual (observed) time series as Lines
 * - Error metrics: MAE, RMSE, quantile coverage
 */

export interface BacktestPoint {
  timestamp: number;
  actual: number;
  predicted: number;
}

export interface BacktestResultProps extends React.HTMLAttributes<HTMLDivElement> {
  points: BacktestPoint[];
  metrics: {
    mae: number;
    rmse: number;
    mape?: number;
    quantileCoverage?: number;
  };
  unit?: string;
  height?: number;
}

export function BacktestResult({
  className,
  points,
  metrics,
  unit = "%",
  height = 240,
  ...props
}: BacktestResultProps) {
  const data = points.map((p) => ({
    timestamp: p.timestamp,
    actual: p.actual,
    predicted: p.predicted,
    error: Math.abs(p.actual - p.predicted),
  }));

  const config: ChartConfig = {
    actual: { label: "Actual", color: "var(--tk-fg)" },
    predicted: { label: "Predicted", color: "var(--tk-amber)" },
  };

  const formatMetric = (v: number) => (v < 10 ? v.toFixed(3) : v.toFixed(2));

  return (
    <div className={cn("border border-edge bg-panel p-4", className)} {...props}>
      {/* Metrics row */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile label="MAE" value={formatMetric(metrics.mae)} unit={unit} />
        <MetricTile label="RMSE" value={formatMetric(metrics.rmse)} unit={unit} />
        {metrics.mape !== undefined && (
          <MetricTile label="MAPE" value={formatMetric(metrics.mape)} unit="%" />
        )}
        {metrics.quantileCoverage !== undefined && (
          <MetricTile
            label="Q-Coverage"
            value={formatMetric(metrics.quantileCoverage * 100)}
            unit="%"
          />
        )}
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
          <Line
            dataKey="actual"
            stroke="var(--tk-fg)"
            strokeWidth={1.5}
            dot={false}
            type="monotone"
          />
          <Line
            dataKey="predicted"
            stroke="var(--tk-amber)"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            dot={false}
            type="monotone"
          />
        </ComposedChart>
      </ChartContainer>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-4 font-mono text-[10px] text-fg-dim">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-fg" />
          Actual
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 border-t border-dashed border-amber" />
          Predicted
        </span>
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="border border-edge-2 bg-panel-2 px-3 py-2">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-fg-faint">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-fg">
        {value}
        <span className="ml-0.5 text-xs text-fg-dim">{unit}</span>
      </p>
    </div>
  );
}
