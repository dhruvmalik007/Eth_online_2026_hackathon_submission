"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import { ScrollArea } from "../primitives/scroll-area.js";
import { Badge } from "../primitives/badge.js";

/**
 * TraceViewer — displays LangSmith traces (agent decisions, tool calls, reasoning).
 */

export interface TraceEntry {
  id: string;
  timestamp: string;
  type: "tool_call" | "reasoning" | "decision";
  content: string;
  duration?: number;
  tokenCount?: number;
}

export interface TraceViewerProps extends React.HTMLAttributes<HTMLDivElement> {
  traces: TraceEntry[];
}

export function TraceViewer({ className, traces, ...props }: TraceViewerProps) {
  return (
    <ScrollArea className={cn("h-64", className)} {...(props as any)}>
      <div className="space-y-2">
        {traces.length === 0 ? (
          <p className="py-8 text-center font-mono text-xs text-fg-faint">No traces available</p>
        ) : (
          traces.map((trace) => (
            <div
              key={trace.id}
              className="border border-edge-2 bg-panel-2 p-3"
            >
              <div className="flex items-center justify-between">
                <Badge
                  variant={
                    trace.type === "tool_call"
                      ? "graph"
                      : trace.type === "reasoning"
                        ? "amber"
                        : "default"
                  }
                >
                  {trace.type.replace("_", " ")}
                </Badge>
                <div className="flex items-center gap-3">
                  {trace.duration !== undefined && (
                    <span className="font-mono text-[10px] text-fg-faint">{trace.duration}ms</span>
                  )}
                  {trace.tokenCount !== undefined && (
                    <span className="font-mono text-[10px] text-fg-faint">{trace.tokenCount} tok</span>
                  )}
                  <span className="font-mono text-[10px] text-fg-faint">{trace.timestamp}</span>
                </div>
              </div>
              <p className="mt-2 font-mono text-xs leading-relaxed text-fg-dim">
                {trace.content}
              </p>
            </div>
          ))
        )}
      </div>
    </ScrollArea>
  );
}
