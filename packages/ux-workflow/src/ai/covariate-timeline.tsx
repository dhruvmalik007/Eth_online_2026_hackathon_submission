"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import { Card, CardContent, CardHeader, CardTitle } from "../primitives/card.js";

/**
 * CovariateTimeline — visualizes which features TimesFM-3 used.
 *
 * Built on shadcn/ui Card as the container.
 *
 * Distinguishes:
 * - Past covariates: features only known historically (e.g., past foot traffic)
 * - Past-future (dynamic) covariates: known future events (e.g., promotions, FOMC)
 *
 * TimesFM-3 uses a "lookahead" strategy for past-future covariates: each token
 * concatenates the current patch with future patches, allowing the model to peek
 * at upcoming known signals.
 */

export interface CovariateItem {
  id: string;
  label: string;
  type: "past" | "future";
  description?: string;
  active?: boolean;
}

export interface CovariateTimelineProps extends React.ComponentProps<typeof Card> {
  items: CovariateItem[];
  horizonLabel?: string;
}

export function CovariateTimeline({
  className,
  items,
  horizonLabel = "Forecast horizon",
  ...props
}: CovariateTimelineProps) {
  const pastItems = items.filter((i) => i.type === "past");
  const futureItems = items.filter((i) => i.type === "future");

  return (
    <Card className={cn("", className)} {...props}>
      <CardHeader className="pb-2">
        <CardTitle>Covariates</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Timeline bar */}
        <div className="relative">
          <div className="h-1 w-full bg-edge-2" />
          <div className="absolute right-0 top-0 h-1 bg-amber/40" style={{ width: "33%" }} />
          <div className="mt-1 flex justify-between font-mono text-[9px] text-fg-faint">
            <span>History</span>
            <span className="text-amber">{horizonLabel}</span>
          </div>
        </div>

        {/* Past covariates */}
        {pastItems.length > 0 && (
          <div>
            <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-fg-faint">
              Past covariates
            </p>
            <div className="flex flex-wrap gap-1.5">
              {pastItems.map((item) => (
                <span
                  key={item.id}
                  className="border border-edge-2 bg-panel-2 px-2 py-1 font-mono text-[10px] text-fg-dim"
                  title={item.description}
                >
                  {item.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Future covariates */}
        {futureItems.length > 0 && (
          <div>
            <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-fg-faint">
              Past-future covariates (lookahead)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {futureItems.map((item) => (
                <span
                  key={item.id}
                  className={cn(
                    "border px-2 py-1 font-mono text-[10px]",
                    item.active ?? true
                      ? "border-amber/40 bg-amber/10 text-amber"
                      : "border-edge-2 bg-panel-2 text-fg-faint",
                  )}
                  title={item.description}
                >
                  {item.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
