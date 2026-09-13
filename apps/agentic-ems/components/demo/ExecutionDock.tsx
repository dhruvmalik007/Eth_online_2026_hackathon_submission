"use client";

import * as React from "react";
import { ChevronUp } from "lucide-react";

/**
 * ExecutionDock — the minimised execution.
 *
 * The brief asked for the run to be put in the background and keep going while
 * the user does something else in the chat. So this is not a toast that
 * disappears: it is a persistent, expandable status pill that keeps the live step
 * and progress visible without occupying the conversation.
 */

export interface ExecutionDockProps {
  currentLabel?: string;
  confirmed: number;
  total: number;
  failed?: boolean;
  /** The run finished — the dock must not still claim to be executing. */
  settled?: boolean;
  onExpand: () => void;
}

export function ExecutionDock({
  currentLabel,
  confirmed,
  total,
  failed = false,
  settled = false,
  onExpand,
}: ExecutionDockProps) {
  const pct = total > 0 ? Math.round((confirmed / total) * 100) : 0;
  const status = failed ? "stopped" : settled ? "settled" : "executing";

  return (
    <button
      type="button"
      onClick={onExpand}
      className="group flex w-full items-center gap-3 border border-amber/40 bg-panel px-3 py-2 text-left hover:border-amber"
      aria-label={`Execution ${status}, ${confirmed} of ${total} steps complete. Expand.`}
    >
      <span className="flex items-center gap-2">
        <span
          className={`size-1.5 rounded-full ${
            failed ? "bg-down" : settled ? "bg-up" : "animate-pulse-subtle bg-amber"
          }`}
          aria-hidden
        />
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.14em] ${
            failed ? "text-down" : settled ? "text-up" : "text-amber"
          }`}
        >
          {status}
        </span>
      </span>

      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-fg-dim">
        {currentLabel ?? "working…"}
      </span>

      <span className="relative h-1 w-20 shrink-0 bg-edge">
        <span
          className="absolute inset-y-0 left-0 bg-amber transition-all"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="font-mono text-[10px] tabular-nums text-fg-faint">
        {confirmed}/{total}
      </span>
      <ChevronUp className="size-3.5 shrink-0 text-fg-faint group-hover:text-amber" aria-hidden />
    </button>
  );
}
