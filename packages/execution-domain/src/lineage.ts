/**
 * The lineage: session → strategy → run → intent → step.
 *
 * This is the chain that makes the dashboard possible. Given a user, walk down
 * to the live status of what their strategy is doing; given a trace, walk back
 * up to what authorised it.
 *
 * ```
 * user ─┬─ strategy (durable: mandate + risk thresholds)   ← the thing you own
 *       │        └─ run (event-triggered: risk_breach | user | agent | schedule)
 *       │               ├─ simulation ── path ─(selected)─┐
 *       │               └─ intent ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┴─ step ── event
 *       ├─ session (short-lived: where the user was working)
 *       └─ account (signer)
 * ```
 *
 * Two consequences of how rebalancing actually works shape this:
 *
 * 1. **A strategy is durable; a rebalance is an event.** The risk engine reports
 *    a breached parameter and the agent rebalances then — a discrete, minutes-long
 *    execution, not a process running for months. So the durable parent is the
 *    strategy, owned by the user directly.
 * 2. **A session is an interaction context, not a container.** A run records the
 *    session it happened during as nullable audit metadata, which is what lets a
 *    risk-triggered rebalance run at 3am with nobody logged in.
 *
 * Identity is branded so a `RunId` can never be passed where a `StrategyId` is
 * expected — a class of bug that is otherwise silent, because both are strings.
 */
import { z } from "zod";

// ── Branded identifiers ─────────────────────────────────────────────────────

export const UserIdSchema = z.string().min(1).brand<"UserId">();
export const SessionIdSchema = z.uuid().brand<"SessionId">();
export const AccountIdSchema = z.uuid().brand<"AccountId">();
export const StrategyIdSchema = z.uuid().brand<"StrategyId">();
export const RunIdSchema = z.uuid().brand<"RunId">();
export const SimulationIdSchema = z.uuid().brand<"SimulationId">();
export const PathIdSchema = z.uuid().brand<"PathId">();
export const IntentIdSchema = z.uuid().brand<"IntentId">();
export const StepIdSchema = z.uuid().brand<"StepId">();
export const EventIdSchema = z.uuid().brand<"EventId">();

/** A Privy DID — the tenant key carried on every table. */
export type UserId = z.infer<typeof UserIdSchema>;
export type SessionId = z.infer<typeof SessionIdSchema>;
export type AccountId = z.infer<typeof AccountIdSchema>;
export type StrategyId = z.infer<typeof StrategyIdSchema>;
export type RunId = z.infer<typeof RunIdSchema>;
export type SimulationId = z.infer<typeof SimulationIdSchema>;
export type PathId = z.infer<typeof PathIdSchema>;
export type IntentId = z.infer<typeof IntentIdSchema>;
export type StepId = z.infer<typeof StepIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;

// ── Sessions ────────────────────────────────────────────────────────────────

/** Which agent the user was working with. */
export const AGENT_KINDS = ["v01", "deep", "desk"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];
export const AgentKindSchema = z.enum(AGENT_KINDS);

