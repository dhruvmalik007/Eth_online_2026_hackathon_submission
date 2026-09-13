/**
 * The composition root — the single place concrete adapters are chosen.
 *
 * Mirrors `apps/indexer`'s runtime so the two services are read the same way, but
 * adds the pieces the indexer does not need: a **long-lived** process whose
 * repositories are reused across requests rather than rebuilt per invocation, and
 * a **write buffer** whose bound comes from `EXECUTION_EVENT_BUFFER`.
 *
 * Every dependency is injectable. Tests supply fakes and never touch a database,
 * which is what lets the route layer be tested offline.
 */
import {
  ExecutionEventBuffer,
  ExecutionRepository,
  PgSqlRunner,
  SessionRepository,
  StrategyRepository,
  type ExecutionEventRow,
  type SqlRunner,
} from "@ethonline2026/timeseries";
import { createAquaSurface, type AquaSurface } from "./aqua.js";
import { DEFAULT_APPROVAL_LIMITS, NO_MANDATES, type ApprovalLimits, type MandateSource } from "./approval.js";
import { NO_RISK_REPORTS, type RiskReportSource } from "./risk.js";
import { createVenueRegistry, type VenueRegistry } from "./venues.js";
import { loadExecutionEnv, type ExecutionEnv } from "./env.js";
import type { EvmSigner } from "./evmSigner.js";
import { bindSigner } from "./signerBinding.js";
import { SubscriptionHub } from "./ws.js";

/** Everything a route handler may reach. No handler imports an adapter directly. */
export interface ExecutionRuntime {
  readonly env: ExecutionEnv;
  readonly runner: SqlRunner;
  readonly sessions: SessionRepository;
  readonly strategies: StrategyRepository;
  readonly history: ExecutionRepository;
  /**
   * Buffered execution-event writes.
   *
   * `EXECUTION_EVENT_BUFFER` sets the batch size; a flush writes the batch as one
   * statement and fans the written rows out to {@link hub}. The lifecycle worker
   * (Phase 5) is the producer — it accumulates events here rather than issuing a
   * write per state change.
   */
  readonly events: ExecutionEventBuffer;
  /** The WebSocket fan-out a flushed batch is published into. */
  readonly hub: SubscriptionHub;
  /**
   * Signs and broadcasts an approved intent's payloads.
   *
   * Absent unless the composition root binds one, and there is deliberately no default: a signer that
   * appears without being asked for is a key nobody chose to load. Its absence is a 503 on the two
   * routes that need it, which is a deployment statement rather than a silent failure.
   */
  readonly signer?: EvmSigner;
  /**
   * The 1inch Aqua/SwapVM surface, or `undefined` when the venue is off.
   *
   * Absent rather than disabled: with `ONEINCH_AQUA_ENABLED` off there is nothing for a route to
   * reach, so the flag cannot be forgotten at a call site. An injected surface is the caller's,
   * which is how a test exercises the enabled path without an RPC.
   */
  readonly aqua?: AquaSurface;
  /**
   * Which venues this deployment can run legs through.
   *
   * Always present, unlike `aqua`: an empty registry is a valid answer, and a caller that had to
   * check for absence would conflate "no venues configured" with "the feature is off".
   */
  readonly venues: VenueRegistry;
  /**
   * Where the agent's risk verdicts come from.
   *
   * Always present, defaulting to "no reports", which renders as `unreported`. This service does not
   * infer risk — it asks the agentic pipeline for a verdict and presents it. Nothing here blocks
   * anything; see `risk.ts` for why that separation is load-bearing.
   */
  readonly riskReports: RiskReportSource;
  /**
   * The approval mandate: whether an operator must approve, and the most one agent may commit.
   *
   * The only thing that permits execution, and required by default.
   */
  readonly approvalLimits: ApprovalLimits;
  /**
   * Per-agent mandates. Defaults to none stored, which makes every agent fall back to the
   * deployment default — the behaviour that existed before mandates became storable.
   */
  readonly mandates: MandateSource;
}

/** Overrides for tests and for embedding the service in another process. */
export interface RuntimeOverrides {
  readonly env?: ExecutionEnv;
  readonly runner?: SqlRunner;
  readonly sessions?: SessionRepository;
  readonly strategies?: StrategyRepository;
  readonly history?: ExecutionRepository;
  readonly events?: ExecutionEventBuffer;
  readonly hub?: SubscriptionHub;
  readonly signer?: EvmSigner;
  readonly aqua?: AquaSurface;
  /** Venue executors to consider. Supplied by the composition root; see `venues.ts`. */
  readonly venueCandidates?: Parameters<typeof createVenueRegistry>[1];
  readonly venues?: VenueRegistry;
  readonly riskReports?: RiskReportSource;
  readonly approvalLimits?: ApprovalLimits;
  readonly mandates?: MandateSource;
}

