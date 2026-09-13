/**
 * Execution-history repositories — the `exec_*` tables.
 *
 * Modelled on {@link RiskHistoryRepository}: zod-validate before writing, batched
 * inserts, `ON CONFLICT DO NOTHING` for append-only data, and every read scoped
 * by `userId`.
 *
 * ## Two things this file is deliberate about
 *
 * **Batched writes.** The lifecycle emits an event per state change, so a single
 * execution can produce hundreds of rows. Writing them one at a time would be
 * hundreds of round trips against a five-connection pool; {@link
 * ExecutionRepository.recordEvents} writes them as **one** multi-row statement.
 *
 * **Guard-railed transitions.** {@link ExecutionRepository.advanceRun} calls the
 * state machine's `assertTransition` before writing and then updates
 * `WHERE status = <expected from>`. The first stops an illegal state reaching the
 * database; the second stops two writers racing to apply different transitions
 * to the same run.
 *
 * @remarks
 * The row schemas live here rather than in `types.ts` because they are wire
 * shapes for this repository rather than the package's public domain vocabulary.
 * They should move once the rest of the execution vocabulary lands there.
 */
import { z } from "zod";
import { RUN_STATES, assertTransition, isRunInFlight } from "@ethonline2026/execution-domain";
import type { RunState } from "@ethonline2026/execution-domain";
import type { SqlRunner } from "./runner.js";
import { asDate, asNumber, asString } from "./wire.js";

/** An append-only execution event — the row the live stream is built from. */
export const ExecutionEventRowSchema = z.object({
  eventId: z.string().min(1),
  at: z.date(),
  userId: z.string().min(1),
  runId: z.string().min(1).nullable(),
  intentId: z.string().min(1).nullable(),
  stepId: z.string().min(1).nullable(),
  type: z.string().min(1),
  payload: z.record(z.string(), z.json()),
});
export type ExecutionEventRow = z.infer<typeof ExecutionEventRowSchema>;

/** Mutable current state for one leg of an intent. */
export const ExecutionStepRowSchema = z.object({
  stepId: z.string().min(1),
  intentId: z.string().min(1),
  userId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  kind: z.string().min(1),
  label: z.string(),
  status: z.string().min(1),
  chainId: z.number().int().positive(),
  txHash: z.string().nullable(),
  nonce: z.number().int().nullable(),
  gasUsed: z.number().nullable(),
  srcTxHash: z.string().nullable(),
  dstTxHash: z.string().nullable(),
  guid: z.string().nullable(),
  error: z.string().nullable(),
});
export type ExecutionStepRow = z.infer<typeof ExecutionStepRowSchema>;

/** The columns a run read returns — enough for the dashboard's live-run panel. */
export interface RunSummary {
  readonly runId: string;
  readonly strategyId: string;
  readonly status: RunState;
  readonly trigger: string;
  readonly triggerDetail: Record<string, unknown> | null;
  readonly mode: string;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
}

/** Columns a step read returns, without the payload blobs. */
const STEP_COLUMNS =
  'step_id, intent_id, user_id, seq, kind, label, status, chain_id, tx_hash, nonce, gas_used, src_tx_hash, dst_tx_hash, guid, error';

/** Columns an event read returns. */
const EVENT_COLUMNS = 'event_id, at, user_id, run_id, intent_id, step_id, type, payload';

/**
 * Columns a run read returns, shared by every run query so they cannot drift.
 *
 * Takes an optional table alias because the lineage join reaches `exec_runs`
 * alongside `exec_intents`, and both carry a `status` (and `user_id`) column —
 * unqualified, that join is ambiguous rather than merely ugly.
 */
function runColumns(alias?: string): string {
  const columns = [
    'run_id',
    'strategy_id',
    'status',
    'trigger',
    'trigger_detail',
    'mode',
    'started_at',
    'finished_at',
  ];
  return columns.map((column) => (alias === undefined ? column : `${alias}.${column}`)).join(', ');
}

const RUN_COLUMNS = runColumns();

export class ExecutionRepository {
  constructor(private readonly runner: SqlRunner) {}

