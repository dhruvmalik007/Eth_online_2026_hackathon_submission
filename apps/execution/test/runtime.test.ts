/**
 * Tests for the composition root and its configuration.
 *
 * The claim worth proving is that the service is testable **without a database**:
 * every test here supplies its own runner, and none opens a connection.
 *
 * The second claim is that `EXECUTION_EVENT_BUFFER` is live — it configures the
 * runtime's write buffer, that buffer is drained before the pool closes, and a
 * flushed batch reaches the WebSocket hub. A config key that nothing reads is the
 * failure this guards against.
 */
import { describe, expect, it } from "vitest";
import type { ExecutionEventRow, SqlRunner } from "@ethonline2026/timeseries";
import { ExecutionRepository } from "@ethonline2026/timeseries";
import { closeRuntime, createRuntime, loadExecutionEnv } from "../src/index.js";

/**
 * A runner that records every statement and answers the event insert with one row
 * per tuple, so `recordEvents` reports a real inserted count.
 */
class NullRunner implements SqlRunner {
  readonly queries: Array<{ text: string; values: readonly unknown[] }> = [];
  /** When true, the event insert reports no rows — a simulated replay. */
  simulateReplay = false;
  close?: () => Promise<void>;

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    this.queries.push({ text, values });
    if (text.includes("INSERT INTO exec_events") && !this.simulateReplay) {
      const inserted = Math.floor(values.length / 8);
      return { rows: Array.from({ length: inserted }, (_, i) => ({ event_id: `e${i}` })) };
    }
    return { rows: [] };
  }

  async transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

const USER = "did:privy:user-1";

function event(eventId: string, userId = USER): ExecutionEventRow {
  return {
    eventId,
    at: new Date("2026-09-12T03:00:00.000Z"),
    userId,
    runId: "22222222-2222-4222-8222-222222222222",
    intentId: null,
    stepId: null,
    type: "run.submitted",
    payload: {},
  };
}

describe("loadExecutionEnv", () => {
  it("defaults to dry mode, so an unconfigured deploy cannot broadcast", () => {
    // The safe default matters: a misconfigured production deploy should not be
    // able to move funds just because a variable was missing.
    const env = loadExecutionEnv({});
    expect(env.EXECUTION_MODE).toBe("dry");
    expect(env.PORT).toBe(8080);
    expect(env.EXECUTION_EVENT_BUFFER).toBe(128);
  });

  it("reports every invalid key at once rather than the first", () => {
    // A deploy loop that fixes one variable per attempt is a bad afternoon.
    expect(() => loadExecutionEnv({ EXECUTION_MODE: "yolo", PORT: "not-a-port" })).toThrow(
      /EXECUTION_MODE.*PORT|PORT.*EXECUTION_MODE/s,
    );
  });

  it("rejects an event-buffer bound that cannot be a positive integer", () => {
    expect(() => loadExecutionEnv({ EXECUTION_EVENT_BUFFER: "0" })).toThrow(/EXECUTION_EVENT_BUFFER/);
  });

  it("accepts a valid override", () => {
    const env = loadExecutionEnv({ EXECUTION_MODE: "live", PORT: "9090" });
    expect(env.EXECUTION_MODE).toBe("live");
    expect(env.PORT).toBe(9090);
  });
});

describe("createRuntime", () => {
  it("constructs every repository without opening a connection", () => {
    // Lazy by design: a scale-to-zero host cold-starts constantly, and a service
    // that connected at boot would fail whenever the database blipped.
    const runner = new NullRunner();
    const runtime = createRuntime({ runner, env: loadExecutionEnv({}) });

    expect(runtime.runner).toBe(runner);
    expect(runtime.history).toBeInstanceOf(ExecutionRepository);
    expect(runtime.sessions).toBeDefined();
    expect(runtime.strategies).toBeDefined();
    expect(runtime.events).toBeDefined();
    expect(runner.queries).toHaveLength(0);
  });

  it("lets a test replace any single repository", () => {
    const runner = new NullRunner();
    const history = new ExecutionRepository(runner);
    const runtime = createRuntime({ runner, env: loadExecutionEnv({}), history });
    expect(runtime.history).toBe(history);
  });

  it("closes a runner that owns a pool", async () => {
    let closed = false;
    const runner = Object.assign(new NullRunner(), {
      close: async (): Promise<void> => {
        closed = true;
      },
    });
    await closeRuntime(createRuntime({ runner, env: loadExecutionEnv({}) }));
    expect(closed).toBe(true);
  });

  it("tolerates a runner with no pool to close", async () => {
    // An injected runner belongs to the caller; closing it would be rude.
    await expect(
      closeRuntime(createRuntime({ runner: new NullRunner(), env: loadExecutionEnv({}) })),
    ).resolves.toBeUndefined();
  });
});