/**
 * Fan one written event out over the channels it concerns.
 *
 * Only `user:` and `run:` can be derived from the row itself; an event carries no
 * `strategy_id`, so a `strategy:` subscriber is served by the read model rather
 * than this path. The `user:` channel is the dashboard's default and is always
 * reached.
 */
function publishEvent(hub: SubscriptionHub, event: ExecutionEventRow): void {
  const channels = SubscriptionHub.channelsFor({
    userId: event.userId,
    runId: event.runId ?? undefined,
  });
  for (const channel of channels) hub.publish(channel, event);
}

/**
 * Build the runtime.
 *
 * Synchronous by design: the Postgres pool is lazy, so constructing the runtime
 * does not open a connection. A service that connects at boot would fail a
 * cold start whenever the database blipped, which on a scale-to-zero host is
 * most of its life.
 */
export function createRuntime(overrides: RuntimeOverrides = {}): ExecutionRuntime {
  const env = overrides.env ?? loadExecutionEnv();
  const runner = overrides.runner ?? PgSqlRunner.fromEnv();
  const history = overrides.history ?? new ExecutionRepository(runner);
  const hub = overrides.hub ?? new SubscriptionHub();
  // `undefined` is the off state, so this is deliberately not a throw: an unconfigured venue is a
  // complete configuration, not a boot failure.
  const aqua = overrides.aqua ?? createAquaSurface(env);

  /**
   * The signer, if this deployment was given a key.
   *
   * An override wins (tests inject fakes); otherwise the key comes from configuration. Still no
   * default *key* — a signer that appears without being asked for is a key nobody chose to load —
   * but a key that was asked for now binds here rather than only at the container entrypoint, so the
   * Vercel function and the container cannot disagree about whether signing is available.
   */
  const signer = overrides.signer ?? bindSigner(env)?.signer;

  const events =
    overrides.events ??
    new ExecutionEventBuffer(history, {
      maxEvents: env.EXECUTION_EVENT_BUFFER,
      onFlush: ({ events: written, inserted }) => {
        // `recordEvents` is idempotent, so `inserted === 0` is a replay: the rows
        // are already in the log and already fanned out once. Publishing again
        // would double-deliver to every live socket.
        if (inserted === 0) return;
        for (const event of written) publishEvent(hub, event);
      },
    });

  return {
    env,
    runner,
    sessions: overrides.sessions ?? new SessionRepository(runner),
    strategies: overrides.strategies ?? new StrategyRepository(runner),
    history,
    events,
    hub,
    venues: overrides.venues ?? createVenueRegistry(env, overrides.venueCandidates ?? []),
    riskReports: overrides.riskReports ?? NO_RISK_REPORTS,
    mandates: overrides.mandates ?? NO_MANDATES,
    approvalLimits: overrides.approvalLimits ?? {
      requiredByDefault: env.APPROVAL_REQUIRED_BY_DEFAULT,
      maxSpendUsdPerIntent: env.APPROVAL_MAX_SPEND_USD,
    },
    // Conditional spread because `exactOptionalPropertyTypes` distinguishes an absent key from a
    // key set to undefined.
    ...(aqua === undefined ? {} : { aqua }),
    ...(signer === undefined ? {} : { signer }),
  };
}

/**
 * Drain the write buffer, then release pooled connections.
 *
 * The order is the point. A shutdown that closed the pool first would leave any
 * buffered events with nowhere to go — and on a scale-to-zero host, SIGTERM is
 * routine rather than exceptional, so this is the difference between a complete
 * trace and a truncated one. Flushing through the repository is safe to repeat:
 * the insert is idempotent on `(event_id, at)`.
 *
 * Only the pool is optionally owned; an injected runner is the caller's to close,
 * so this is tolerant of one that has no `close`.
 */
export async function closeRuntime(runtime: ExecutionRuntime): Promise<void> {
  try {
    await runtime.events.flush();
  } finally {
    const runner = runtime.runner as { close?: () => Promise<void> };
    if (typeof runner.close === "function") {
      await runner.close();
    }
  }
}
