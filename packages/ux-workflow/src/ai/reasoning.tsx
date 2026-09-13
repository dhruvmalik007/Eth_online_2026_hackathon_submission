"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";

/**
 * Reasoning — collapsible chain-of-thought display.
 * For reasoning models (o1-style) that expose their thinking process.
 */
export function Reasoning({
  className,
  children,
  defaultOpen = false,
  title = "Reasoning",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  defaultOpen?: boolean;
  title?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div className={cn("border border-edge bg-panel text-fg", className)} {...props}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.16em] text-fg-dim hover:text-amber"
      >
        <span>{title}</span>
        <span className="text-fg-faint">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="border-t border-edge-2 px-3 py-2 font-mono text-xs leading-relaxed text-fg-dim">
          {children}
        </div>
      )}
    </div>
  );
}
