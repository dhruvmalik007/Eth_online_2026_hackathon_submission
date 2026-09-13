/**
 * The trace bridge.
 *
 * A recording `Tracing` stands in for LangSmith, so the mapping from
 * `InferenceEvent`s to the run tree is asserted directly — including the two
 * decisions that are easy to get wrong: categorical facts go in **tags**
 * (things LangSmith can group by) and numeric facts go in **feedback** (things
 * LangSmith can chart), because numeric metadata is not aggregatable.
 */
import { describe, expect, it } from "vitest";
import { RunEventEmitter } from "../src/events/emitter.js";
import { redactDeep, redactSecrets } from "../src/observability/redact.js";
import type {
  BeginTurnSpec,
  FeedbackSpec,
  TraceChildSpec,
  TraceEndSpec,
  TraceRun,
  Tracing,
} from "../src/observability/tracing.js";
import { TurnTrace, TRACE_FEEDBACK_KEYS } from "../src/observability/turnTrace.js";

interface Recorded {
  readonly kind: "begin" | "child" | "end" | "feedback";
  readonly name?: string;
  readonly runType?: string;
  readonly tags?: readonly string[];
  readonly outputs?: Record<string, unknown>;
  readonly error?: string;
  readonly key?: string;
  readonly score?: number;
}

class RecordingTracing implements Tracing {
  readonly enabled = true;
  readonly events: Recorded[] = [];
  flushCount = 0;

  async beginTurn(spec: BeginTurnSpec): Promise<TraceRun> {
    this.events.push({
      kind: "begin",
      name: spec.name,
      ...(spec.tags === undefined ? {} : { tags: spec.tags }),
    });
    return this.#run();
  }

  #run(): TraceRun {
    // Arrow functions capture the instance, so no `this` aliasing is needed.
    return {
      id: "run-1",
      child: async (spec: TraceChildSpec) => {
        this.events.push({
          kind: "child",
          name: spec.name,
          runType: spec.runType,
          ...(spec.tags === undefined ? {} : { tags: spec.tags }),
        });
        return this.#run();
      },
      end: async (spec: TraceEndSpec = {}) => {
        this.events.push({
          kind: "end",
          ...(spec.outputs === undefined ? {} : { outputs: spec.outputs }),
          ...(spec.error === undefined ? {} : { error: spec.error }),
          ...(spec.tags === undefined ? {} : { tags: spec.tags }),
        });
      },
      feedback: async (spec: FeedbackSpec) => {
        this.events.push({
          kind: "feedback",
          key: spec.key,
          ...(spec.score === undefined ? {} : { score: spec.score }),
        });
      },
    };
  }

  async recordFeedback(): Promise<void> {
    return undefined;
  }

  async flush(): Promise<void> {
    this.flushCount += 1;
  }
}

function attach(tracing: Tracing): { emitter: RunEventEmitter; trace: TurnTrace } {
  const emitter = new RunEventEmitter({ runId: "run-1" });
  const trace = new TurnTrace(tracing, {
    runId: "run-1",
    sessionId: "ses-1",
    query: "rebalance",
    mode: "v01",
    dry: true,
    pools: ["p"],
    protocols: ["morpho"],
    horizonDays: 30,
  });
  void trace.attach(emitter);
  return { emitter, trace };
}

