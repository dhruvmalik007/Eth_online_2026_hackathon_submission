"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ForecastPayload } from "@/lib/demo/data";

const fmtTvl = (v: number) => `$${(v / 1e9).toFixed(2)}B`;

export function ForecastFan({
  payload,
  height = 180,
  color = "#ffb300",
}: {
  payload: ForecastPayload;
  height?: number;
  color?: string;
}) {
  const data = React.useMemo(
    () =>
      payload.forecast_30d.map((v, i) => ({
        day: i + 1,
        median: Math.round(v),
        q10: Math.round(payload.quantiles_30d[i][0]),
        q90: Math.round(payload.quantiles_30d[i][2]),
      })),
    [payload],
  );

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`fan-${payload.protocol}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1e2126" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fill: "#5f6670", fontSize: 10, fontFamily: "var(--font-jetbrains)" }}
            tickLine={false}
            axisLine={{ stroke: "#1e2126" }}
            interval={6}
          />
          <YAxis
            tick={{ fill: "#5f6670", fontSize: 10, fontFamily: "var(--font-jetbrains)" }}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(v: number) => fmtTvl(v)}
            domain={["auto", "auto"]}
          />
          <Tooltip
            contentStyle={{
              background: "#14171a",
              border: "1px solid #2a2e35",
              fontFamily: "var(--font-jetbrains)",
              fontSize: 11,
            }}
            labelFormatter={(d) => `Day ${d}`}
            formatter={(value, name) => [fmtTvl(Number(value)), name === "band" ? "q10–q90" : String(name)]}
          />
          <Area
            type="monotone"
            dataKey="band"
            data={data.map((d) => ({ ...d, band: [d.q10, d.q90] }))}
            stroke="none"
            fill={`url(#fan-${payload.protocol})`}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="median"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
