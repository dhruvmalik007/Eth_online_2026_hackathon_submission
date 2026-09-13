"use client";

import { cn } from "../lib/utils.js";
import { Citation } from "../ai/citation.js";
import { Sparkline } from "../data/sparkline.js";

/**
 * SeriesPreview — the agent's reference to the time-series data behind a query.
 *
 * A forecast step is otherwise an unfalsifiable claim ("the 30-day path is
 * stable"). This renders the actual series, and when quantiles are available the
 * q10–q90 band around the median, so the claim can be read rather than trusted.
 *
 * Uses the dependency-free SVG Sparkline for a plain series and draws the band
 * inline only when quantiles exist — no charting library is pulled in for this.
 */

export interface SeriesPreviewProps {
  label: string;
  /** The central path (median / realised series). */
  values: number[];
  /** Optional [q10, q50, q90] per point. */
  band?: [number, number, number][];
  horizonLabel?: string;
  /** Current value, drawn as a reference marker. */
  current?: number;
  provenance?: { source: string; block?: string; timestamp?: string; confidence?: number };
  width?: number;
  height?: number;
  className?: string;
}

function fmt(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(2);
}

export function SeriesPreview({
  label,
  values,
  band,
  horizonLabel,
  current,
  provenance,
  width = 260,
  height = 56,
  className,
}: SeriesPreviewProps) {
  if (values.length < 2) return null;

  const lows = band?.map((b) => b[0]) ?? [];
  const highs = band?.map((b) => b[2]) ?? [];
  const all = [...values, ...lows, ...highs, ...(current !== undefined ? [current] : [])];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;

  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => height - ((v - min) / range) * height;

  const medianPath = values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
  const bandPath =
    band && band.length === values.length
      ? [
          `M ${band.map((b, i) => `${x(i)} ${y(b[2])}`).join(" L ")}`,
          `L ${[...band].reverse().map((b, i) => `${x(band.length - 1 - i)} ${y(b[0])}`).join(" L ")}`,
          "Z",
        ].join(" ")
      : null;

  const last = values[values.length - 1];
  const change = ((last - values[0]) / (values[0] || 1)) * 100;

  return (
    <div className={cn("border border-edge-2 bg-panel-2", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-edge px-2.5 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
          {label}
        </span>
        <span className="flex items-center gap-2 font-mono text-[10px] tabular-nums text-fg-faint">
          {horizonLabel ? <span>{horizonLabel}</span> : null}
          <span className={change >= 0 ? "text-up" : "text-down"}>
            {change >= 0 ? "+" : ""}
            {change.toFixed(2)}%
          </span>
        </span>
      </div>

      <div className="px-2.5 py-2">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full overflow-visible"
          role="img"
          aria-label={`${label}${horizonLabel ? `, ${horizonLabel}` : ""}, ${values.length} points`}
        >
          {/* q10–q90 band. At 0.13 opacity this was effectively invisible — and it
              is the most decision-relevant mark in the component, so it gets a
              visible fill plus an edge stroke. */}
          {bandPath ? (
            <>
              <path d={bandPath} fill="var(--tk-amber)" opacity={0.22} />
              <path d={bandPath} fill="none" stroke="var(--tk-amber)" strokeWidth={0.75} opacity={0.5} />
            </>
          ) : null}

          {/* current-value reference */}
          {current !== undefined ? (
            <line
              x1={0}
              x2={width}
              y1={y(current)}
              y2={y(current)}
              stroke="var(--tk-fg-faint)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          ) : null}

          {/* median path */}
          <path
            d={medianPath}
            fill="none"
            stroke="var(--tk-amber)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] tabular-nums text-fg-faint">
          <span>min {fmt(min)}</span>
          {band ? <span>q10–q90 band</span> : null}
          {current !== undefined ? <span>now {fmt(current)}</span> : null}
          <span>max {fmt(max)}</span>
        </div>
      </div>

      {provenance ? (
        <div className="px-2.5 pb-2.5">
          <Citation {...provenance} className="border-l-0 border-t-2 border-t-amber/40 px-0 py-1.5" />
        </div>
      ) : null}
    </div>
  );
}

/** Compact inline series for a collapsed row — no frame, no provenance. */
export function SeriesSpark({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) {
  if (values.length < 2) return null;
  return (
    <Sparkline
      data={values}
      width={64}
      height={16}
      color="var(--tk-amber)"
      className={className}
      aria-hidden
    />
  );
}
