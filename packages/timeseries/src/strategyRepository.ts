/**
 * The planning side of the execution schema — sessions and strategies.
 *
 * Split from `executionHistory.ts` because the two have different lifecycles:
 * that file owns the **trace** (append-only, high volume, written by the worker),
 * this one owns the **planning entities** (durable, low volume, written by the
 * user's own actions).
 *
 * The relationship is the one your correction established: a **strategy is
 * durable and owned by the user**, and a **session is a short-lived interaction
 * context** linked only to the runs that happened during it. Nothing here scopes
 * a strategy to a session.
 */
import { z } from "zod";
import { RiskThresholdSchema } from "@ethonline2026/execution-domain";
import type { SessionId, StrategyId, UserId } from "@ethonline2026/execution-domain";
import type { SqlRunner } from "./runner.js";
import { ExecutionRepository, type RunSummary } from "./executionHistory.js";
import { asDate, asString } from "./wire.js";

/** Which agent a session was opened with. */
export const SESSION_AGENTS = ["v01", "deep", "desk"] as const;
export const SESSION_STATUSES = ["open", "paused", "closed"] as const;
export const STRATEGY_STATUSES = ["active", "paused", "retired"] as const;

export interface SessionRow {
  readonly sessionId: string;
  readonly userId: string;
  readonly agent: (typeof SESSION_AGENTS)[number];
  readonly status: (typeof SESSION_STATUSES)[number];
  readonly threadId: string | null;
  readonly startedAt: Date;
  readonly lastActiveAt: Date;
  readonly closedAt: Date | null;
}

export interface StrategyRow {
  readonly strategyId: string;
  readonly userId: string;
  readonly name: string;
  readonly mandate: Record<string, unknown>;
  readonly riskThresholds: readonly z.infer<typeof RiskThresholdSchema>[];
  readonly status: (typeof STRATEGY_STATUSES)[number];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const SESSION_COLUMNS = 'session_id, user_id, agent, status, thread_id, started_at, last_active_at, closed_at';
const STRATEGY_COLUMNS = 'strategy_id, user_id, name, mandate, risk_thresholds, status, created_at, updated_at';

const JSON_RECORD = z.record(z.string(), z.json());
const THRESHOLD_LIST = z.array(RiskThresholdSchema);

export class SessionRepository {
  /**
   * @param runner - the store connection.
   * @param history - owns `exec_runs` SQL, so the session→runs hop reuses it
   *   rather than duplicating the run column list in two places.
   */
  constructor(
    private readonly runner: SqlRunner,
    private readonly history: ExecutionRepository = new ExecutionRepository(runner),
  ) {}

  /**
   * Open a session for a user.
   *
   * Idempotent on `session_id`, so a client that retries a create does not end
   * up with two sessions for one interaction.
   */
  async open(input: {
    readonly sessionId: string;
    readonly userId: string;
    readonly agent: SessionRow['agent'];
    readonly threadId?: string | null;
    readonly mandateSnapshot?: Record<string, unknown>;
  }): Promise<SessionRow> {
    const result = await this.runner.query(
      `INSERT INTO exec_sessions (session_id, user_id, agent, thread_id, mandate_snapshot)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (session_id) DO UPDATE SET last_active_at = now()
       RETURNING ${SESSION_COLUMNS}`,
      [
        input.sessionId,
        input.userId,
        input.agent,
        input.threadId ?? null,
        JSON.stringify(input.mandateSnapshot ?? {}),
      ],
    );
    return toSession(result.rows[0]);
  }

  /** Mark a session as used — drives the dashboard's "most recent first" order. */
  async touch(userId: string, sessionId: string): Promise<void> {
    await this.runner.query(
      'UPDATE exec_sessions SET last_active_at = now() WHERE user_id = $1 AND session_id = $2',
      [userId, sessionId],
    );
  }

  /** Close a session. Idempotent: closing an already-closed session is a no-op. */
  async close(userId: string, sessionId: string): Promise<boolean> {
    const result = await this.runner.query(
      `UPDATE exec_sessions SET status = 'closed', closed_at = now()
       WHERE user_id = $1 AND session_id = $2 AND status <> 'closed'
       RETURNING session_id`,
      [userId, sessionId],
    );
    return result.rows.length === 1;
  }

  /** A user's sessions, most recently active first. */
  async list(userId: string, limit = 50): Promise<readonly SessionRow[]> {
    const result = await this.runner.query(
      `SELECT ${SESSION_COLUMNS} FROM exec_sessions
       WHERE user_id = $1 ORDER BY last_active_at DESC LIMIT $2`,
      [userId, limit],
    );
    return result.rows.map(toSession);
  }

  /** One session, scoped to its owner. */
  async get(userId: string, sessionId: string): Promise<SessionRow | null> {
    const result = await this.runner.query(
      `SELECT ${SESSION_COLUMNS} FROM exec_sessions WHERE user_id = $1 AND session_id = $2`,
      [userId, sessionId],
    );
    return result.rows[0] === undefined ? null : toSession(result.rows[0]);
  }

  /**
   * The runs that happened during this session — the §5.3 hop session → runs.
   *
   * Only runs that named the session are returned. A risk-triggered rebalance has
   * no session by design, so it will not appear — that is the audit distinction,
   * not a missing row.
   */
  async runs(userId: string, sessionId: string, limit = 50): Promise<readonly RunSummary[]> {
    return this.history.runsForSession(userId, sessionId, limit);
  }
}

export class StrategyRepository {
  /**
   * @param runner - the store connection.
   * @param history - owns `exec_runs` SQL, so the strategy→runs hop reuses it
   *   rather than duplicating the run column list in two places.
   */
  constructor(
    private readonly runner: SqlRunner,
    private readonly history: ExecutionRepository = new ExecutionRepository(runner),
  ) {}

