/**
 * T2.3 — the subscription hub.
 *
 * The tests concentrate on the refusal paths. Fan-out is easy to get right and
 * easy to notice when wrong; a hub that quietly accepts a subscription for
 * another user's strategy fails silently and looks like a data problem.
 */
import { describe, expect, it, vi } from "vitest";
import type { ExecutionEventRow } from "@ethonline2026/timeseries";
import { SubscriptionHub, SubscriptionRefusedError, type EventSink } from "../src/ws.js";

const USER = "did:privy:user-a";
const OTHER = "did:privy:user-b";
const STRATEGY = "11111111-1111-4111-8111-111111111111";

function event(overrides: Partial<ExecutionEventRow> = {}): ExecutionEventRow {
  return {
    eventId: "44444444-4444-4444-8444-444444444444",
    at: new Date(),
    userId: USER,
    runId: null,
    intentId: null,
    stepId: null,
    type: "step.confirmed",
    payload: {},
    ...overrides,
  };
}

/** A sink that always accepts, counting what it received. */
function collectingSink(): EventSink & { readonly received: ExecutionEventRow[] } {
  const received: ExecutionEventRow[] = [];
  return {
    received,
    send: (row) => {
      received.push(row);
      return true;
    },
  };
}

describe("subscription scoping", () => {
  it("refuses another user's channel without touching the database", async () => {
    const hub = new SubscriptionHub();
    const verify = vi.fn(async () => true);

    // The owner is part of a `user:` channel, so this is decidable locally —
    // a round trip here would be pure cost.
    await expect(hub.subscribe(USER, [`user:${OTHER}`], collectingSink(), verify)).rejects.toThrow(
      SubscriptionRefusedError,
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it("refuses a strategy the user does not own", async () => {
    const hub = new SubscriptionHub();
    const verify = vi.fn(async () => false);

    await expect(
      hub.subscribe(USER, [`strategy:${STRATEGY}`], collectingSink(), verify),
    ).rejects.toThrow(/not owned by this user/);
    expect(verify).toHaveBeenCalledWith(USER, `strategy:${STRATEGY}`);
    // Nothing was registered on the way to the refusal.
    expect(hub.stats().sinks).toBe(0);
  });

  it("accepts a channel the verifier confirms", async () => {
    const hub = new SubscriptionHub();
    await hub.subscribe(USER, [`strategy:${STRATEGY}`], collectingSink(), async () => true);
    expect(hub.stats()).toEqual({ channels: 1, sinks: 1 });
  });

  it("checks every channel before registering any of them", async () => {
    const hub = new SubscriptionHub();
    const verify = vi.fn(async (_user: string, channel: string) => channel.startsWith("strategy"));

    // The `run:` channel fails, so the valid `strategy:` one must not be left
    // registered — a partially applied subscription leaks for the process's life.
    await expect(
      hub.subscribe(USER, [`strategy:${STRATEGY}`, "run:55555555-5555-4555-8555-555555555555"], collectingSink(), verify),
    ).rejects.toThrow(SubscriptionRefusedError);
    expect(hub.stats()).toEqual({ channels: 0, sinks: 0 });
  });

  it("requires ownership verification rather than trusting the caller", async () => {
    const hub = new SubscriptionHub();
    const verify = vi.fn(async () => true);
    await hub.subscribe(USER, [`user:${USER}`], collectingSink(), verify);
    // A `user:` channel needed no verification — which is the point of the check
    // being conditional rather than uniform.
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("fan-out", () => {
  it("delivers to every sink on the channel", async () => {
    const hub = new SubscriptionHub();
    const a = collectingSink();
    const b = collectingSink();
    await hub.subscribe(USER, [`user:${USER}`], a, async () => true);
    await hub.subscribe(USER, [`user:${USER}`], b, async () => true);

    const result = hub.publish(`user:${USER}`, event());
    expect(result).toEqual({ delivered: 2, saturated: 0 });
    expect(a.received).toHaveLength(1);
    expect(b.received).toHaveLength(1);
  });

  it("counts a saturated sink instead of retrying it", async () => {
    const hub = new SubscriptionHub();
    await hub.subscribe(USER, [`user:${USER}`], { send: () => false }, async () => true);

    // Retrying a full sink makes it fuller. The event is dropped and the sink
    // resyncs from the log — safe precisely because the log is authoritative.
    expect(hub.publish(`user:${USER}`, event())).toEqual({ delivered: 0, saturated: 1 });
  });

  it("is a no-op on a channel nobody watches", () => {
    const hub = new SubscriptionHub();
    expect(hub.publish(`user:${USER}`, event())).toEqual({ delivered: 0, saturated: 0 });
  });

  it("stops delivering after the disposer runs", async () => {
    const hub = new SubscriptionHub();
    const sink = collectingSink();
    const dispose = await hub.subscribe(USER, [`user:${USER}`], sink, async () => true);

    hub.publish(`user:${USER}`, event());
    dispose();
    hub.publish(`user:${USER}`, event());

    expect(sink.received).toHaveLength(1);
    // The emptied channel is removed, so `stats()` cannot grow without bound.
    expect(hub.stats()).toEqual({ channels: 0, sinks: 0 });
  });

  it("disposes a multi-channel subscription from every channel", async () => {
    const hub = new SubscriptionHub();
    const sink = collectingSink();
    const dispose = await hub.subscribe(
      USER,
      [`user:${USER}`, `strategy:${STRATEGY}`],
      sink,
      async () => true,
    );
    expect(hub.stats().channels).toBe(2);

    dispose();
    expect(hub.stats()).toEqual({ channels: 0, sinks: 0 });
  });
});

describe("channelsFor", () => {
  it("always includes the user channel, since strategies outlive sessions", () => {
    expect(SubscriptionHub.channelsFor({ userId: USER })).toEqual([`user:${USER}`]);
  });

  it("adds the narrower channels when they are known", () => {
    expect(
      SubscriptionHub.channelsFor({ userId: USER, strategyId: STRATEGY, runId: "run-1" }),
    ).toEqual([`user:${USER}`, `strategy:${STRATEGY}`, "run:run-1"]);
  });

  it("omits a channel it has no id for, rather than emitting a malformed one", () => {
    const channels = SubscriptionHub.channelsFor({ userId: USER, strategyId: undefined });
    expect(channels).toHaveLength(1);
    expect(channels.some((channel) => channel.includes("undefined"))).toBe(false);
  });
});
