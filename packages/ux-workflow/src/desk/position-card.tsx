"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import { Card, CardContent } from "../primitives/card.js";
import { Badge } from "../primitives/badge.js";
import { Sparkline } from "../data/sparkline.js";

/**
 * PositionCard — single position with P&L and risk contribution.
 *
 * Built on shadcn/ui Card. Shows notional, P&L, risk contribution, and a
 * sparkline trend for a single LP position.
 */

export interface PositionCardProps extends React.ComponentProps<typeof Card> {
  pair: string;
  poolId?: string;
  notionalUsd: number;
  pnlUsd: number;
  pnlPct: number;
  riskContribution?: number; // % of portfolio risk
  sparklineData?: number[];
  status?: "active" | "pending" | "closed";
}

export function PositionCard({
  className,
  pair,
  poolId,
  notionalUsd,
  pnlUsd,
  pnlPct,
  riskContribution,
  sparklineData = [],
  status = "active",
  ...props
}: PositionCardProps) {
  const isPositive = pnlUsd >= 0;
  const pnlColor = isPositive ? "text-up" : "text-down";
  const sparkColor = isPositive ? "var(--tk-up)" : "var(--tk-down)";

  const formatMoney = (n: number) =>
    n >= 1e6
      ? `$${(n / 1e6).toFixed(2)}M`
      : n >= 1e3
        ? `$${(n / 1e3).toFixed(1)}K`
        : `$${n.toFixed(2)}`;

  return (
    <Card className={cn("", className)} {...props}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-mono text-sm font-semibold text-fg">{pair}</p>
              <Badge
                variant={
                  status === "active" ? "up" : status === "pending" ? "amber" : "default"
                }
              >
                {status}
              </Badge>
            </div>
            {poolId && (
              <p className="mt-0.5 font-mono text-[10px] text-fg-faint">{poolId}</p>
            )}
          </div>
          {sparklineData.length > 0 && (
            <Sparkline data={sparklineData} width={60} height={24} color={sparkColor} />
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-fg-faint">Notional</p>
            <p className="font-mono text-sm font-semibold tabular-nums text-fg">
              {formatMoney(notionalUsd)}
            </p>
          </div>
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-fg-faint">P&L</p>
            <p className={cn("font-mono text-sm font-semibold tabular-nums", pnlColor)}>
              {isPositive ? "+" : ""}{formatMoney(pnlUsd)}
            </p>
            <p className={cn("font-mono text-[10px] tabular-nums", pnlColor)}>
              {isPositive ? "+" : ""}{pnlPct.toFixed(2)}%
            </p>
          </div>
        </div>

        {riskContribution !== undefined && (
          <div className="mt-3 border-t border-edge-2 pt-2">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-fg-faint">
                Risk Contribution
              </p>
              <p className="font-mono text-xs font-semibold tabular-nums text-fg">
                {(riskContribution * 100).toFixed(1)}%
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
