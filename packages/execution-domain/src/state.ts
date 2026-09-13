/**
 * The execution vocabulary: step states and the run lifecycle.
 *
 * Two vocabularies live here because they answer different questions. A **step
 * state** says what one transaction is doing; a **run state** says where a whole
 * strategy execution has got to. A run in `holding` still contains steps that
 * are `confirmed` — conflating them would lose that.
 *
 * ## Why the step vocabulary is defined here
 *
 * It was previously declared inside a React component
 * (`packages/ux-workflow/src/execution/step-pill.tsx`). The execution service is
 * a server process and must not import React to learn a string union, so the
 * canonical definition lives here and the UI package is expected to re-export
 * it. The values are identical, and `bridging` is deliberately its own state:
 * a cross-chain leg spends real minutes in flight, which is not a slow
 * `submitted`.
 *
 * Transitions are data, not branching. Every state change in the service goes
 * through {@link assertTransition}, so an illegal move fails loudly instead of
 * writing a status the dashboard cannot interpret.
 */
import { z } from "zod";

// ── Step states ─────────────────────────────────────────────────────────────

/** The single status vocabulary every execution surface uses. */
export const STEP_STATES = [
  "queued",
  "signing",
  "submitted",
  "bridging",
  "confirmed",
  "failed",
  "skipped",
] as const;

export type ExecutionStepState = (typeof STEP_STATES)[number];

export const ExecutionStepStateSchema = z.enum(STEP_STATES);

/** A step that will not change again. */
const TERMINAL_STEP_STATES: ReadonlySet<ExecutionStepState> = new Set([
  "confirmed",
  "failed",
  "skipped",
]);

export function isStepTerminal(state: ExecutionStepState): boolean {
  return TERMINAL_STEP_STATES.has(state);
}

// ── Run lifecycle ───────────────────────────────────────────────────────────

/**
 * Where a strategy execution has got to.
 *
 * `holding` is **resting, not running**: the strategy sits invested until the
 * risk engine reports a breached threshold. That is why it can return to
 * `draft` — and why nothing has to be in flight for a rebalance to start.
 */
export const RUN_STATES = [
  "draft",
  "simulating",
  "ranked",
  "awaiting_user",
  "signed",
  "submitting",
  "bridging",
  "submitted",
  "confirmed",
  "reconciling",
  "holding",
  "unwinding",
  "closed",
  "failed",
] as const;

export type RunState = (typeof RUN_STATES)[number];

export const RunStateSchema = z.enum(RUN_STATES);

/**
 * The legal moves. Anything absent is a bug in the caller, not a state to
 * tolerate.
 *
 * `awaiting_user → draft` is a rejection (recorded, with the reason);
 * `holding → draft` is a risk-engine breach starting a new run.
 */
const RUN_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  draft: ["simulating"],
  simulating: ["ranked", "failed"],
  ranked: ["awaiting_user"],
  awaiting_user: ["signed", "draft"],
  signed: ["submitting"],
  // A run may reach `bridging` directly when its first leg is cross-chain, or
  // only after some legs are already `submitted`.
  submitting: ["submitted", "bridging", "failed"],
  bridging: ["submitted", "failed"],
  submitted: ["confirmed", "failed"],
  confirmed: ["reconciling"],
  reconciling: ["holding"],
  holding: ["draft", "unwinding"],
  unwinding: ["closed", "failed"],
  closed: [],
  failed: [],
};

/** A run that has finished and will not move again. */
const TERMINAL_RUN_STATES: ReadonlySet<RunState> = new Set(["closed", "failed"]);

export function isRunTerminal(state: RunState): boolean {
  return TERMINAL_RUN_STATES.has(state);
}

/**
 * Whether a run is mid-execution — the states the dashboard's "still in flight"
 * panel cares about. `holding` is excluded on purpose: the position is open but
 * nothing is running.
 */
const RUN_STATES_IN_FLIGHT: ReadonlySet<RunState> = new Set([
  "signed",
  "submitting",
  "bridging",
  "submitted",
  "confirmed",
  "reconciling",
  "unwinding",
]);

export function isRunInFlight(state: RunState): boolean {
  return RUN_STATES_IN_FLIGHT.has(state);
}

export function canTransition(from: RunState, to: RunState): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

/** The states reachable from `state`, for error messages and for tests. */
export function nextStates(state: RunState): readonly RunState[] {
  return RUN_TRANSITIONS[state];
}

/** An attempt to move a run somewhere it cannot go. */
export class IllegalTransitionError extends Error {
  readonly from: RunState;
  readonly to: RunState;

  constructor(from: RunState, to: RunState, allowed: readonly RunState[]) {
    super(
      `Illegal run transition ${from} → ${to}. ` +
        `From ${from} a run may only go to: ${allowed.length > 0 ? allowed.join(", ") : "(nothing — terminal)"}.`,
    );
    this.name = "IllegalTransitionError";
    this.from = from;
    this.to = to;
  }
}

/**
 * Assert that a transition is legal.
 *
 * Called before every status write so an illegal move can never reach the
 * database — where it would be indistinguishable from a real state the
 * dashboard would then try to render.
 *
 * @throws {IllegalTransitionError}
 */
export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to, RUN_TRANSITIONS[from]);
  }
}
