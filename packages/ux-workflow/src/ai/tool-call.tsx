"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";

/**
 * ToolCall — displays a tool invocation in the conversation.
 * Shows tool name + arguments in a structured card with status indicator.
 */
export interface ToolCallProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  args?: Record<string, unknown>;
  status?: "pending" | "running" | "success" | "error";
}

const statusStyles: Record<string, string> = {
  pending: "border-edge-2 text-fg-dim",
  running: "border-amber/50 text-amber",
  success: "border-up/40 text-up",
  error: "border-down/40 text-down",
};

export function ToolCall({ className, name, args, status = "success", ...props }: ToolCallProps) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className={cn("border bg-panel text-fg", statusStyles[status], className)} {...props}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="font-mono text-xs font-semibold text-fg">⚙ {name}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
          {status} {expanded ? "−" : "+"}
        </span>
      </button>
      {expanded && args && (
        <pre className="border-t border-edge-2 bg-panel-2 p-3 font-mono text-[11px] leading-relaxed text-fg-dim">
          {JSON.stringify(args, null, 2)}
        </pre>
      )}
    </div>
  );
}

/**
 * ToolResult — displays the output of a tool call.
 */
export function ToolResult({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "border border-edge-2 bg-panel-2 p-3 font-mono text-xs leading-relaxed text-fg-dim",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
