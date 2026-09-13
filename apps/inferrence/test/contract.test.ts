import { describe, expect, it } from "vitest";
import type { AgentStep } from "@ethonline2026/ux-workflow";
import {
  INFERENCE_EVENT_VERSION,
  InferenceEventSchema,
  serializeSse,
} from "../src/events/contract.js";

describe("event contract", () => {
  it("accepts a step event whose payload IS the ux-workflow AgentStep type", () => {
    const parsed = InferenceEventSchema.parse({
      v: INFERENCE_EVENT_VERSION,
      seq: 3,
      ts: "2026-09-12T10:00:00.000Z",
      type: "step.start",
      step: {
        id: "trace-1",
        agent: "Graph Indexer",
        call: "task(subagent=graph-indexer)",
        state: "running",
        reasoning: ["resolved 5 subgraphs"],
      },
    });

    expect(parsed.type).toBe("step.start");
    if (parsed.type !== "step.start") throw new Error("narrowing failed");
    // Compile-time assertion: the wire payload is assignable to the render type.
    const step: AgentStep = parsed.step;
    expect(step.id).toBe("trace-1");
  });

  it("rejects a malformed step payload", () => {
    const result = InferenceEventSchema.safeParse({
      v: INFERENCE_EVENT_VERSION,
      seq: 1,
      ts: "2026-09-12T10:00:00.000Z",
      type: "step.start",
      step: { id: "trace-1" },
    });
    expect(result.success).toBe(false);
  });

  it("applies defaults for nullable fields", () => {
    const parsed = InferenceEventSchema.parse({
      v: INFERENCE_EVENT_VERSION,
      seq: 9,
      ts: "2026-09-12T10:00:00.000Z",
      type: "error",
      code: "MODEL_UNAVAILABLE",
      message: "nope",
    });
    expect(parsed.type).toBe("error");
    if (parsed.type !== "error") throw new Error("narrowing failed");
    expect(parsed.details).toBeNull();
  });

  it("frames SSE with an id so Last-Event-ID can resume", () => {
    const parsed = InferenceEventSchema.parse({
      v: INFERENCE_EVENT_VERSION,
      seq: 7,
      ts: "2026-09-12T10:00:00.000Z",
      type: "message.delta",
      messageId: "m1",
      text: "hello",
    });
    const frame = serializeSse(parsed);
    expect(frame.startsWith("id: 7\n")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(frame).toContain('"seq":7');
  });
});
