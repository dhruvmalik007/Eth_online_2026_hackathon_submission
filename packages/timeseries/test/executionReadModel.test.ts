/**
 * T1.4 and T1.5 — the strategy/session repositories and the dashboard read model.
 *
 * These exist as modules but had no tests, which is the gap this file closes. The
 * assertions are mostly made against the **SQL issued** rather than against
 * returned rows, deliberately: the properties that matter here are invariants of
 * the query (every read is tenant-scoped, thresholds replace rather than merge,
 * "live" excludes finished work), and an invariant that only holds for the
 * fixture's shape is not an invariant.
 */
import { describe, expect, it } from "vitest";
import { ExecutionReadModel, SessionRepository, StrategyRepository } from "../src/index.js";
import type { SqlRunner } from "../src/index.js";

/** Records the SQL and values it is handed, and answers with queued rows. */
class RecordingRunner implements SqlRunner {
  readonly queries: Array<{ text: string; values: readonly unknown[] }> = [];
  private rows: Record<string, unknown>[] = [];

  willReturn(rows: Record<string, unknown>[]): this {
    this.rows = rows;
    return this;
  }

  async query(text: string, values: readonly unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    this.queries.push({ text, values });
    return { rows: this.rows };
  }

  async transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> {
    return fn(this);
  }

  get last(): { text: string; values: readonly unknown[] } {
    const entry = this.queries.at(-1);
    if (entry === undefined) throw new Error("no query was issued");
    return entry;
  }
}

const USER = "did:privy:user-a";
const STRATEGY = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";

// ─── T1.4 — StrategyRepository ────────────────────────────────────────────────

describe("StrategyRepository", () => {
  it("scopes a strategy read by user as well as id", async () => {
    const runner = new RecordingRunner().willReturn([]);
    await new StrategyRepository(runner).get(USER, STRATEGY);

    // A guessed strategy id must not read another user's row, so `user_id` is in
    // the predicate rather than checked after the fact.
    expect(runner.last.text).toMatch(/user_id\s*=/);
    expect(runner.last.values).toContain(USER);
    expect(runner.last.values).toContain(STRATEGY);
  });

  it("returns null rather than throwing when the strategy is not there", async () => {
    const runner = new RecordingRunner().willReturn([]);
    await expect(new StrategyRepository(runner).get(USER, STRATEGY)).resolves.toBeNull();
  });

  it("lists a user's strategies scoped to that user", async () => {
    const runner = new RecordingRunner().willReturn([]);
    await new StrategyRepository(runner).list(USER);
    expect(runner.last.text).toMatch(/user_id\s*=/);
    expect(runner.last.values).toEqual([USER]);
  });

  it("REPLACES thresholds rather than merging them", async () => {
    const runner = new RecordingRunner().willReturn([]);
    await new StrategyRepository(runner).setThresholds(USER, STRATEGY, []);

    // This is the important one. A merge would leave a threshold the caller
    // omitted still armed — so the risk engine would keep triggering on a
    // parameter the user believed they had removed.
    const sql = runner.last.text.toUpperCase();
    expect(sql).toContain("RISK_THRESHOLDS =");
    // No read-then-merge: a single statement that assigns, not a SELECT first.
    expect(runner.queries).toHaveLength(1);
  });

  it("scopes a status update by user, so one cannot be changed by guessing", async () => {
    const runner = new RecordingRunner().willReturn([]);
    await new StrategyRepository(runner).setStatus(USER, STRATEGY, "retired");
    expect(runner.last.text).toMatch(/user_id\s*=/);
  });

  it("walks strategy → runs scoped by user as well as strategy", async () => {
    const runner = new RecordingRunner().willReturn([]);
    await new StrategyRepository(runner).runs(USER, STRATEGY);

    // The lineage hop for a rebalance history. Both ids in the predicate: a
    // guessed strategy id must not surface another user's runs.
    expect(runner.last.text).toMatch(/user_id\s*=\s*\$1/);
    expect(runner.last.text).toMatch(/strategy_id\s*=\s*\$2/);
    expect(runner.last.values).toEqual([USER, STRATEGY, 50]);
  });
});

// ─── T1.4 — SessionRepository ─────────────────────────────────────────────────

