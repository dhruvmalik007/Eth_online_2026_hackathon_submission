import { describe, expect, it, vi } from "vitest";
import { RunEventEmitter } from "../src/events/emitter.js";

function emitter(now?: () => Date): RunEventEmitter {
  return new RunEventEmitter({ runId: "run-1", ...(now === undefined ? {} : { now }) });
}

describe("RunEventEmitter", () => {
  it("stamps a monotonic seq and a timestamp on every event", () => {
    const e = emitter(() => new Date("2026-09-12T10:00:00.000Z"));
    const first = e.emit({ type: "message.delta", messageId: "m1", text: "a" });
    const second = e.emit({ type: "message.delta", messageId: "m1", text: "b" });
    expect([first.seq, second.seq]).toEqual([1, 2]);
    expect(first.ts).toBe("2026-09-12T10:00:00.000Z");
    expect(e.lastSeq).toBe(2);
  });

  it("delivers events to every subscriber in order", () => {
    const e = emitter();
    const seen: number[] = [];
    const off = e.subscribe((event) => seen.push(event.seq));
    e.emit({ type: "message.delta", messageId: "m1", text: "a" });
    e.emit({ type: "message.delta", messageId: "m1", text: "b" });
    off();
    e.emit({ type: "message.delta", messageId: "m1", text: "c" });
    expect(seen).toEqual([1, 2]);
  });

  it("replays only events newer than the requested seq", () => {
    const e = emitter();
    e.emit({ type: "message.delta", messageId: "m1", text: "a" });
    e.emit({ type: "message.delta", messageId: "m1", text: "b" });
    e.emit({ type: "message.delta", messageId: "m1", text: "c" });
    expect(e.since(1).map((event) => event.seq)).toEqual([2, 3]);
  });

  it("hands every event to the journal hook", () => {
    const onEvent = vi.fn();
    const e = new RunEventEmitter({ runId: "run-1", onEvent });
    e.emit({ type: "message.delta", messageId: "m1", text: "a" });
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("refuses to emit into a closed run", () => {
    const e = emitter();
    e.close();
    expect(e.closed).toBe(true);
    expect(() => e.emit({ type: "message.delta", messageId: "m1", text: "late" })).toThrow(
      /closed/,
    );
    // History survives closing, so a reconnecting client can still replay it.
    expect(() => e.since(0)).not.toThrow();
  });

  it("bounds the replay tail", () => {
    const e = new RunEventEmitter({ runId: "run-1", historyLimit: 2 });
    for (const text of ["a", "b", "c", "d"]) {
      e.emit({ type: "message.delta", messageId: "m1", text });
    }
    expect(e.since(0).map((event) => event.seq)).toEqual([3, 4]);
  });
});