describe("EXECUTION_EVENT_BUFFER is wired", () => {
  it("uses the configured bound as the flush threshold", async () => {
    const runner = new NullRunner();
    const runtime = createRuntime({
      runner,
      env: loadExecutionEnv({ EXECUTION_EVENT_BUFFER: "2" }),
    });

    await runtime.events.add(event("a"));
    await runtime.events.add(event("b"));

    // Two events, one statement — the bound from the environment, not a literal.
    expect(runner.queries).toHaveLength(1);
    expect(runner.queries[0]?.text).toContain("INSERT INTO exec_events");
    expect(runner.queries[0]?.values).toHaveLength(16);
  });

  it("buffers below the bound rather than writing per event", async () => {
    const runner = new NullRunner();
    const runtime = createRuntime({
      runner,
      env: loadExecutionEnv({ EXECUTION_EVENT_BUFFER: "10" }),
    });

    await runtime.events.add(event("a"));

    expect(runner.queries).toHaveLength(0);
    expect(runtime.events.size).toBe(1);
  });

  it("drains the buffer on shutdown before releasing the pool", async () => {
    // On a scale-to-zero host SIGTERM is routine, so a shutdown that closed the
    // pool first would truncate the trace.
    const order: string[] = [];
    const runner = new NullRunner();
    const baseQuery = runner.query.bind(runner);
    runner.query = async (text, values = []) => {
      order.push("flush");
      return baseQuery(text, values);
    };
    runner.close = async () => {
      order.push("close");
    };

    const runtime = createRuntime({
      runner,
      env: loadExecutionEnv({ EXECUTION_EVENT_BUFFER: "10" }),
    });
    await runtime.events.add(event("a"));
    expect(runner.queries).toHaveLength(0);

    await closeRuntime(runtime);

    expect(order).toEqual(["flush", "close"]);
    expect(runtime.events.isEmpty).toBe(true);
  });

  it("publishes a flushed batch to the user's channel", async () => {
    const runtime = createRuntime({
      runner: new NullRunner(),
      env: loadExecutionEnv({ EXECUTION_EVENT_BUFFER: "1" }),
    });

    const received: ExecutionEventRow[] = [];
    await runtime.hub.subscribe(
      USER,
      [`user:${USER}`],
      {
        send: (e) => {
          received.push(e);
          return true;
        },
      },
      async () => false,
    );

    await runtime.events.add(event("a"));

    expect(received.map((e) => e.eventId)).toEqual(["a"]);
  });

  it("does not re-publish a replay, so a live socket is not double-delivered", async () => {
    const runner = new NullRunner();
    runner.simulateReplay = true;
    const runtime = createRuntime({
      runner,
      env: loadExecutionEnv({ EXECUTION_EVENT_BUFFER: "1" }),
    });

    const received: ExecutionEventRow[] = [];
    await runtime.hub.subscribe(
      USER,
      [`user:${USER}`],
      {
        send: (e) => {
          received.push(e);
          return true;
        },
      },
      async () => false,
    );

    await runtime.events.add(event("a"));

    // The insert reported zero rows, so nothing was newly written to fan out.
    expect(received).toHaveLength(0);
  });

  it("lets a test inject its own buffer and hub", () => {
    const runner = new NullRunner();
    const runtime = createRuntime({ runner, env: loadExecutionEnv({}) });
    const injected = createRuntime({ runner, env: loadExecutionEnv({}), hub: runtime.hub });
    // The hub is the same live object; the buffer is rebuilt from the same env.
    expect(injected.hub).toBe(runtime.hub);
    expect(injected.events).not.toBe(runtime.events);
  });
});
