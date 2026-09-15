import type { FlowAccent } from "@ethonline2026/ux-workflow";

/**
 * The console's run lifecycle, as one table.
 *
 * Everything reads this: the reducer folds over it, the state diagram is drawn from it, and the
 * entry cards take their accent from it. That is the point. A state machine that exists only in a
 * diagram drifts from the code the first time someone adds a branch, and a machine that exists only
 * in the code cannot be explained to anyone. One table, two projections.
 *
 * `machine.test.ts` holds the two together — unreachable states, dangling targets, and a diagram
 * that omits a transition are all build failures.
 *
 * Design: ~/.commandcode/plans/indexer-console-v2-component-plan.md
 */

export type RunState =
  | "idle"
  | "composing"
  | "invalid"
  | "submitting"
  | "running"
  | "ok"
  | "partial"
  | "unavailable"
  | "refused"
  | "failed";

export type RunEvent =
  | "select"
  | "deselect"
  | "submit"
  | "reject"
  | "fix"
  | "accept"
  | "settle-ok"
  | "settle-partial"
  | "settle-unavailable"
  | "settle-refused"
  | "settle-failed"
  | "revise"
  | "retry";

export interface RunStateSpec {
  readonly id: RunState;
  readonly label: string;
  /** The state's tone, used by the diagram's accent bar and by a settled entry's marker. */
  readonly accent: FlowAccent;
  /** Column in the diagram. Explicit, because the lifecycle's shape is a decision, not an inference. */
  readonly column: number;
  /** True when nothing follows but a deliberate revision. */
  readonly terminal: boolean;
  /** What this state means and who acts on it. Shown in the hover card and the transitions panel. */
  readonly description: string;
}

export const RUN_STATES: readonly RunStateSpec[] = [
  {
    id: "idle",
    label: "idle",
    accent: "faint",
    column: 0,
    terminal: false,
    description: "Nothing selected. The console is waiting for a command.",
  },
  {
    id: "composing",
    label: "composing",
    accent: "amber",
    column: 1,
    terminal: false,
    description: "A command is chosen and its arguments are being set.",
  },
  {
    id: "invalid",
    label: "invalid",
    accent: "down",
    column: 2,
    terminal: false,
    description: "The arguments cannot be sent — a required one is missing. The caller acts.",
  },
  {
    id: "submitting",
    label: "submitting",
    accent: "amber",
    column: 2,
    terminal: false,
    description: "The request is in flight, with no answer yet.",
  },
  {
    id: "running",
    label: "running",
    accent: "amber",
    column: 3,
    terminal: false,
    description: "The request was accepted and the work is happening upstream.",
  },
  {
    id: "ok",
    label: "ok",
    accent: "up",
    column: 4,
    terminal: true,
    description: "The payload arrived complete. Nobody needs to act.",
  },
  {
    id: "partial",
    label: "partial",
    accent: "amber",
    column: 4,
    terminal: true,
    description: "The request succeeded and the data itself is thin or degraded. The operator acts.",
  },
  {
    id: "unavailable",
    label: "unavailable",
    accent: "faint",
    column: 4,
    terminal: true,
    description:
      "A dependency this command needs is not configured on this deployment. The operator acts, once.",
  },
  {
    id: "refused",
    label: "refused",
    accent: "down",
    column: 4,
    terminal: true,
    description: "This caller or this request is not acceptable. The caller acts.",
  },
  {
    id: "failed",
    label: "failed",
    accent: "down",
    column: 4,
    terminal: true,
    description: "The system broke. Retrying is reasonable because the request was not the problem.",
  },
] as const;

export interface Transition {
  readonly from: RunState;
  readonly on: RunEvent;
  readonly to: RunState;
  /** Why this edge exists. Rendered in the transitions panel, so it has to read as prose. */
  readonly description: string;
}

export const TRANSITIONS: readonly Transition[] = [
  {
    from: "idle",
    on: "select",
    to: "composing",
    description: "A command is picked from the menu.",
  },
  {
    from: "composing",
    on: "deselect",
    to: "idle",
    description: "The composer is emptied without sending anything.",
  },
  {
    from: "composing",
    on: "submit",
    to: "submitting",
    description: "The arguments are complete, so the request goes out.",
  },
  {
    from: "composing",
    on: "reject",
    to: "invalid",
    description: "A required argument is missing; nothing is sent.",
  },
  {
    from: "invalid",
    on: "fix",
    to: "composing",
    description: "The missing argument is supplied.",
  },
  {
    from: "submitting",
    on: "accept",
    to: "running",
    description: "The deployment took the request and is working on it.",
  },
  {
    from: "running",
    on: "settle-ok",
    to: "ok",
    description: "200, with a payload that reports a complete answer.",
  },
  {
    from: "running",
    on: "settle-partial",
    to: "partial",
    description: "200, but the payload says it is empty or degraded.",
  },
  {
    from: "running",
    on: "settle-unavailable",
    to: "unavailable",
    description: "503 carrying a typed `*_UNAVAILABLE` code — a dependency, not a bug.",
  },
  {
    from: "running",
    on: "settle-refused",
    to: "refused",
    description: "400 or 401: the request or the caller was rejected.",
  },
  {
    from: "running",
    on: "settle-failed",
    to: "failed",
    description: "5xx, transport failure, or a body that would not parse.",
  },
  {
    from: "ok",
    on: "revise",
    to: "composing",
    description: "Ask something else from the answer that worked.",
  },
  {
    from: "partial",
    on: "revise",
    to: "composing",
    description: "Try a different subject or range, since this one came back thin.",
  },
  {
    from: "unavailable",
    on: "revise",
    to: "composing",
    description: "Try a command whose dependency this deployment does have.",
  },
  {
    from: "refused",
    on: "revise",
    to: "composing",
    description: "Correct the request and send it again.",
  },
  {
    from: "failed",
    on: "retry",
    to: "submitting",
    description: "Send the same request again — the request was not what failed.",
  },
] as const;

const SPECS = new Map<RunState, RunStateSpec>(RUN_STATES.map((spec) => [spec.id, spec]));

export function specOf(state: RunState): RunStateSpec {
  const spec = SPECS.get(state);
  // Unreachable for a `RunState`, and the table is the only thing that can widen one. Throwing beats
  // returning a default that would quietly render an unknown state as if it were idle.
  if (spec === undefined) throw new Error(`no spec for run state ${state}`);
  return spec;
}

/** The state an event leads to, or null when the table has nothing to say about the pair. */
export function next(state: RunState, event: RunEvent): RunState | null {
  return TRANSITIONS.find((t) => t.from === state && t.on === event)?.to ?? null;
}

/** Every transition leaving a state, in table order. */
export function transitionsFrom(state: RunState): readonly Transition[] {
  return TRANSITIONS.filter((t) => t.from === state);
}

/** Every transition arriving at a state — the back-edges a left-to-right canvas cannot draw. */
export function transitionsInto(state: RunState): readonly Transition[] {
  return TRANSITIONS.filter((t) => t.to === state);
}

/**
 * The transitions a left-to-right canvas can draw honestly.
 *
 * The engine places columns and draws ribbons from a node's right edge to the next node's left, so
 * an edge pointing backwards collapses to a one-pixel sliver. `invalid → composing` and every
 * `settled → composing` are real and are shown in the transitions panel instead of being drawn as
 * something they are not.
 */
export function forwardTransitions(): readonly Transition[] {
  return TRANSITIONS.filter(
    (t) => specOf(t.to).column > specOf(t.from).column,
  );
}
