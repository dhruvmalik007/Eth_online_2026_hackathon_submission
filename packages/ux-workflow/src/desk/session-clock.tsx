"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import { Card, CardHeader, CardTitle, CardContent } from "../primitives/card.js";
import { Badge } from "../primitives/badge.js";

/**
 * SessionClock — market-phase indicator with test-state initialization.
 *
 * Built on shadcn/ui Card. Shows current market phase (PRE_MARKET/REGULAR/etc)
 * and supports three initialization modes: live, replay, simulate.
 *
 * Per the observation report §4.1: in a production desk, the session clock is
 * driven by exchange calendars and market data timestamps — not wall-clock UTC.
 */

export type MarketPhase = "PRE_MARKET" | "REGULAR" | "POST_MARKET" | "CLOSED" | "HOLIDAY";
export type SessionPhase = "MON_MACRO" | "ALPHA_CAPTURE" | "FRI_DEFENSIVE";

export interface SessionClockProps extends React.ComponentProps<typeof Card> {
  sessionDate: string;
  sessionPhase: SessionPhase;
  marketPhase: MarketPhase;
  mode: "live" | "replay" | "simulate";
  exchange?: string;
  onModeChange?: (mode: "live" | "replay" | "simulate") => void;
}

const phaseBadge: Record<MarketPhase, { variant: "amber" | "up" | "down" | "default" | "graph"; label: string }> = {
  PRE_MARKET: { variant: "amber", label: "Pre-Market" },
  REGULAR: { variant: "up", label: "Regular" },
  POST_MARKET: { variant: "graph", label: "Post-Market" },
  CLOSED: { variant: "default", label: "Closed" },
  HOLIDAY: { variant: "down", label: "Holiday" },
};

const phaseConstraints: Record<SessionPhase, { betaFloor: number; gammaFeeBumpBps: number; varLimitPct: number }> = {
  MON_MACRO: { betaFloor: 0.6, gammaFeeBumpBps: 0, varLimitPct: 5 },
  ALPHA_CAPTURE: { betaFloor: 0.5, gammaFeeBumpBps: 0, varLimitPct: 4 },
  FRI_DEFENSIVE: { betaFloor: 0.8, gammaFeeBumpBps: 15, varLimitPct: 2 },
};

export function SessionClock({
  className,
  sessionDate,
  sessionPhase,
  marketPhase,
  mode,
  exchange = "NYSE",
  onModeChange,
  ...props
}: SessionClockProps) {
  const badge = phaseBadge[marketPhase];
  const constraints = phaseConstraints[sessionPhase];

  return (
    <Card className={cn("", className)} {...props}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>Session Clock</CardTitle>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Date and phase */}
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs text-fg">{sessionDate}</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
              {sessionPhase.replace("_", " ")} · {exchange}
            </p>
          </div>
          <Badge
            variant={mode === "live" ? "up" : mode === "replay" ? "amber" : "graph"}
          >
            {mode}
          </Badge>
        </div>

        {/* Mode selector */}
        {onModeChange && (
          <div className="flex gap-1.5">
            {(["live", "replay", "simulate"] as const).map((m) => (
              <button
                key={m}
                onClick={() => onModeChange(m)}
                className={cn(
                  "flex-1 border px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em]",
                  mode === m
                    ? "border-amber/50 bg-amber/10 text-amber"
                    : "border-edge-2 bg-panel-2 text-fg-dim",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {/* Phase constraints */}
        <div className="grid grid-cols-3 gap-2 border-t border-edge-2 pt-3">
          <div className="text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-fg-faint">β Floor</p>
            <p className="font-mono text-sm font-semibold text-fg">{(constraints.betaFloor * 100).toFixed(0)}%</p>
          </div>
          <div className="text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-fg-faint">γ Bump</p>
            <p className="font-mono text-sm font-semibold text-fg">{constraints.gammaFeeBumpBps}bps</p>
          </div>
          <div className="text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-fg-faint">VaR</p>
            <p className="font-mono text-sm font-semibold text-fg">{constraints.varLimitPct}%</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
