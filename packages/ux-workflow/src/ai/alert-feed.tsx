"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import { ScrollArea } from "../primitives/scroll-area.js";
import { Badge } from "../primitives/badge.js";

/**
 * AlertFeed — real-time alerts: training complete, metric threshold breach, consensus conflict.
 */

export interface Alert {
  id: string;
  severity: "info" | "warning" | "error";
  message: string;
  timestamp: string;
}

export interface AlertFeedProps extends React.HTMLAttributes<HTMLDivElement> {
  alerts: Alert[];
}

export function AlertFeed({ className, alerts, ...props }: AlertFeedProps) {
  return (
    <ScrollArea className={cn("h-64", className)} {...(props as any)}>
      <div className="space-y-2">
        {alerts.length === 0 ? (
          <p className="py-8 text-center font-mono text-xs text-fg-faint">No alerts</p>
        ) : (
          alerts.map((alert) => (
            <div
              key={alert.id}
              className={cn(
                "border bg-panel-2 p-3",
                alert.severity === "error"
                  ? "border-down/40"
                  : alert.severity === "warning"
                    ? "border-amber/40"
                    : "border-edge-2",
              )}
            >
              <div className="flex items-center justify-between">
                <Badge
                  variant={
                    alert.severity === "error"
                      ? "down"
                      : alert.severity === "warning"
                        ? "amber"
                        : "default"
                  }
                >
                  {alert.severity}
                </Badge>
                <span className="font-mono text-[10px] text-fg-faint">{alert.timestamp}</span>
              </div>
              <p className="mt-2 font-mono text-xs leading-relaxed text-fg-dim">
                {alert.message}
              </p>
            </div>
          ))
        )}
      </div>
    </ScrollArea>
  );
}
