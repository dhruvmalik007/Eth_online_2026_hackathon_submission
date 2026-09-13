import * as React from "react";
import { cn } from "../lib/utils.js";

/**
 * Citation — source attribution block for AI-generated content.
 * Shows which data source (subgraph, block height) was used.
 */
export interface CitationProps extends React.HTMLAttributes<HTMLDivElement> {
  source: string;
  block?: string;
  timestamp?: string;
  confidence?: number;
}

export function Citation({ className, source, block, timestamp, confidence, ...props }: CitationProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-l-2 border-amber/40 bg-panel-2 px-3 py-2 font-mono text-[11px] text-fg-dim",
        className,
      )}
      {...props}
    >
      <span className="uppercase tracking-[0.12em] text-amber">Source</span>
      <span className="text-fg">{source}</span>
      {block && <span className="text-fg-faint">@ blk {block}</span>}
      {timestamp && <span className="text-fg-faint">{timestamp}</span>}
      {confidence !== undefined && (
        <span
          className={cn(
            "ml-auto",
            confidence > 0.8 ? "text-up" : confidence > 0.5 ? "text-amber" : "text-down",
          )}
        >
          {(confidence * 100).toFixed(0)}% conf
        </span>
      )}
    </div>
  );
}
