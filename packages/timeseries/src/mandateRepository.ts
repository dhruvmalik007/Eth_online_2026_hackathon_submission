/**
 * Per-agent spend mandates, stored so they survive a restart and can be changed without a deploy.
 *
 * ## Why this is a table rather than an environment variable
 *
 * A mandate is a *policy about an agent*, and policies change for reasons that have nothing to do with
 * a release: a strategy's size grows, an incident tightens everyone's limit for a week, a new agent is
 * onboarded. Putting that in `APPROVAL_MAX_SPEND_USD` means every change is a deploy, and it means the
 * limit is global — one number for every agent, which is exactly what a per-agent mandate is for.
 *
 * The environment variable survives as the **default** for agents with no row. A deployment with an
 * empty table behaves as it did before, which is what makes this additive.
 *
 * ## Why the primary key is `(user_id, agent)`
 *
 * A mandate belongs to a principal's agent, not to a principal. The same operator running two agents
 * — one conservative, one opportunistic — needs two limits, and keying on the user alone would silently
 * give both the last number written.
 *
 * `updated_by` is recorded because the interesting question about a limit is rarely its value; it is
 * who raised it.
 */

import type { SqlRunner } from "./runner.js";

export interface AgentMandate {
  readonly userId: string;
  /** The agent identifier, matching `LegExecutor`/session agent names. */
  readonly agent: string;
  /** The most this agent may commit in one intent, in whole USD. */
  readonly maxSpendUsd: number;
  /** Whether an operator must approve each intent regardless of size. */
  readonly approvalRequired: boolean;
  /** Who last changed it. The interesting question about a limit is rarely its value. */
  readonly updatedBy: string;
  readonly updatedAt: Date;
}

export interface AgentMandateInput {
  readonly userId: string;
  readonly agent: string;
  readonly maxSpendUsd: number;
  readonly approvalRequired: boolean;
  readonly updatedBy: string;
}

/** A mandate that cannot be represented, reported rather than coerced into one. */
export class InvalidMandateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMandateError";
  }
}

function toMandate(row: Record<string, unknown>): AgentMandate {
  return {
    userId: String(row["user_id"]),
    agent: String(row["agent"]),
    maxSpendUsd: Number(row["max_spend_usd"]),
    approvalRequired: row["approval_required"] === true,
    updatedBy: String(row["updated_by"]),
    updatedAt: new Date(String(row["updated_at"])),
  };
}

export class AgentMandateRepository {
  constructor(private readonly runner: SqlRunner) {}

  /** The mandate for one agent, or `null` when none has been set — which is not the same as zero. */
  async get(userId: string, agent: string): Promise<AgentMandate | null> {
    const result = await this.runner.query(
      `SELECT user_id, agent, max_spend_usd, approval_required, updated_by, updated_at
         FROM exec_agent_mandates
        WHERE user_id = $1 AND agent = $2`,
      [userId, agent],
    );
    const row = result.rows[0];
    return row === undefined ? null : toMandate(row);
  }

  /** Every mandate this principal has set, for the settings surface. */
  async list(userId: string): Promise<AgentMandate[]> {
    const result = await this.runner.query(
      `SELECT user_id, agent, max_spend_usd, approval_required, updated_by, updated_at
         FROM exec_agent_mandates
        WHERE user_id = $1
        ORDER BY agent`,
      [userId],
    );
    return result.rows.map(toMandate);
  }

  /**
   * Set or replace a mandate.
   *
   * Upsert rather than insert-then-update, because a settings form saves a value and should not have
   * to know whether that value already existed. The row is replaced wholesale so a partial write
   * cannot leave the old limit beside a new approval flag.
   *
   * @throws {InvalidMandateError} on a non-positive or non-finite limit. A mandate of zero would
   *   silently forbid every trade, and a `NaN` would compare false against everything — both are
   *   worse than a rejected save.
   */
  async set(input: AgentMandateInput): Promise<AgentMandate> {
    if (!Number.isFinite(input.maxSpendUsd) || input.maxSpendUsd <= 0) {
      throw new InvalidMandateError(
        `maxSpendUsd must be a positive finite number, got ${input.maxSpendUsd}.`,
      );
    }
    if (input.agent.trim().length === 0) {
      throw new InvalidMandateError("agent must be a non-empty string.");
    }

    const result = await this.runner.query(
      `INSERT INTO exec_agent_mandates
         (user_id, agent, max_spend_usd, approval_required, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id, agent) DO UPDATE
         SET max_spend_usd     = EXCLUDED.max_spend_usd,
             approval_required = EXCLUDED.approval_required,
             updated_by        = EXCLUDED.updated_by,
             updated_at        = now()
       RETURNING user_id, agent, max_spend_usd, approval_required, updated_by, updated_at`,
      [input.userId, input.agent, input.maxSpendUsd, input.approvalRequired, input.updatedBy],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new InvalidMandateError("The mandate write returned no row.");
    }
    return toMandate(row);
  }
}