export const SESSION_STATUSES = ["open", "paused", "closed"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const SessionStatusSchema = z.enum(SESSION_STATUSES);

/**
 * A period during which a user was working with an agent.
 *
 * Deliberately short-lived, and nothing depends on it staying open. `threadId`
 * is the graph thread that makes the agent's state resumable.
 */
export const SessionSchema = z.object({
  sessionId: SessionIdSchema,
  userId: UserIdSchema,
  agent: AgentKindSchema,
  status: SessionStatusSchema,
  /** Resumable LangGraph thread, when the agent keeps one. */
  threadId: z.string().min(1).nullable(),
  /** The mandate as it stood when the session opened. */
  mandateSnapshot: z.record(z.string(), z.json()),
  startedAt: z.date(),
  lastActiveAt: z.date(),
  closedAt: z.date().nullable(),
});
export type Session = z.infer<typeof SessionSchema>;

// ── Strategies (durable) ────────────────────────────────────────────────────

export const STRATEGY_STATUSES = ["active", "paused", "retired"] as const;
export type StrategyStatus = (typeof STRATEGY_STATUSES)[number];
export const StrategyStatusSchema = z.enum(STRATEGY_STATUSES);

/**
 * A threshold the risk engine watches.
 *
 * `metric` is a pool metric (`apy`, `tvl`, `utilization`) or a risk score; the
 * engine notifies when `comparison` holds against `value`. Kept as data so the
 * trigger is configurable per strategy rather than hard-coded per protocol.
 */
export const RiskThresholdSchema = z.object({
  metric: z.string().min(1),
  comparison: z.enum(["above", "below"]),
  value: z.number(),
  /** How long the condition must hold before it counts, in minutes. */
  forMinutes: z.number().int().nonnegative().default(0),
});
export type RiskThreshold = z.infer<typeof RiskThresholdSchema>;

/**
 * What the user owns — the durable entity.
 *
 * Owned by the user directly, **not** by a session: a strategy outlives the
 * interaction that created it, and that is what makes event-driven rebalancing
 * possible.
 */
export const StrategySchema = z.object({
  strategyId: StrategyIdSchema,
  userId: UserIdSchema,
  name: z.string().min(1),
  mandate: z.record(z.string(), z.json()),
  /** A breach of any of these starts a `risk_breach` run. */
  riskThresholds: z.array(RiskThresholdSchema),
  status: StrategyStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Strategy = z.infer<typeof StrategySchema>;

// ── Runs ────────────────────────────────────────────────────────────────────

/**
 * What started a run.
 *
 * `risk_breach` is the one that matters most: the service does **not** detect
 * drift itself, it receives a breach from the risk engine. Cadence therefore
 * falls out of market conditions — monthly in calm markets, weekly or daily
 * when volatility rises.
 */
export const RUN_TRIGGERS = ["user", "agent", "risk_breach", "schedule"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];
export const RunTriggerSchema = z.enum(RUN_TRIGGERS);

/** Why a `risk_breach` run exists — the audit answer to "why did this happen?". */
export const TriggerDetailSchema = z.object({
  metric: z.string().min(1),
  comparison: z.enum(["above", "below"]),
  threshold: z.number(),
  /** What the metric actually was when the breach was reported. */
  observed: z.number(),
  /** ISO timestamp the risk engine reported it. */
  reportedAt: z.iso.datetime(),
  /** Free-form provenance: which evaluator or job reported it. */
  source: z.string().min(1).nullable(),
});
export type TriggerDetail = z.infer<typeof TriggerDetailSchema>;

export const RUN_MODES = ["dry", "live"] as const;
export type RunMode = (typeof RUN_MODES)[number];
export const RunModeSchema = z.enum(RUN_MODES);

/**
 * One execution of a strategy.
 *
 * `parentRunId` carries rebalance lineage: a rebalance is a child of the run
 * whose position it adjusted.
 */
export const RunSchema = z.object({
  runId: RunIdSchema,
  strategyId: StrategyIdSchema,
  userId: UserIdSchema,
  /** Nullable — the interaction it ran during, when there was one. */
  sessionId: SessionIdSchema.nullable(),
  parentRunId: RunIdSchema.nullable(),
  trigger: RunTriggerSchema,
  triggerDetail: TriggerDetailSchema.nullable(),
  mode: RunModeSchema,
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
});
export type Run = z.infer<typeof RunSchema>;

// ── Accounts ────────────────────────────────────────────────────────────────

/**
 * The two shapes a user's funds can live behind.
 *
 * `smart` is a Privy smart account (Safe is a supported type) and signs within
 * a policy, optionally co-signed by the user. `eoa` is a Privy embedded EOA and
 * signs directly — which is what Polymarket's CLOB requires.
 */
export const ACCOUNT_KINDS = ["eoa", "smart"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
export const AccountKindSchema = z.enum(ACCOUNT_KINDS);

export const AccountSchema = z.object({
  accountId: AccountIdSchema,
  userId: UserIdSchema,
  kind: AccountKindSchema,
  chainId: z.number().int().positive(),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  privyWalletId: z.string().min(1),
});
export type Account = z.infer<typeof AccountSchema>;
