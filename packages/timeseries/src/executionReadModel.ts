/**
 * The dashboard read model — one panel per data velocity (§5.4).
 *
 * Split from `executionHistory.ts` because the two answer different questions:
 * that file is the **write** path (the worker appending a trace), this is the
 * **read** path (the dashboard asking what is happening). Reads here are shaped
 * for a panel, not for a caller, so each one returns exactly what it renders.
 *
 * Every method is scoped by `userId` and every one is safe to call when nothing
 * is happening — a dashboard with no activity returns empty collections, not an
 * error, because "nothing is running" is a normal state rather than a failure.
 *
 * @remarks
 * Panels fall into three cadences. Only the first is genuinely real-time; the
 * rest are cached and refreshed on a schedule, so they are deliberately plain
 * reads rather than subscriptions.
 *
 * | Cadence | Panel | Mechanism |
 * |---|---|---|
 * | seconds | {@link liveRuns}, {@link transactionStatus} | pushed over the WS hub |
 * | minutes | {@link bridgeProgress} | pushed, with a slow poll underneath |
 * | hours | {@link positions}, {@link feeBreakdown} | cached, refreshed on a schedule |
 */
import type { SqlRunner } from "./runner.js";
import {
  ExecutionRepository,
  toRunSummary,
  toStepRow,
  type ExecutionStepRow,
  type RunSummary,
} from "./executionHistory.js";
import { asDate, asNumber, asString } from "./wire.js";

/** A fee as actually paid, against what was quoted. */
export interface FeeActualRow {
  readonly feeId: string;
  readonly stepId: string | null;
  readonly chainId: number;
  readonly token: string;
  readonly amount: number;
  readonly usd: number | null;
  readonly kind: string;
  /** `true` while the row is still the pre-execution estimate. */
  readonly estimated: boolean;
  readonly at: Date;
}

/** A holding at one point in time. */
export interface PositionRow {
  readonly accountId: string;
  readonly chainId: number;
  readonly protocol: string;
  readonly poolId: string;
  readonly valueUsd: number;
  readonly units: number | null;
  readonly apy: number | null;
  readonly at: Date;
}

/** The panels a dashboard renders on open — the fast ones plus the cached ones. */
export interface DashboardOverview {
  readonly liveRuns: readonly RunSummary[];
  readonly liveSteps: readonly ExecutionStepRow[];
  readonly positions: readonly PositionRow[];
  /** Freshness stamp so the UI can show a "last updated" rather than implying live data. */
  readonly asOf: Date;
}

const RUN_COLUMNS = 'run_id, strategy_id, status, trigger, trigger_detail, mode, started_at, finished_at';
const STEP_COLUMNS =
  'step_id, intent_id, user_id, seq, kind, label, status, chain_id, tx_hash, nonce, gas_used, src_tx_hash, dst_tx_hash, guid, error';
const FEE_COLUMNS = 'fee_id, step_id, chain_id, token, amount, usd, kind, estimated, at';
const POSITION_COLUMNS = 'account_id, chain_id, protocol, pool_id, value_usd, units, apy, at';

export class ExecutionReadModel {
  /**
   * @param runner - the store connection.
   * @param history - reused for the in-flight run list, so the set of "in flight"
   *   states is derived from the state machine in exactly one place instead of
   *   being re-listed as a SQL literal that could drift.
   */
  constructor(
    private readonly runner: SqlRunner,
    private readonly history: ExecutionRepository = new ExecutionRepository(runner),
  ) {}

