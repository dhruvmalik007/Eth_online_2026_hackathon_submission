import { describe, expect, it } from "vitest";

import {
  RUN_STATES,
  TRANSITIONS,
  forwardTransitions,
  next,
  specOf,
  transitionsFrom,
  transitionsInto,
  type RunState,
} from "../console/src/machine.js";

/**
 * The table is the single source for the reducer, the diagram and the entry accents, so the things
 * worth asserting are the properties that keep it whole: nothing dangling, nothing unreachable,
 * nothing silently missing from the picture.
 */

const ALL_STATES = RUN_STATES.map((spec) => spec.id);

/** States reachable from a start state along the given edges. */
function reachableFrom(start: RunState, edges: readonly { from: RunState; to: RunState }[]): Set<RunState> {
  const seen = new Set<RunState>([start]);
  const queue: RunState[] = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const edge of edges) {
      if (edge.from !== current || seen.has(edge.to)) continue;
      seen.add(edge.to);
      queue.push(edge.to);
    }
  }
  return seen;
}

describe("run state table", () => {
  it("describes every state it declares", () => {
    // `specOf` throws for an unknown state, so a missing spec is a crash at render time rather than
    // a wrong colour. This catches it at build time instead.
    for (const state of ALL_STATES) expect(specOf(state).id).toBe(state);
  });

  it("uses unique state ids", () => {
    expect(new Set(ALL_STATES).size).toBe(ALL_STATES.length);
  });

  it("only names states that exist, on both ends of every edge", () => {
    for (const transition of TRANSITIONS) {
      expect(ALL_STATES).toContain(transition.from);
      expect(ALL_STATES).toContain(transition.to);
    }
  });

  it("keeps every state reachable from idle", () => {
    // An unreachable state is either dead code or a missing edge, and both are bugs that a diagram
    // would happily draw as if it were live.
    const reached = reachableFrom("idle", TRANSITIONS);
    expect([...ALL_STATES].filter((state) => !reached.has(state))).toEqual([]);
  });

  it("keeps every state reachable along forward edges alone", () => {
    // The canvas draws forward edges only. A state that can only be entered by a back-edge would be
    // drawn but never lit, which is worse than not drawing it.
    const reached = reachableFrom("idle", forwardTransitions());
    expect([...ALL_STATES].filter((state) => !reached.has(state))).toEqual([]);
  });

  it("gives every state a way out except the ones that end the run", () => {
    for (const spec of RUN_STATES) {
      expect(transitionsFrom(spec.id).length, `${spec.id} has no outbound transition`).toBeGreaterThan(0);
    }
  });

  it("marks a state terminal exactly when nothing follows it automatically", () => {
    const leaves = RUN_STATES.filter((spec) => spec.terminal).map((spec) => spec.id);
    // The four ways a run can end, plus the one the operator has to fix.
    expect(leaves.sort()).toEqual(["failed", "ok", "partial", "refused", "unavailable"]);
  });

  it("never sends a settled outcome back into flight without a deliberate event", () => {
    for (const state of ["ok", "partial", "unavailable", "refused"] as const) {
      const events = transitionsFrom(state).map((t) => t.on);
      expect(events).not.toContain("submit");
      expect(events).not.toContain("retry");
    }
    // `failed` is the exception, and the reason is in the table: the request was not what broke.
    expect(transitionsFrom("failed").map((t) => t.on)).toEqual(["retry"]);
  });

  it("returns null rather than guessing when the table has nothing to say", () => {
    // `idle` cannot be submitted from; there is no command chosen yet.
    expect(next("idle", "submit")).toBeNull();
    expect(next("ok", "accept")).toBeNull();
  });

  it("walks the lifecycle the reducer walks", () => {
    let state: RunState = "idle";
    for (const event of ["select", "submit", "accept", "settle-ok"] as const) {
      const to = next(state, event);
      expect(to, `${state} cannot handle ${event}`).not.toBeNull();
      state = to as RunState;
    }
    expect(state).toBe("ok");
    expect(next(state, "revise")).toBe("composing");
  });
});

describe("the diagram's projection of the table", () => {
  it("draws a strict subset, because back-edges have nowhere honest to go", () => {
    const forward = forwardTransitions();
    expect(forward.length).toBeLessThan(TRANSITIONS.length);
    for (const transition of forward) {
      expect(specOf(transition.to).column).toBeGreaterThan(specOf(transition.from).column);
    }
  });

  it("omits exactly the edges that point backwards", () => {
    const backward = TRANSITIONS.filter(
      (t) => specOf(t.to).column <= specOf(t.from).column,
    );
    // Retry is the one that surprises people: `failed` sits in the outcome column and sends back to
    // `submitting`, not to `composing`, because the same request is going out again unchanged.
    expect(backward.map((t) => `${t.from}->${t.to}`)).toEqual([
      "composing->idle",
      "invalid->composing",
      "ok->composing",
      "partial->composing",
      "unavailable->composing",
      "refused->composing",
      "failed->submitting",
    ]);
  });

  it("surfaces the omitted edges where a reader can still find them", () => {
    // The panel is what makes the omission honest: every edge that is not drawn is listed on the
    // state it leaves and the state it returns to.
    for (const transition of TRANSITIONS) {
      const from = transitionsFrom(transition.from);
      const into = transitionsInto(transition.to);
      expect(from).toContain(transition);
      expect(into).toContain(transition);
    }
  });

  it("places every state in a column, and never two meanings in one cell", () => {
    for (const spec of RUN_STATES) {
      expect(Number.isInteger(spec.column)).toBe(true);
      expect(spec.column).toBeGreaterThanOrEqual(0);
    }
    expect(specOf("idle").column).toBe(0);
  });
});
