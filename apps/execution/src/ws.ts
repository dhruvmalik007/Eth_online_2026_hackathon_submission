/**
 * The subscription hub — T2.3.
 *
 * ## Transport-agnostic on purpose
 *
 * This holds no socket. A `ws` or SSE adapter binds to {@link EventSink} later,
 * which keeps the interesting logic — scoping, fan-out, backpressure, resync —
 * testable without a network or a dependency. The transport is the least
 * interesting part and the most annoying to test.
 *
 * ## Channels follow the lineage, not a run
 *
 * The dashboard shows a user's strategies, so `user:` is the default channel — a
 * `run:` subscription would show one execution when the question is "what is
 * everything doing?". `session:` exists for audit, not as the default, because a
 * strategy outlives the session that created it.
 *
 * ## The one check this can make locally
 *
 * A `user:` channel carries its own owner, so a mismatch is detectable here and
 * is refused. `strategy:` and `run:` ids do **not** carry ownership — verifying
 * those requires the repository, so {@link verifyOwnership} is the caller's
 * obligation and is typed to force a decision rather than be forgotten.
 */
import type { ExecutionEventRow } from "@ethonline2026/timeseries";

/** The three subscription shapes, all derived from the authenticated user. */
export type Channel = `user:${string}` | `strategy:${string}` | `run:${string}`;

/** A destination for events. One per socket. */
export interface EventSink {
  /**
   * Deliver one event, returning `false` when the sink is saturated.
   *
   * Returning a boolean rather than throwing puts backpressure in the type: a
   * caller cannot ignore it and leave the hub buffering without bound.
   */
  send(event: ExecutionEventRow): boolean;
}

/** A delivery attempt's outcome, so a saturated subscriber is visible. */
export interface PublishResult {
  readonly delivered: number;
  /** Sinks that refused the event. Each needs a resync, not a retry. */
  readonly saturated: number;
}

/** A channel whose owner has been established. */
export interface OwnedSubscription {
  readonly channel: Channel;
  readonly sink: EventSink;
}

/**
 * Confirm a non-user channel belongs to this user.
 *
 * Injected because the answer lives in the database, and a hub that trusted its
 * caller would be a hub that leaks another user's executions. Typed as a
 * required dependency so it cannot be forgotten.
 */
export type VerifyOwnership = (userId: string, channel: Channel) => Promise<boolean>;

/** Thrown when a subscription would cross a user boundary. */
export class SubscriptionRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionRefusedError";
  }
}

export class SubscriptionHub {
  private readonly subscribers = new Map<Channel, Set<EventSink>>();

  /**
   * Attach a sink to channels, refusing any it does not own.
   *
   * Returns a disposer. Every path that adds a subscription must be able to
   * remove it, or a redeploy leaks sinks for the process's lifetime.
   */
  async subscribe(
    userId: string,
    channels: readonly Channel[],
    sink: EventSink,
    verify: VerifyOwnership,
  ): Promise<() => void> {
    for (const channel of channels) {
      if (channel.startsWith("user:")) {
        // The owner is part of the channel, so this needs no database round trip.
        if (channel !== `user:${userId}`) {
          throw new SubscriptionRefusedError(
            `refusing to subscribe ${userId} to ${channel}: channel owner differs`,
          );
        }
        continue;
      }
      if (!(await verify(userId, channel))) {
        throw new SubscriptionRefusedError(
          `refusing to subscribe ${userId} to ${channel}: not owned by this user`,
        );
      }
    }

    for (const channel of channels) {
      const set = this.subscribers.get(channel) ?? new Set<EventSink>();
      set.add(sink);
      this.subscribers.set(channel, set);
    }

    return () => {
      for (const channel of channels) {
        const set = this.subscribers.get(channel);
        if (set === undefined) continue;
        set.delete(sink);
        // Drop the channel when it empties, so `stats()` reflects reality rather
        // than every channel ever seen.
        if (set.size === 0) this.subscribers.delete(channel);
      }
    };
  }

  /**
   * Fan an event out to a channel's sinks.
   *
   * A sink that refuses is counted rather than retried: it is saturated, and
   * re-sending the same event makes that worse. The caller marks it for resync,
   * which replays from the log — the log being authoritative is what makes
   * dropping safe.
   */
  publish(channel: Channel, event: ExecutionEventRow): PublishResult {
    const set = this.subscribers.get(channel);
    if (set === undefined) return { delivered: 0, saturated: 0 };

    let delivered = 0;
    let saturated = 0;
    for (const sink of set) {
      if (sink.send(event)) delivered += 1;
      else saturated += 1;
    }
    return { delivered, saturated };
  }

  /** The channels an event should reach, given what it concerns. */
  static channelsFor(event: {
    userId: string;
    strategyId?: string | undefined;
    runId?: string | undefined;
  }): readonly Channel[] {
    const channels: Channel[] = [`user:${event.userId}`];
    // Ordered narrowest-last so a consumer reading them sees the coarsest first.
    if (event.strategyId !== undefined) channels.push(`strategy:${event.strategyId}`);
    if (event.runId !== undefined) channels.push(`run:${event.runId}`);
    return channels;
  }

  /** Live counts, for the health endpoint. */
  stats(): { readonly channels: number; readonly sinks: number } {
    let sinks = 0;
    for (const set of this.subscribers.values()) sinks += set.size;
    return { channels: this.subscribers.size, sinks };
  }
}
