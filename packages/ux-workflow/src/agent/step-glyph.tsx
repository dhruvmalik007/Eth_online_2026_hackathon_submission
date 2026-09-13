"use client";

import { cn } from "../lib/utils.js";

/**
 * One status vocabulary for every agent step, shared by the chat tool group and
 * the simulation fan-out so the two surfaces can never disagree about what
 * "running" looks like.
 */
export type AgentStepState = "queued" | "running" | "done" | "failed";

const GLYPH: Record<AgentStepState, string> = {
  queued: "○",
  running: "◐",
  done: "●",
  failed: "✕",
};

const TONE: Record<AgentStepState, string> = {
  queued: "text-fg-faint",
  running: "text-amber",
  done: "text-up",
  failed: "text-down",
};

const LABEL: Record<AgentStepState, string> = {
  queued: "queued",
  running: "running",
  done: "done",
  failed: "failed",
};

export interface StepGlyphProps {
  state: AgentStepState;
  /** Show the word next to the glyph (used in the expanded drawer). */
  withLabel?: boolean;
  className?: string;
}

export function StepGlyph({ state, withLabel = false, className }: StepGlyphProps) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 font-mono text-[10px]", TONE[state], className)}
    >
      <span
        className={cn(state === "running" && "animate-pulse-subtle")}
        aria-hidden
      >
        {GLYPH[state]}
      </span>
      {withLabel ? <span className="uppercase tracking-[0.14em]">{LABEL[state]}</span> : null}
      <span className="sr-only">{LABEL[state]}</span>
    </span>
  );
}

/** Human label for a step state. Named distinctly from the execution vocabulary. */
export function agentStepStateLabel(state: AgentStepState): string {
  return LABEL[state];
}