  /**
   * The most recent run for a strategy — the dashboard's "what is it doing now?".
   *
   * Returns the newest run whatever its state, including a settled one: a
   * strategy sitting in `holding` is still the answer to that question.
   */
  async liveRun(userId: string, strategyId: string): Promise<RunSummary | null> {
    const result = await this.runner.query(
      `SELECT ${RUN_COLUMNS} FROM exec_runs
       WHERE user_id = $1 AND strategy_id = $2
       ORDER BY started_at DESC LIMIT 1`,
      [userId, strategyId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toRunSummary(row);
  }

  /** Every step of one intent, in submission order — the transaction-status panel. */
  async transactionStatus(userId: string, intentId: string): Promise<readonly ExecutionStepRow[]> {
    const result = await this.runner.query(
      `SELECT ${STEP_COLUMNS} FROM exec_steps
       WHERE user_id = $1 AND intent_id = $2 ORDER BY seq ASC`,
      [userId, intentId],
    );
    return result.rows.map(toStepRow);
  }

  /**
   * Bridge legs still awaiting an attestation — the slow panel.
   *
   * Separate from {@link transactionStatus} because a bridge is an order of
   * magnitude slower than a swap: a ZK attestation takes minutes, not seconds, so
   * the UI treats it differently rather than looking stuck.
   */
  async bridgeProgress(userId: string): Promise<readonly ExecutionStepRow[]> {
    const result = await this.runner.query(
      `SELECT ${STEP_COLUMNS} FROM exec_steps
       WHERE user_id = $1 AND kind IN ('bridge', 'lzSend', 'lzCompose')
         AND status NOT IN ('confirmed', 'failed', 'skipped')
       ORDER BY updated_at DESC`,
      [userId],
    );
    const steps = result.rows.map(toStepRow);

    /**
     * Broadcasts recorded as events, which is where every one of them actually lands.
     *
     * `exec_steps` is only reachable through a run → intent chain, and nothing in the service
     * creates those rows: `POST /runs/:id/simulate` requires a run that already exists, and there is
     * no route that makes one. So a step row is, today, unreachable from the API — while
     * `exec_events` carries no foreign keys at all and accepts a broadcast the moment it happens.
     *
     * Reading both is not a workaround layered over a bug; it is the honest description of where the
     * data is. A broadcast that happened is a broadcast that happened, whether or not a run row was
     * ever created for it, and a desk that hid it because of a missing parent row would be lying
     * about a transaction that is on chain.
     */
    const events = await this.runner.query(
      `SELECT event_id, at, user_id, intent_id, step_id, type, payload FROM exec_events
       WHERE user_id = $1 AND type = 'step.broadcast'
       ORDER BY at DESC
       LIMIT 100`,
      [userId],
    );

    const fromEvents: ExecutionStepRow[] = events.rows.map((row) => {
      const payload = (row['payload'] ?? {}) as Record<string, unknown>;
      const rawChain = asNumber(payload['chainId']);
      return {
        // `step_id` is nullable on an event, so fall back to the event's own id — it is a uuid too,
        // and the field exists to give the row a stable identity in the UI, not to join on.
        stepId: (asString(row['step_id']) ?? asString(row['event_id'])) as string,
        intentId: asString(row['intent_id']) ?? "",
        userId: asString(row['user_id']) as string,
        seq: asNumber(payload['index']) ?? 0,
        kind: "bridge",
        label: asString(payload['label']) ?? "Broadcast",
        status: "submitted",
        chainId: rawChain !== null && rawChain > 0 ? rawChain : 1,
        txHash: asString(payload['txHash']),
        nonce: null,
        gasUsed: null,
        srcTxHash: asString(payload['srcTxHash']),
        dstTxHash: asString(payload['dstTxHash']),
        guid: asString(payload['guid']),
        ...(payload['scanUrl'] === undefined ? {} : { scanUrl: asString(payload['scanUrl']) }),
        ...(payload['scanLabel'] === undefined ? {} : { scanLabel: asString(payload['scanLabel']) }),
        error: null,
      };
    });

    // Steps first: a real step row carries lifecycle a broadcast never will.
    const seen = new Set(steps.map((step) => step.txHash).filter((hash) => hash !== null));
    return [...steps, ...fromEvents.filter((event) => event.txHash === null || !seen.has(event.txHash))];
  }

  /**
   * Fees for an intent, estimated and then actual.
   *
   * Both are returned rather than only the actual, so the UI can show the
   * estimate→actual delta — which is the number a trader actually wants when a
   * quote and a fill disagree.
   */
  async feeBreakdown(userId: string, intentId: string): Promise<readonly FeeActualRow[]> {
    const result = await this.runner.query(
      `SELECT ${FEE_COLUMNS} FROM exec_fee_actuals
       WHERE user_id = $1 AND step_id IN (SELECT step_id FROM exec_steps WHERE intent_id = $2)
       ORDER BY at ASC`,
      [userId, intentId],
    );
    return result.rows.map((row) => ({
      feeId: asString(row['fee_id']) ?? '',
      stepId: asString(row['step_id']),
      chainId: asNumber(row['chain_id']) ?? 0,
      token: asString(row['token']) ?? '',
      amount: asNumber(row['amount']) ?? 0,
      usd: asNumber(row['usd']),
      kind: asString(row['kind']) ?? 'other',
      estimated: row['estimated'] === true,
      at: asDate(row['at']) ?? new Date(0),
    }));
  }

  /**
   * Current holdings — the newest snapshot per position.
   *
   * `DISTINCT ON` rather than a window function: the hypertable is indexed
   * `(user_id, at DESC)`, so this is a single index walk per position.
   */
  async positions(userId: string): Promise<readonly PositionRow[]> {
    const result = await this.runner.query(
      `SELECT DISTINCT ON (account_id, chain_id, pool_id) ${POSITION_COLUMNS}
       FROM exec_position_snapshots
       WHERE user_id = $1
       ORDER BY account_id, chain_id, pool_id, at DESC`,
      [userId],
    );
    return result.rows.map((row) => ({
      accountId: asString(row['account_id']) ?? '',
      chainId: asNumber(row['chain_id']) ?? 0,
      protocol: asString(row['protocol']) ?? '',
      poolId: asString(row['pool_id']) ?? '',
      valueUsd: asNumber(row['value_usd']) ?? 0,
      units: asNumber(row['units']),
      apy: asNumber(row['apy']),
      at: asDate(row['at']) ?? new Date(0),
    }));
  }

  /**
   * Assemble the panels a dashboard needs on open.
   *
   * The three reads run concurrently because they are independent; on a
   * five-connection pool that is one round trip in wall-clock terms rather than
   * three. Deliberately does **not** include volatility or risk parameters: those
   * live in the risk store with an hours-long cadence, so pulling them into the
   * live overview would imply a freshness they do not have.
   */
  async overview(userId: string): Promise<DashboardOverview> {
    const [liveRuns, liveSteps, positions] = await Promise.all([
      this.history.liveRuns(userId),
      this.liveSteps(userId),
      this.positions(userId),
    ]);
    return { liveRuns, liveSteps, positions, asOf: new Date() };
  }

  /** Steps of any kind still moving — the "in flight" list. */
  private async liveSteps(userId: string): Promise<readonly ExecutionStepRow[]> {
    const result = await this.runner.query(
      `SELECT ${STEP_COLUMNS} FROM exec_steps
       WHERE user_id = $1 AND status NOT IN ('confirmed', 'failed', 'skipped')
       ORDER BY updated_at DESC`,
      [userId],
    );
    return result.rows.map(toStepRow);
  }
}