describe("TurnTrace", () => {
  it("maps a turn onto one root run with a child per step and per operation", async () => {
    const tracing = new RecordingTracing();
    const { emitter, trace } = attach(tracing);

    emitter.emit({
      type: "step.start",
      step: { id: "s1", agent: "Graph Indexer", call: "task(subagent=graph-indexer)", state: "running", reasoning: [], parallel: true },
    });
    emitter.emit({
      type: "step.completed",
      step: { id: "s1", agent: "Graph Indexer", call: "task(subagent=graph-indexer)", state: "done", reasoning: [], durationMs: 120 },
    });
    emitter.emit({
      type: "widget",
      widget: { kind: "yields", pools: [{ poolId: "p", protocol: "morpho", apy: 4.2, tvlUsd: 1 }] },
    });
    emitter.emit({ type: "run.completed", runId: "run-1", state: "awaiting_user", summary: "done" });
    await trace.settle();

    const kinds = tracing.events.map((event) => event.kind);
    expect(kinds).toEqual(["begin", "child", "end", "feedback", "child", "end", "end", "feedback"]);

    expect(tracing.events[0]).toMatchObject({ kind: "begin", name: "inference.turn" });
    // A `task(...)` call is an external operation, not a graph node.
    expect(tracing.events[1]).toMatchObject({ kind: "child", runType: "tool", tags: ["step_state=running", "parallel=true"] });
    expect(tracing.events[4]).toMatchObject({ kind: "child", name: "widget.yields", runType: "tool", tags: ["widget=yields"] });
    // The root closes last, carrying the run state as a tag (groupable).
    const rootEnd = tracing.events[6];
    expect(rootEnd).toMatchObject({ kind: "end", tags: ["state=awaiting_user"] });
    expect(tracing.flushCount).toBeGreaterThan(0);
  });

  it("records per-step duration as feedback, not metadata — metadata does not aggregate", async () => {
    const tracing = new RecordingTracing();
    const { emitter, trace } = attach(tracing);

    emitter.emit({
      type: "step.completed",
      step: { id: "s1", agent: "A", call: "risk-engine.decompose", state: "done", reasoning: [], durationMs: 4321 },
    });
    emitter.emit({ type: "run.completed", runId: "run-1", state: "signed", summary: "ok" });
    await trace.settle();

    expect(tracing.events).toContainEqual({ kind: "feedback", key: "duration_ms", score: 4321 });
    expect(tracing.events).toContainEqual({ kind: "feedback", key: "run_state", score: 1 });
  });

  it("records an intent's numeric facts as feedback and its kind as a tag", async () => {
    const tracing = new RecordingTracing();
    const { emitter, trace } = attach(tracing);
    const intent = {
      version: "0.1" as const,
      intentId: "i1",
      requestId: "req-1",
      agentId: "v01",
      createdAt: "2026-09-12T10:00:00.000Z",
      chain: "eip155:8453",
      chainId: 8453,
      account: "0x1111111111111111111111111111111111111111",
      kind: "v01-readjustment" as const,
      signing: {
        scheme: "safe-typed-data" as const,
        safeAddress: "0x1111111111111111111111111111111111111111",
        safeTxHash: "0x" + "ab".repeat(32),
        safeNonce: 1,
        typedData: { domain: {}, types: {}, primaryType: "SafeTx", message: {} },
      },
      display: { title: "t", sentence: "s", fields: [], warnings: [] },
      authorized: { legs: [{ to: "0x2", value: "0", data: "0x" }], calldata: null, nonce: 1 },
      policy: { perTxCapUsdc: null, dailyCapUsdc: null, allowlistOk: true, evaluatedAt: null, privyPolicyId: null },
      provenance: { agentId: "v01", agentRunId: "run-1", langsmithTraceId: null, model: null, decisionIds: [] },
      digest: "0x" + "cd".repeat(32),
    };

    emitter.emit({ type: "approval.requested", intent });
    emitter.emit({ type: "run.completed", runId: "run-1", state: "awaiting_user", summary: "awaiting" });
    await trace.settle();

    expect(tracing.events).toContainEqual(
      expect.objectContaining({ kind: "child", name: "custody.proposeIntent", runType: "tool" }),
    );
    expect(tracing.events).toContainEqual({ kind: "feedback", key: "intent_legs", score: 1 });
    expect(tracing.events).toContainEqual({ kind: "feedback", key: "intent_policy_allowed", score: 1 });
  });

  it("records a failed run as an error on the root", async () => {
    const tracing = new RecordingTracing();
    const { emitter, trace } = attach(tracing);

    emitter.emit({ type: "error", code: "MODEL_UNAVAILABLE", message: "upstream 429", details: null });
    emitter.emit({ type: "run.completed", runId: "run-1", state: "failed", summary: "boom" });
    await trace.settle();

    expect(tracing.events).toContainEqual(
      expect.objectContaining({ kind: "end", error: "upstream 429", tags: ["error_code=MODEL_UNAVAILABLE"] }),
    );
  });

  it("is inert when tracing is disabled", async () => {
    const disabled: Tracing = {
      enabled: false,
      beginTurn: async () => {
        throw new Error("must not be called when tracing is off");
      },
      recordFeedback: async () => undefined,
      flush: async () => undefined,
    };
    const { emitter, trace } = attach(disabled);

    emitter.emit({ type: "step.start", step: { id: "s1", agent: "A", call: "c", state: "running", reasoning: [] } });
    emitter.emit({ type: "run.completed", runId: "run-1", state: "failed", summary: "s" });
    // Resolves without ever touching the tracer.
    await expect(trace.settle()).resolves.toBeUndefined();
  });

  it("names every feedback key it emits, so dashboards and tests agree", () => {
    expect([...TRACE_FEEDBACK_KEYS]).toEqual([
      "duration_ms",
      "intent_legs",
      "intent_policy_allowed",
      "run_state",
      "approval_outcome",
    ]);
  });
});

describe("redaction", () => {
  it("scrubs credential-shaped strings before they are traced", () => {
    expect(redactSecrets("lsv2_pt_abcdefghijklmnop")).toBe("[redacted-key]");
    expect(redactSecrets("wallet-auth:AAAA")).toBe("wallet-auth:[redacted]");
    expect(redactSecrets(`key 0x${"a".repeat(64)}`)).toBe("key [redacted-key]");
  });

  it("redacts before truncating, so a cut cannot expose a credential prefix", () => {
    // A realistic cap: markers survive intact, and long payloads are trimmed.
    const out = redactDeep(
      { nested: { token: "lsv2_pt_abcdefghijklmnop" }, big: "x".repeat(500) },
      100,
    ) as { nested: { token: string }; big: string };
    expect(out.nested.token).toBe("[redacted-key]");
    expect(out.big).toContain("[truncated]");
    expect(out.big.length).toBeLessThan(130);
  });

  it("prefers a split marker over a leaked secret when the cap is tiny", () => {
    // The ordering is deliberate: with a cap smaller than the marker, the trace
    // carries a broken `[redacted-…]` rather than the first characters of a key.
    const out = redactDeep({ token: "lsv2_pt_abcdefghijklmnop" }, 10) as { token: string };
    expect(out.token).not.toContain("lsv2_pt_");
    expect(out.token).not.toContain("abcdefghij");
  });
});
