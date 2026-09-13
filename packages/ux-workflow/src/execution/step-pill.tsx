"use client";

import { cn } from "../lib/utils.js";
import { Badge } from "../primitives/badge.js";

/**
 * The one status vocabulary every execution surface uses. `operate.md`'s rule
 * is that a component ships all of its states; this is the single source for
 * them, so the timeline, the dock and the receipt can never disagree.
 */
export type ExecutionStepState =
  | "queued"
  | "signing"
  | "submitted"
  | "bridging"
  | "confirmed"
  | "failed"
  | "skipped";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "amber" | "up" | "down" | "graph" | "oneinch" | "uniswap";

const STATE_META: Record<ExecutionStepState, { label: string; variant: BadgeVariant }> = {
  queued: { label: "queued", variant: "default" },
  signing: { label: "signing", variant: "amber" },
  submitted: { label: "submitted", variant: "amber" },
  // Cross-chain legs spend real time in flight; that is its own state, not a
  // slow "submitted" — it is the stage where bridged value has left the source.
  bridging: { label: "bridging", variant: "graph" },
  confirmed: { label: "confirmed", variant: "up" },
  failed: { label: "failed", variant: "down" },
  skipped: { label: "skipped", variant: "outline" },
};

/** Dot colour for the timeline rail — same semantics as the badge. */
export const STATE_DOT: Record<ExecutionStepState, string> = {
  queued: "bg-fg-faint",
  signing: "bg-amber",
  submitted: "bg-amber",
  bridging: "bg-graph",
  confirmed: "bg-up",
  failed: "bg-down",
  skipped: "bg-edge-2",
};

export interface StepPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  state: ExecutionStepState;
}

export function StepPill({ state, className, ...props }: StepPillProps) {
  const meta = STATE_META[state];
  return (
    <Badge variant={meta.variant} className={cn(className)} {...props}>
      {meta.label}
    </Badge>
  );
}

/** Human label for a step state, for use in aria text and summaries. */
export function stepStateLabel(state: ExecutionStepState): string {
  return STATE_META[state].label;
}

/** True for states that will not change again without new user action. */
export function isTerminal(state: ExecutionStepState): boolean {
  return state === "confirmed" || state === "failed" || state === "skipped";
}