describe("SessionRepository", () => {
  it("opens a session scoped to its user", async () => {
    // `open` maps the RETURNING row, so a fake that returns none would throw
    // before the assertion — the fixture has to be a real row.
    const runner = new RecordingRunner().willReturn([
      {
        session_id: SESSION,
        user_id: USER,
        agent: "v01",
        status: "open",
        thread_id: null,
        mandate_snapshot: {},
        started_at: new Date(),
        last_active_at: new Date(),
        closed_at: null,
      },
    ]);
    const session = await new SessionRepository(runner).open({
      sessionId: SESSION,
      userId: USER,
      agent: "v01",
    });
    expect(session.userId).toBe(USER);
    // `ON CONFLICT` makes a resumed session idempotent rather than a duplicate.
    expect(runner.last.text).toMatch(/ON CONFLICT/i);
  });

  it("closes a session only for its owner, reporting whether it matched", async () => {
    const runner = new RecordingRunner().willReturn([{ session_id: SESSION }]);
    const closed = await new SessionRepository(runner).close(USER, SESSION);

    expect(closed).toBe(true);
    expect(runner.last.text).toMatch(/user_id\s*=/);
    // A no-op close must be distinguishable from a real one, so the caller can
    // tell "already closed" from "you do not own this".
    expect(runner.last.text).toMatch(/closed_at IS NULL|status/i);
  });

  it("reports false when nothing matched, rather than assuming success", async () => {
    const runner = new RecordingRunner().willReturn([]);
    await expect(new SessionRepository(runner).close(USER, SESSION)).resolves.toBe(false);
  });

  it("lists sessions most recently active first", async () => {
    const runner = new RecordingRunner().willReturn([]);
    await new SessionRepository(runner).list(USER);
    expect(runner.last.text).toMatch(/ORDER BY last_active_at DESC/i);
  });

  it("touches a session to drive that ordering", async () => {
    const runner = new RecordingRunner().willReturn([]);
    await new SessionRepository(runner).touch(USER, SESSION);
    expect(runner.last.text).toMatch(/last_active_at/i);
    expect(runner.last.text).toMatch(/user_id\s*=/);
  });

  it("walks session → runs scoped by user as well as session", async () => {
    const runner = new RecordingRunner().willReturn([]);
    await new SessionRepository(runner).runs(USER, SESSION);

    expect(runner.last.text).toMatch(/user_id\s*=\s*\$1/);
    expect(runner.last.text).toMatch(/session_id\s*=\s*\$2/);
    expect(runner.last.values).toEqual([USER, SESSION, 50]);
  });
});

// ─── T1.5 — ExecutionReadModel ────────────────────────────────────────────────

describe("ExecutionReadModel — every panel is tenant-scoped", () => {
  const scoped: Array<[string, (model: ExecutionReadModel, runner: RecordingRunner) => Promise<unknown>]> = [
    ["liveRun", (m) => m.liveRun(USER, STRATEGY)],
    ["transactionStatus", (m) => m.transactionStatus(USER, "33333333-3333-4333-8333-333333333333")],
    ["bridgeProgress", (m) => m.bridgeProgress(USER)],
    ["positions", (m) => m.positions(USER)],
  ];

  it.each(scoped)("%s reads only this user's rows", async (_name, call) => {
    const runner = new RecordingRunner().willReturn([]);
    await call(new ExecutionReadModel(runner, undefined as never), runner);
    expect(runner.last.text).toMatch(/user_id\s*=/);
    expect(runner.last.values).toContain(USER);
  });

  /**
   * The bridge panel reads two tables, so `last` is no longer the steps query.
   *
   * Steps carry the lifecycle a live bridge needs and events carry the broadcasts that actually
   * happened — `exec_steps` is unreachable without a run row and `exec_events` has no foreign keys,
   * so a panel that wants to show a real transaction has to read both. These helpers select the
   * query under test by its table rather than by position, which keeps them honest if the order
   * changes again.
   */
  const stepsQuery = (runner: RecordingRunner) =>
    runner.queries.find((q) => q.text.includes("exec_steps")) ?? (() => { throw new Error("no exec_steps query"); })();
  const eventsQuery = (runner: RecordingRunner) =>
    runner.queries.find((q) => q.text.includes("exec_events")) ?? (() => { throw new Error("no exec_events query"); })();

  it("excludes finished work from the bridge panel", async () => {
    const runner = new RecordingRunner().willReturn([]);
    await new ExecutionReadModel(runner, undefined as never).bridgeProgress(USER);

    // The panel answers "what is still moving?" — a confirmed or failed leg is
    // history, and `skipped` never moved at all.
    const q = stepsQuery(runner);
    expect(q.text).toMatch(/status NOT IN|status <>|NOT \(status/i);
    for (const terminal of ["confirmed", "failed", "skipped"]) {
      expect(q.text).toContain(terminal);
    }
  });

  it("filters the bridge panel to bridge steps specifically", async () => {
    const runner = new RecordingRunner().willReturn([]);
    await new ExecutionReadModel(runner, undefined as never).bridgeProgress(USER);
    expect(stepsQuery(runner).text).toMatch(/kind\s*=\s*'bridge'|kind IN \('bridge'/i);
  });

  it("also reads broadcasts recorded as events, since steps are unreachable without a run", async () => {
    const runner = new RecordingRunner().willReturn([]);
    await new ExecutionReadModel(runner, undefined as never).bridgeProgress(USER);

    const q = eventsQuery(runner);
    expect(q.text).toContain("step.broadcast");
    expect(q.values).toContain(USER);
  });

  it("takes the latest position per account/chain/pool rather than every snapshot", async () => {
    const runner = new RecordingRunner().willReturn([]);
    await new ExecutionReadModel(runner, undefined as never).positions(USER);
    // Snapshots are a hypertable, so a naive read returns every observation ever.
    expect(runner.last.text).toMatch(/DISTINCT ON/i);
  });

  it("returns an empty panel rather than failing on an idle dashboard", async () => {
    const runner = new RecordingRunner().willReturn([]);
    await expect(
      new ExecutionReadModel(runner, undefined as never).bridgeProgress(USER),
    ).resolves.toEqual([]);
  });
});
