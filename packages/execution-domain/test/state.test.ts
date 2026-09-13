/**
 * The run lifecycle and the step vocabulary.
 *
 * The transitions are the safety net for the whole service: every status write
 * goes through `assertTransition`, so these tests are what stop an illegal state
 * reaching the dashboard.
 */
import { describe, expect, it } from "vitest";
import {
  IllegalTransitionError,
  RUN_STATES,
  STEP_STATES,
  assertTransition,
  canTransition,
  isRunInFlight,
  isRunTerminal,
  isStepTerminal,
  nextStates,
} from "../src/index.js";

describe("the run lifecycle", () => {
  it("walks the path a run actually takes", () => {
    const path = [
      "draft",
      "simulating",
      "ranked",
      "awaiting_user",
      "signed",
      "submitting",
      "submitted",
      "confirmed",
      "reconciling",
      "holding",
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(() => assertTransition(path[i]!, path[i + 1]!)).not.toThrow();
    }
  });

  it("lets a user rejection return to draft", () => {
    expect(canTransition("awaiting_user", "draft")).toBe(true);
  });

  it("lets a risk breach start a new run from holding", () => {
    // The point of the event-driven model: `holding` is resting, not running,
    // so a breach can begin a fresh run with nobody logged in.
    expect(canTransition("holding", "draft")).toBe(true);
    expect(isRunInFlight("holding")).toBe(false);
  });

  it("lets a cross-chain run enter bridging from either side", () => {
    expect(canTransition("submitting", "bridging")).toBe(true);
    expect(canTransition("bridging", "submitted")).toBe(true);
  });

  it("refuses to skip simulation", () => {
    expect(canTransition("draft", "signed")).toBe(false);
    expect(() => assertTransition("draft", "signed")).toThrow(IllegalTransitionError);
  });

  it("refuses to move out of a terminal state", () => {
    for (const terminal of ["closed", "failed"] as const) {
      expect(nextStates(terminal)).toEqual([]);
      expect(() => assertTransition(terminal, "draft")).toThrow(IllegalTransitionError);
    }
  });

  it("names what was allowed, so a failure is actionable", () => {
    expect(() => assertTransition("draft", "closed")).toThrow(/simulating/);
    expect(() => assertTransition("closed", "draft")).toThrow(/terminal/);
  });

  it("classifies terminal and in-flight states", () => {
    expect(isRunTerminal("closed")).toBe(true);
    expect(isRunTerminal("failed")).toBe(true);
    expect(isRunTerminal("holding")).toBe(false);
    expect(isRunInFlight("bridging")).toBe(true);
    expect(isRunInFlight("reconciling")).toBe(true);
    expect(isRunInFlight("draft")).toBe(false);
  });

  it("gives every declared state a transition row", () => {
    // A state with no row would be unreachable or inescapable at runtime.
    for (const state of RUN_STATES) {
      expect(() => nextStates(state)).not.toThrow();
    }
  });
});

describe("the step vocabulary", () => {
  it("keeps bridging distinct from submitted", () => {
    // A cross-chain leg spends real minutes in flight — its own state, not a
    // slow `submitted`.
    expect(STEP_STATES).toContain("bridging");
    expect(isStepTerminal("bridging")).toBe(false);
    expect(isStepTerminal("submitted")).toBe(false);
  });

  it("treats confirmed, failed and skipped as terminal", () => {
    expect(isStepTerminal("confirmed")).toBe(true);
    expect(isStepTerminal("failed")).toBe(true);
    expect(isStepTerminal("skipped")).toBe(true);
    expect(isStepTerminal("signing")).toBe(false);
    expect(isStepTerminal("queued")).toBe(false);
  });
});
