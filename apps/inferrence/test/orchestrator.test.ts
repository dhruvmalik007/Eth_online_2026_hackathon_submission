import { describe, expect, it } from "vitest";
import { makeRuntime, USER } from "./helpers.js";

describe("Orchestrator", () => {
  it("streams an ordered turn and rests awaiting approval", async () => {
    const runtime = makeRuntime();
    const session = await runtime.sessions.open({ userId: USER, agent: "v01" });

    const handle = await runtime.orchestrator.beginTurn({
      userId: USER,
      sessionId: session.sessionId,
      query: "rebalance into the best 30d yield",
      mode: "v01",
      pools: ["morpho-usdc-base"],
      protocols: ["morpho"],
      horizonDays: 30,
      dry: true,
    });

    const result = await handle.done;
    expect(result.state).toBe("awaiting_user");

    const events = handle.emitter.since(0);
    expect(events[0]?.type).toBe("session.started");
    expect(events.at(-1)?.type).toBe("run.completed");

    // Monotonic, gap-free seq — the property a reconnecting client depends on.
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));

    // The agent's prose arrived as deltas and then a completion.
    expect(events.some((event) => event.type === "message.delta")).toBe(true);
    expect(events.some((event) => event.type === "message.completed")).toBe(true);

    // One real sandbox round-trip completed (the E2B-shaped path).
    const sandboxStep = events.find(
      (event) => event.type === "step.completed" && event.step.id === "trace-sandbox",
    );
    expect(sandboxStep).toBeDefined();
    if (sandboxStep?.type === "step.completed") expect(sandboxStep.step.state).toBe("done");

    // Exactly one intent was proposed and queued for HITL approval.
    const requested = events.filter((event) => event.type === "approval.requested");
    expect(requested).toHaveLength(1);
    expect(runtime.approvals.pending(handle.runId)).toHaveLength(1);

    // The run is resting, not finished: the stream stays open for the approval.
    expect(handle.emitter.closed).toBe(false);
  });

  it("persists every event to the journal for replay", async () => {
    const runtime = makeRuntime();
    const session = await runtime.sessions.open({ userId: USER, agent: "v01" });
    const handle = await runtime.orchestrator.beginTurn({
      userId: USER,
      sessionId: session.sessionId,
      query: "q",
      mode: "v01",
      pools: [],
      protocols: [],
      horizonDays: 30,
      dry: true,
    });
    await handle.done;

    const replayed = await runtime.journal.read(handle.runId, 0);
    expect(replayed.length).toBe(handle.emitter.since(0).length);
    expect(await runtime.journal.lastSeq(handle.runId)).toBe(handle.emitter.lastSeq);
  });

  it("returns a run to draft when the user rejects the intent", async () => {
    const runtime = makeRuntime();
    const session = await runtime.sessions.open({ userId: USER, agent: "v01" });
    const handle = await runtime.orchestrator.beginTurn({
      userId: USER,
      sessionId: session.sessionId,
      query: "q",
      mode: "v01",
      pools: [],
      protocols: [],
      horizonDays: 30,
      dry: true,
    });
    await handle.done;

    const pending = runtime.approvals.pending(handle.runId)[0];
    expect(pending).toBeDefined();
    runtime.approvals.resolve({ intentId: pending!.intent.intentId, outcome: "rejected" });
    const run = await runtime.runs.advance(USER, handle.runId, "draft");
    expect(run.state).toBe("draft");
  });

  it("fails loudly and invents no steps when a live agent cannot run the turn", async () => {
    const base = makeRuntime();
    // Force the live adapter. A turn it cannot serve must fail loudly rather than
    // emit a plausible-looking trace — which is the whole reason the fixture it
    // replaced was deleted.
    const { LangchainAgentPort } = await import("../src/orchestrator/LangchainAgentPort.js");
    const agents = new Map(base.agents);
    agents.set("v01", new LangchainAgentPort({ mode: "v01" }));
    const runtime = makeRuntime({ agents });

    const session = await runtime.sessions.open({ userId: USER, agent: "v01" });
    const handle = await runtime.orchestrator.beginTurn({
      userId: USER,
      sessionId: session.sessionId,
      query: "q",
      mode: "v01",
      // The v01 cycle needs both; with neither it cannot honestly run.
      pools: [],
      protocols: [],
      horizonDays: 30,
      dry: false,
    });

    const result = await handle.done;
    expect(result.state).toBe("failed");

    const events = handle.emitter.since(0);
    const error = events.find((event) => event.type === "error");
    expect(error).toBeDefined();
    // The operator is told what to fix, not handed an opaque failure.
    if (error?.type === "error") {
      expect(error.code).toBe("INTERNAL");
      expect(error.message).toContain("at least one protocol and one pool");
    }
    // And the guarantee that matters: no step was fabricated to fill the gap.
    expect(
      events.filter((event) => event.type === "step.start" || event.type === "step.completed"),
    ).toEqual([]);
  });

  it("bounds concurrent runs rather than overcommitting the instance", async () => {
    const runtime = makeRuntime();
    const session = await runtime.sessions.open({ userId: USER, agent: "v01" });

    const first = await runtime.orchestrator.beginTurn({
      userId: USER,
      sessionId: session.sessionId,
      query: "q",
      mode: "v01",
      pools: [],
      protocols: [],
      horizonDays: 30,
      dry: true,
    });
    // The default capacity is 8; fill the rest.
    for (let index = 1; index < runtime.orchestrator.capacity; index += 1) {
      await runtime.orchestrator.beginTurn({
        userId: USER,
        sessionId: session.sessionId,
        query: "q",
        mode: "v01",
        pools: [],
        protocols: [],
        horizonDays: 30,
        dry: true,
      });
    }
    await expect(
      runtime.orchestrator.beginTurn({
        userId: USER,
        sessionId: session.sessionId,
        query: "q",
        mode: "v01",
        pools: [],
        protocols: [],
        horizonDays: 30,
        dry: true,
      }),
    ).rejects.toThrow(/capacity/);

    await first.done;
  });
});
