"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";

/**
 * Chart Container — wraps Recharts with shadcn/ui theming and Terminal Noir palette.
 * Based on the real shadcn/ui chart pattern: https://ui.shadcn.com/docs/components/chart
 *
 * Uses CSS variables for color theming. Define --chart-1 through --chart-5 in your
 * CSS to override the defaults. The Terminal Noir palette maps:
 *   --chart-1 → amber (primary accent)
 *   --chart-2 → graph purple
 *   --chart-3 → up green
 *   --chart-4 → oneinch teal
 *   --chart-5 → uniswap pink
 */

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
    icon?: React.ComponentType;
    color?: string;
    theme?: Record<keyof typeof THEMES, string>;
  }
>;

const THEMES = { light: "", dark: ".dark" } as const;

export function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;

  return (
    <div
      data-slot="chart"
      className={cn(
        "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none",
        className,
      )}
      {...props}
    >
      <ChartStyle id={chartId} config={config} />
      <RechartsPrimitive.ResponsiveContainer>
        {children}
      </RechartsPrimitive.ResponsiveContainer>
    </div>
  );
}

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(
    ([, cfg]) => cfg.theme || cfg.color,
  );
  if (!colorConfig.length) return null;
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color =
      itemConfig.theme?.[theme as keyof typeof THEMES] ?? itemConfig.color;
    return color ? `  --color-${key}: ${color};` : null;
  })
  .join("\n")}
}
`,
          )
          .join("\n"),
      }}
    />
  );
};

// Recharts re-exports (the chart components are from Recharts, styled by shadcn)
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
  ComposedChart,
} from "recharts";

const RechartsPrimitive = {
  ResponsiveContainer,
};

export {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  RechartsTooltip,
  XAxis,
  YAxis,
  ComposedChart,
};

/**
 * ChartTooltip — shadcn-styled tooltip wrapper for Recharts.
 */
export function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-edge bg-panel p-2 shadow-md">
      {label && (
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
          {label}
        </p>
      )}
      <div className="mt-1 space-y-0.5">
        {payload.map((entry: any, i: number) => (
          <div key={i} className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: entry.color }}
            />
            <span className="font-mono text-xs text-fg">{entry.name}:</span>
            <span className="font-mono text-xs font-semibold tabular-nums text-fg">
              {typeof entry.value === "number" ? entry.value.toFixed(2) : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * ChartLegend — shadcn-styled legend.
 */
export function ChartLegend({ payload }: any) {
  if (!payload?.length) return null;
  return (
    <div className="flex flex-wrap justify-center gap-3 pt-2">
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: entry.color }}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
            {entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}