  /**
   * Append events as **one** statement, whatever the batch size.
   *
   * This is the hot path: the lifecycle worker accumulates events and flushes
   * them together, turning a hundred round trips into one. Idempotent on
   * `(event_id, at)`, so a replay after a crash is safe.
   *
   * @returns how many rows were actually inserted (a replay inserts none).
   */
  async recordEvents(events: readonly ExecutionEventRow[]): Promise<number> {
    if (events.length === 0) return 0;
    const validated = events.map((event) => ExecutionEventRowSchema.parse(event));

    const values: unknown[] = [];
    const tuples = validated.map((event, i) => {
      const b = i * 8;
      values.push(
        event.eventId,
        event.at,
        event.userId,
        event.runId,
        event.intentId,
        event.stepId,
        event.type,
        JSON.stringify(event.payload),
      );
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}::jsonb)`;
    });

    const result = await this.runner.query(
      `INSERT INTO exec_events (event_id, at, user_id, run_id, intent_id, step_id, type, payload)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (event_id, at) DO NOTHING
       RETURNING event_id`,
      values,
    );
    return result.rows.length;
  }

  /**
   * Events for one run, oldest first.
   *
   * Scoped by `userId` so a caller cannot read another user's trace even with a
   * correct `runId`. `since` powers the WebSocket resume and the polling
   * fallback — a client replays what it missed rather than depending on a socket
   * having survived.
   */
  async getRunEvents(
    userId: string,
    runId: string,
    since?: Date,
  ): Promise<readonly ExecutionEventRow[]> {
    const result = await this.runner.query(
      `SELECT ${EVENT_COLUMNS} FROM exec_events
       WHERE user_id = $1 AND run_id = $2 AND ($3::timestamptz IS NULL OR at > $3)
       ORDER BY at ASC`,
      [userId, runId, since ?? null],
    );
    return result.rows.map((row) => ({
      eventId: asString(row['event_id']) ?? '',
      at: asDate(row['at']) ?? new Date(0),
      userId: asString(row['user_id']) ?? '',
      runId: asString(row['run_id']),
      intentId: asString(row['intent_id']),
      stepId: asString(row['step_id']),
      type: asString(row['type']) ?? '',
      // `payload` is NOT NULL with a `{}` default, so an absent value can only
      // mean an unreadable row — `{}` keeps the event rather than dropping it.
      payload: asJsonRecord(row['payload']) ?? {},
    }));
  }

  /**
   * Insert or update steps in one statement.
   *
   * `status` is intentionally not part of the conflict update's guard: a step's
   * own state is mutable by design (that is why it is a plain table), and the
   * history of those changes lives in `exec_events`.
   */
  async upsertSteps(steps: readonly ExecutionStepRow[]): Promise<number> {
    if (steps.length === 0) return 0;
    const validated = steps.map((step) => ExecutionStepRowSchema.parse(step));

    const values: unknown[] = [];
    const tuples = validated.map((step, i) => {
      const b = i * 15;
      values.push(
        step.stepId,
        step.intentId,
        step.userId,
        step.seq,
        step.kind,
        step.label,
        step.status,
        step.chainId,
        step.txHash,
        step.nonce,
        step.gasUsed,
        step.srcTxHash,
        step.dstTxHash,
        step.guid,
        step.error,
      );
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12}, $${b + 13}, $${b + 14}, $${b + 15})`;
    });

    const result = await this.runner.query(
      `INSERT INTO exec_steps
         (step_id, intent_id, user_id, seq, kind, label, status, chain_id,
          tx_hash, nonce, gas_used, src_tx_hash, dst_tx_hash, guid, error)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (step_id) DO UPDATE SET
         status      = EXCLUDED.status,
         tx_hash     = EXCLUDED.tx_hash,
         nonce       = EXCLUDED.nonce,
         gas_used    = EXCLUDED.gas_used,
         src_tx_hash = EXCLUDED.src_tx_hash,
         dst_tx_hash = EXCLUDED.dst_tx_hash,
         guid        = EXCLUDED.guid,
         error       = EXCLUDED.error,
         updated_at  = now()
       RETURNING step_id`,
      values,
    );
    return result.rows.length;
  }

  /**
   * Apply one intent's step transitions atomically — T1.3's transaction boundary.
   *
   * A step's status and the event that records the change must land together. If
   * they could diverge, a crash between the two writes would leave a step looking
   * `confirmed` with nothing in the log to say how it got there — and the log is
   * what the dashboard rebuilds from after a disconnect, so the discrepancy would
   * be permanent rather than cosmetic. Running both in one transaction makes
   * "partially written" unrepresentable.
   *
   * Ownership is checked before any statement is issued: a caller cannot smuggle
   * a step belonging to another user, or another intent, into what looks like one
   * atomic move.
   *
   * @returns how many steps were written and how many events were inserted.
   * @throws {Error} when a step or event does not belong to this user and intent.
   */
  async applyStepTransitions(input: {
    readonly userId: string;
    readonly intentId: string;
    readonly steps: readonly ExecutionStepRow[];
    readonly events: readonly ExecutionEventRow[];
  }): Promise<{ readonly steps: number; readonly events: number }> {
    for (const step of input.steps) {
      if (step.userId !== input.userId) {
        throw new Error(`step ${step.stepId} does not belong to user ${input.userId}`);
      }
      if (step.intentId !== input.intentId) {
        throw new Error(`step ${step.stepId} does not belong to intent ${input.intentId}`);
      }
    }
    for (const event of input.events) {
      if (event.userId !== input.userId) {
        throw new Error(`event ${event.eventId} does not belong to user ${input.userId}`);
      }
      if (event.intentId !== null && event.intentId !== input.intentId) {
        throw new Error(`event ${event.eventId} does not belong to intent ${input.intentId}`);
      }
    }

    return this.runner.transaction(async (tx) => {
      // A repository bound to the transaction's connection, so both statements
      // run inside the same BEGIN/COMMIT rather than on a pooled client.
      const scoped = new ExecutionRepository(tx);
      const steps = await scoped.upsertSteps(input.steps);
      const events = await scoped.recordEvents(input.events);
      return { steps, events };
    });
  }

  /**
   * Steps still moving, for the dashboard's "what is in flight?" panel.
   *
   * Cross-chain legs sit in `bridging` for real minutes, so they are included;
   * anything terminal is not.
   */
  async liveSteps(userId: string): Promise<readonly ExecutionStepRow[]> {
    const result = await this.runner.query(
      `SELECT ${STEP_COLUMNS} FROM exec_steps
       WHERE user_id = $1
         AND status NOT IN ('confirmed', 'failed', 'skipped')
       ORDER BY updated_at DESC`,
      [userId],
    );
    return result.rows.map(toStepRow);
  }

  /** One run, scoped to its owner. */
  async getRun(userId: string, runId: string): Promise<RunSummary | null> {
    const result = await this.runner.query(
      `SELECT ${RUN_COLUMNS} FROM exec_runs WHERE user_id = $1 AND run_id = $2`,
      [userId, runId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return toRunSummary(row);
  }

  /**
   * Move a run to its next state, refusing an illegal or a stale move.
   *
   * Two guards, and both matter:
   *  - `assertTransition` runs **before** the write, so an illegal state can
   *    never reach the database where it would look like a real state.
   *  - the `WHERE status = $from` makes the update optimistic, so of two workers
   *    racing to advance the same run exactly one wins and the other is told.
   *
   * @returns true when this caller performed the transition.
   * @throws {IllegalTransitionError} when the transition itself is not legal.
   */
  async advanceRun(input: {
    readonly userId: string;
    readonly runId: string;
    readonly from: RunState;
    readonly to: RunState;
  }): Promise<boolean> {
    assertTransition(input.from, input.to);

    const result = await this.runner.query(
      `UPDATE exec_runs
       SET status = $1,
           finished_at = CASE WHEN $1 IN ('closed', 'failed') THEN now() ELSE finished_at END
       WHERE run_id = $2 AND user_id = $3 AND status = $4
       RETURNING run_id`,
      [input.to, input.runId, input.userId, input.from],
    );
    return result.rows.length === 1;
  }

  /** Runs still moving for a user, newest first. */
  async liveRuns(userId: string): Promise<readonly RunSummary[]> {
    const result = await this.runner.query(
      `SELECT ${RUN_COLUMNS} FROM exec_runs
       WHERE user_id = $1 AND status = ANY($2::text[])
       ORDER BY started_at DESC`,
      [userId, RUN_STATES_IN_FLIGHT],
    );
    return result.rows.map(toRunSummary);
  }

  /**
   * A strategy's whole history, newest first — the §5.3 hop from strategy to runs.
   *
   * Served by the `(strategy_id, started_at DESC)` index, so this is one range
   * scan rather than a filter over the user's runs. Scoped by `user_id` as well
   * as `strategy_id`, so a guessed strategy id still reads nothing.
   */
  async runsForStrategy(
    userId: string,
    strategyId: string,
    limit = 50,
  ): Promise<readonly RunSummary[]> {
    const result = await this.runner.query(
      `SELECT ${RUN_COLUMNS} FROM exec_runs
       WHERE user_id = $1 AND strategy_id = $2
       ORDER BY started_at DESC LIMIT $3`,
      [userId, strategyId, limit],
    );
    return result.rows.map(toRunSummary);
  }

  /**
   * Every run that happened during one session — the §5.3 hop from session to runs.
   *
   * `session_id` is nullable audit metadata, so this returns only runs that named
   * the session; a risk-triggered run at 3am simply has none and will not appear,
   * which is correct rather than a gap.
   */
  async runsForSession(
    userId: string,
    sessionId: string,
    limit = 50,
  ): Promise<readonly RunSummary[]> {
    const result = await this.runner.query(
      `SELECT ${RUN_COLUMNS} FROM exec_runs
       WHERE user_id = $1 AND session_id = $2
       ORDER BY started_at DESC LIMIT $3`,
      [userId, sessionId, limit],
    );
    return result.rows.map(toRunSummary);
  }

  /**
   * Walk a trace back to the run that authorised it — the §5.3 hop in reverse.
   *
   * A step alone does not carry its cause: that lives on the run (`trigger` and
   * `trigger_detail`), two hops up through `exec_intents`. This is the join that
   * answers "why did this transaction happen?", and it is scoped by `user_id` so
   * a step id from another tenant resolves to nothing.
   */
  async triggerForStep(userId: string, stepId: string): Promise<RunSummary | null> {
    const result = await this.runner.query(
      `SELECT ${runColumns('r')} FROM exec_runs r
       JOIN exec_intents i ON i.run_id = r.run_id
       JOIN exec_steps s ON s.intent_id = i.intent_id
       WHERE r.user_id = $1 AND s.step_id = $2`,
      [userId, stepId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toRunSummary(row);
  }
}

/**
 * The in-flight state list, derived from the state machine rather than re-listed.
 *
 * Asking the machine means a state added there is picked up automatically, and
 * `holding` is correctly excluded — the position is open, nothing is running.
 */
const RUN_STATES_IN_FLIGHT: readonly string[] = RUN_STATES.filter((state) =>
  isRunInFlight(state),
);

/** Map a driver row to a step. Shared with the dashboard read model. */
export function toStepRow(row: Record<string, unknown>): ExecutionStepRow {
  return {
    stepId: asString(row['step_id']) ?? '',
    intentId: asString(row['intent_id']) ?? '',
    userId: asString(row['user_id']) ?? '',
    seq: asNumber(row['seq']) ?? 0,
    kind: asString(row['kind']) ?? '',
    label: asString(row['label']) ?? '',
    status: asString(row['status']) ?? 'queued',
    chainId: asNumber(row['chain_id']) ?? 0,
    txHash: asString(row['tx_hash']),
    nonce: asNumber(row['nonce']),
    gasUsed: asNumber(row['gas_used']),
    srcTxHash: asString(row['src_tx_hash']),
    dstTxHash: asString(row['dst_tx_hash']),
    guid: asString(row['guid']),
    error: asString(row['error']),
  };
}

/** Map a driver row to a run summary. Shared with the dashboard read model. */
export function toRunSummary(row: Record<string, unknown>): RunSummary {
  return {
    runId: asString(row['run_id']) ?? '',
    strategyId: asString(row['strategy_id']) ?? '',
    status: (asString(row['status']) ?? 'draft') as RunState,
    trigger: asString(row['trigger']) ?? '',
    triggerDetail: asJsonRecord(row['trigger_detail']),
    mode: asString(row['mode']) ?? 'dry',
    startedAt: asDate(row['started_at']) ?? new Date(0),
    finishedAt: asDate(row['finished_at']),
  };
}

/** JSON value shape for a `jsonb` column. */
const JSON_RECORD = z.record(z.string(), z.json());
type JsonRecord = z.infer<typeof JSON_RECORD>;

/**
 * A `jsonb` column as a record, or `null`.
 *
 * Parsed rather than cast: driver output is `unknown`, and validating it here
 * keeps the single `unknown` boundary honest instead of scattering casts.
 */
function asJsonRecord(value: unknown): JsonRecord | null {
  if (value === null || value === undefined) return null;
  const parsed = JSON_RECORD.safeParse(value);
  return parsed.success ? parsed.data : null;
}
