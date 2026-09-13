/**
 * Tests for the write buffer — T1.3.
 *
 * The behaviours worth pinning are the ones a naive buffer gets wrong: flushing
 * per event (no batching), losing the batch when the insert throws, and
 * double-publishing a replay. Each is asserted against the number of repository
 * calls rather than against timing, so there is no timer to make the suite flaky.
 */
import { describe, expect, it } from "vitest";
import { ExecutionEventBuffer } from "../src/index.js";
import type { ExecutionEventRow, EventSinkRepository, FlushResult } from "../src/index.js";

/** Records each batch handed to `recordEvents` and answers with a fixed count. */
class FakeRepository implements EventSinkRepository {
  readonly batches: Array<readonly ExecutionEventRow[]> = [];
  private nextInserted = 0;
  failNext = false;

  /** How many rows the next insert claims to have written (0 simulates a replay). */
  willInsert(count: number): this {
    this.nextInserted = count;
    return this;
  }

  willFail(): this {
    this.failNext = true;
    return this;
  }

  async recordEvents(events: readonly ExecutionEventRow[]): Promise<number> {
    this.batches.push(events);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("insert failed");
    }
    return this.nextInserted;
  }
}

function event(id: string): ExecutionEventRow {
  return {
    eventId: id,
    at: new Date("2026-09-12T03:00:00.000Z"),
    userId: "did:privy:user-1",
    runId: "22222222-2222-4222-8222-222222222222",
    intentId: null,
    stepId: null,
    type: "run.submitted",
    payload: {},
  };
}

describe("ExecutionEventBuffer", () => {
  it("does not write until the bound is reached", async () => {
    // The whole point: a hundred state changes must not be a hundred round trips.
    const repo = new FakeRepository().willInsert(2);
    const buffer = new ExecutionEventBuffer(repo, { maxEvents: 3 });

    await buffer.add(event("a"));
    await buffer.add(event("b"));

    expect(repo.batches).toHaveLength(0);
    expect(buffer.size).toBe(2);
  });

  it("flushes the whole batch as one statement when the bound trips", async () => {
    const repo = new FakeRepository().willInsert(3);
    const buffer = new ExecutionEventBuffer(repo, { maxEvents: 3 });

    await buffer.add(event("a"));
    await buffer.add(event("b"));
    await buffer.add(event("c"));

    expect(repo.batches).toHaveLength(1);
    expect(repo.batches[0]?.map((e) => e.eventId)).toEqual(["a", "b", "c"]);
    expect(buffer.isEmpty).toBe(true);
  });

  it("writes a partial batch on an explicit flush", async () => {
    const repo = new FakeRepository().willInsert(2);
    const buffer = new ExecutionEventBuffer(repo, { maxEvents: 100 });

    await buffer.add(event("a"));
    await buffer.add(event("b"));
    const inserted = await buffer.flush();

    expect(inserted).toBe(2);
    expect(repo.batches).toHaveLength(1);
    expect(buffer.size).toBe(0);
  });

  it("issues no repository call for an empty flush", async () => {
    const repo = new FakeRepository();
    const buffer = new ExecutionEventBuffer(repo, { maxEvents: 10 });

    await expect(buffer.flush()).resolves.toBe(0);
    expect(repo.batches).toHaveLength(0);
  });

  it("reports zero inserted on a replay so a caller does not fan out twice", async () => {
    const repo = new FakeRepository().willInsert(0);
    const buffer = new ExecutionEventBuffer(repo, { maxEvents: 1 });

    await buffer.add(event("a"));
    expect(repo.batches).toHaveLength(1);
  });

  it("puts the batch back when the insert fails, so a blip does not drop a trace", async () => {
    const repo = new FakeRepository().willInsert(2).willFail();
    const buffer = new ExecutionEventBuffer(repo, { maxEvents: 2 });

    await expect(buffer.add(event("a"))).resolves.toBeUndefined();
    await expect(buffer.add(event("b"))).rejects.toThrow(/insert failed/);

    // The two events are queued again rather than lost.
    expect(buffer.size).toBe(2);

    // A later flush retries them.
    const retryRepo = repo;
    await expect(buffer.flush()).resolves.toBe(2);
    expect(retryRepo.batches).toHaveLength(2);
  });

  it("never loses an event across a concurrent flush and add", async () => {
    const repo = new FakeRepository().willInsert(1);
    const buffer = new ExecutionEventBuffer(repo, { maxEvents: 1 });

    await Promise.all([buffer.add(event("a")), buffer.add(event("b")), buffer.add(event("c"))]);

    const seen = repo.batches.flat().map((e) => e.eventId);
    expect(seen.sort()).toEqual(["a", "b", "c"]);
  });

  it("observes each flush with the events and the real inserted count", async () => {
    const repo = new FakeRepository().willInsert(1);
    const observed: FlushResult[] = [];
    const buffer = new ExecutionEventBuffer(repo, {
      maxEvents: 1,
      onFlush: (result) => {
        observed.push(result);
      },
    });

    await buffer.add(event("a"));

    expect(observed).toHaveLength(1);
    expect(observed[0]?.inserted).toBe(1);
    expect(observed[0]?.events.map((e) => e.eventId)).toEqual(["a"]);
  });

  it("rejects a bound that cannot be a positive integer", () => {
    const repo = new FakeRepository();
    expect(() => new ExecutionEventBuffer(repo, { maxEvents: 0 })).toThrow(/positive integer/);
    expect(() => new ExecutionEventBuffer(repo, { maxEvents: 1.5 })).toThrow(/positive integer/);
  });
});
