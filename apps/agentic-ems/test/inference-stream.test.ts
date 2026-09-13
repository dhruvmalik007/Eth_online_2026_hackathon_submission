/**
 * Guards for the stream parser, run against a **recorded stream from the live
 * service** (`test/fixtures/turn-stream.sse`).
 *
 * Why a recording rather than a hand-written fixture: the app declares the wire
 * envelope locally instead of importing the service (see the module doc), so
 * something has to catch drift. A recorded frame set does — if the service renames
 * `step.result.summary`, or moves a field, the assertions below fail instead of the
 * desk rendering blank. Re-capture with:
 *
 *   pnpm --filter @ethonline2026/inferrence smoke   # or the capture command in the plan
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SseFrameDecoder,
  emptyRunState,
  parseInferenceEvent,
  reduceAll,
  reduceEvent,
  upsertStep,
  type InferenceEvent,
} from "../lib/inference/stream.js";

const RAW = readFileSync(
  path.join(import.meta.dirname, "fixtures/turn-stream.sse"),
  "utf8",
);

/** Decode a whole capture, as the client transport does. */
function eventsFrom(raw: string, chunkSize = 4096): InferenceEvent[] {
  const decoder = new SseFrameDecoder();
  const events: InferenceEvent[] = [];
  for (let i = 0; i < raw.length; i += chunkSize) {
    for (const payload of decoder.push(raw.slice(i, i + chunkSize))) {
      const event = parseInferenceEvent(payload);
      if (event !== null) events.push(event);
    }
  }
  return events;
}

describe("SseFrameDecoder", () => {
  it("decodes every framed event in a real capture", () => {
    const events = eventsFrom(RAW);
    expect(events.length).toBeGreaterThan(10);
    // The event types the desk actually branches on must all be present.
    const types = new Set(events.map((event) => event.type));
    expect(types).toContain("session.started");
    expect(types).toContain("step.start");
    expect(types).toContain("step.completed");
    expect(types).toContain("run.completed");
  });

  it("survives a frame split across chunk boundaries", () => {
    // The same bytes, delivered one character at a time — the pathological case a
    // real socket produces and a naive `split("\n\n")` per chunk gets wrong.
    const trickled = eventsFrom(RAW, 1);
    const buffered = eventsFrom(RAW, 64 * 1024);
    expect(trickled.map((event) => event.seq)).toEqual(buffered.map((event) => event.seq));
  });

  it("ignores `id:` fields and SSE comments", () => {
    const decoder = new SseFrameDecoder();
    expect(decoder.push(":hb\n\n")).toEqual([]);
    expect(decoder.push("id: 7\ndata: {\"type\":\"x\",\"seq\":1}\n\n")).toEqual([
      '{"type":"x","seq":1}',
    ]);
  });

  it("rejects a payload that is not JSON, or is missing the fields every reduction needs", () => {
    expect(parseInferenceEvent("not json")).toBeNull();
    expect(parseInferenceEvent('{"type":"x"}')).toBeNull(); // no seq
    expect(parseInferenceEvent('{"seq":1}')).toBeNull(); // no type
    expect(parseInferenceEvent('{"type":"x","seq":1}')).not.toBeNull();
  });
});