  /**
   * Define a durable strategy.
   *
   * `riskThresholds` is what the risk engine watches; a breach is what starts a
   * rebalance run, so a strategy with none can never be triggered automatically.
   */
  async create(input: {
    readonly strategyId: string;
    readonly userId: string;
    readonly name: string;
    readonly mandate?: Record<string, unknown>;
    readonly riskThresholds?: readonly z.input<typeof RiskThresholdSchema>[];
  }): Promise<StrategyRow> {
    const result = await this.runner.query(
      `INSERT INTO exec_strategies (strategy_id, user_id, name, mandate, risk_thresholds)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT (strategy_id) DO NOTHING
       RETURNING ${STRATEGY_COLUMNS}`,
      [
        input.strategyId,
        input.userId,
        input.name,
        JSON.stringify(input.mandate ?? {}),
        JSON.stringify(input.riskThresholds ?? []),
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      // ON CONFLICT DO NOTHING means an existing id returns nothing; read it
      // back rather than reporting a create that did not happen.
      const existing = await this.get(input.userId, input.strategyId);
      if (existing === null) throw new Error(`strategy ${input.strategyId} not found after upsert`);
      return existing;
    }
    return toStrategy(row);
  }

  /** A user's strategies — the dashboard's home list. */
  async list(userId: string): Promise<readonly StrategyRow[]> {
    const result = await this.runner.query(
      `SELECT ${STRATEGY_COLUMNS} FROM exec_strategies
       WHERE user_id = $1 AND status <> 'retired' ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows.map(toStrategy);
  }

  /** One strategy, scoped to its owner. */
  async get(userId: string, strategyId: string): Promise<StrategyRow | null> {
    const result = await this.runner.query(
      `SELECT ${STRATEGY_COLUMNS} FROM exec_strategies WHERE user_id = $1 AND strategy_id = $2`,
      [userId, strategyId],
    );
    return result.rows[0] === undefined ? null : toStrategy(result.rows[0]);
  }

  /**
   * A strategy's whole history, newest first — the §5.3 hop strategy → runs.
   *
   * This is what makes a rebalance lineage visible: each child run carries a
   * `trigger = 'risk_breach'`, so the list reads as the strategy's decision log
   * rather than as isolated executions.
   */
  async runs(userId: string, strategyId: string, limit = 50): Promise<readonly RunSummary[]> {
    return this.history.runsForStrategy(userId, strategyId, limit);
  }

  /**
   * Replace a strategy's thresholds.
   *
   * Wholesale replacement rather than a merge: a threshold the caller omitted is
   * one they no longer want watched, and silently keeping it would leave the
   * engine triggering on a parameter the user believed they had removed.
   */
  async setThresholds(
    userId: string,
    strategyId: string,
    thresholds: readonly z.input<typeof RiskThresholdSchema>[],
  ): Promise<boolean> {
    const result = await this.runner.query(
      `UPDATE exec_strategies SET risk_thresholds = $1::jsonb, updated_at = now()
       WHERE user_id = $2 AND strategy_id = $3
       RETURNING strategy_id`,
      [JSON.stringify(thresholds), userId, strategyId],
    );
    return result.rows.length === 1;
  }

  /** Retire or re-activate a strategy. */
  async setStatus(
    userId: string,
    strategyId: string,
    status: StrategyRow['status'],
  ): Promise<boolean> {
    const result = await this.runner.query(
      `UPDATE exec_strategies SET status = $1, updated_at = now()
       WHERE user_id = $2 AND strategy_id = $3
       RETURNING strategy_id`,
      [status, userId, strategyId],
    );
    return result.rows.length === 1;
  }
}

function toSession(row: Record<string, unknown> | undefined): SessionRow {
  if (row === undefined) throw new Error("session row missing");
  return {
    sessionId: asString(row['session_id']) ?? '',
    userId: asString(row['user_id']) ?? '',
    agent: (asString(row['agent']) ?? 'v01') as SessionRow['agent'],
    status: (asString(row['status']) ?? 'open') as SessionRow['status'],
    threadId: asString(row['thread_id']),
    startedAt: asDate(row['started_at']) ?? new Date(0),
    lastActiveAt: asDate(row['last_active_at']) ?? new Date(0),
    closedAt: asDate(row['closed_at']),
  };
}

function toStrategy(row: Record<string, unknown> | undefined): StrategyRow {
  if (row === undefined) throw new Error("strategy row missing");
  const mandate = JSON_RECORD.safeParse(row['mandate']);
  const thresholds = THRESHOLD_LIST.safeParse(row['risk_thresholds']);
  return {
    strategyId: asString(row['strategy_id']) ?? '',
    userId: asString(row['user_id']) ?? '',
    name: asString(row['name']) ?? '',
    mandate: mandate.success ? mandate.data : {},
    riskThresholds: thresholds.success ? thresholds.data : [],
    status: (asString(row['status']) ?? 'active') as StrategyRow['status'],
    createdAt: asDate(row['created_at']) ?? new Date(0),
    updatedAt: asDate(row['updated_at']) ?? new Date(0),
  };
}

/** Re-exported so callers need only this module for the planning vocabulary. */
export type { SessionId, StrategyId, UserId };