describe("reduceEvent against the recorded stream", () => {
  const events = eventsFrom(RAW);
  const state = reduceAll(events);

  it("identifies the session and run from `session.started`", () => {
    expect(state.sessionId).toMatch(/^ses_/);
    expect(state.runId).toMatch(/^run_/);
  });

  it("carries the envelope every event must have", () => {
    for (const event of events) {
      expect(event.v, `v on seq ${event.seq}`).toBe("0.1");
      expect(typeof event.ts, `ts on seq ${event.seq}`).toBe("string");
    }
  });

  it("advances seq monotonically and lands the cursor on the last event", () => {
    const seqs = events.map((event) => event.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(state.lastSeq).toBe(Math.max(...seqs));
  });

  it("upserts steps rather than appending, so each id appears once", () => {
    const ids = state.steps.map((step) => step.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    // A real capture contains both transitions for the same step, so the upsert is
    // genuinely exercised: fewer steps than step.* events means it collapsed them.
    const stepEvents = events.filter(
      (event) => event.type === "step.start" || event.type === "step.completed",
    );
    expect(ids.length).toBeLessThan(stepEvents.length);
  });

  it("reaches a terminal state and leaves no error", () => {
    expect(state.state).not.toBeNull();
    expect(state.summary?.length ?? 0).toBeGreaterThan(0);
    expect(state.error).toBeNull();
  });

  it("accumulates the agent's prose from the deltas it actually sent", () => {
    const completed = events.find((event) => event.type === "message.completed");
    expect(state.message.length).toBeGreaterThan(0);
    if (completed !== undefined) expect(state.message).toBe(completed["text"]);
  });

  it("surfaces the signing intent the agent asked to have approved", () => {
    const requested = events.find((event) => event.type === "approval.requested");
    if (requested === undefined) return;
    expect(state.intents.length).toBe(1);
    const intent = state.intents[0]!;
    expect(intent.intentId.length).toBeGreaterThan(0);
    expect(intent.digest).toMatch(/^0x[0-9a-f]{64}$/);
    // The sentence shown to the human must exist — an approval without a description
    // is an approval nobody can meaningfully give.
    expect(intent.display.sentence.length).toBeGreaterThan(0);
  });

  it("replaces a widget of the same kind instead of stacking duplicates", () => {
    const kinds = state.widgets.map((widget) => widget.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("keeps a forecast widget's series aligned", () => {
    const forecast = state.widgets.find((widget) => widget.kind === "forecast");
    if (forecast === undefined || forecast.kind !== "forecast") return;
    expect(forecast.point.length).toBeGreaterThan(1);
    expect(forecast.q10.length).toBe(forecast.point.length);
    expect(forecast.q90.length).toBe(forecast.point.length);
    // A quantile band that crosses is a bug in whichever produced it.
    expect(forecast.q10[0]!).toBeLessThanOrEqual(forecast.q90[0]!);
  });
});

describe("reduceEvent resilience", () => {
  it("is forward compatible: an unknown event type changes nothing", () => {
    const before = emptyRunState();
    const after = reduceEvent(before, { v: "0.1", seq: 3, ts: "t", type: "future.thing" });
    // The cursor still advances, so a reconnect does not re-request it.
    expect(after.lastSeq).toBe(3);
    expect(after.steps).toEqual([]);
    expect(after.widgets).toEqual([]);
    expect(after.state).toBeNull();
  });

  it("treats `message.completed` as authoritative over accumulated deltas", () => {
    const afterDelta = reduceEvent(emptyRunState(), {
      v: "0.1", seq: 1, ts: "t", type: "message.delta", text: "partial",
    });
    const afterCompleted = reduceEvent(afterDelta, {
      v: "0.1", seq: 2, ts: "t", type: "message.completed", text: "the whole report",
    });
    expect(afterCompleted.message).toBe("the whole report");
  });

  it("records a typed error and marks the run failed", () => {
    const failed = reduceEvent(emptyRunState(), {
      v: "0.1", seq: 9, ts: "t", type: "error", code: "MODEL_UNAVAILABLE", message: "no model",
    });
    expect(failed.state).toBe("failed");
    expect(failed.error).toEqual({ code: "MODEL_UNAVAILABLE", message: "no model" });
  });

  it("upsertStep replaces in place, preserving order", () => {
    const a = { id: "a", agent: "A", call: "a", state: "running", reasoning: [] } as never;
    const b = { id: "b", agent: "B", call: "b", state: "running", reasoning: [] } as never;
    const aDone = { id: "a", agent: "A", call: "a", state: "done", reasoning: [] } as never;

    expect(upsertStep([a, b], b).length).toBe(2);
    const next = upsertStep([a, b], aDone);
    expect(next.map((step) => step.id)).toEqual(["a", "b"]);
    expect((next[0] as { state: string }).state).toBe("done");
  });
});
