/**
 * Tests for the execution-history repository.
 *
 * The behaviours worth pinning are the ones that are wrong in the obvious
 * implementation: a batch that becomes N round trips, a tenant filter that is
 * forgotten, and a state guard that runs *after* the write instead of before.
 */
import { describe, expect, it } from "vitest";
import type { SqlRunner } from "../src/runner.js";
import { ExecutionRepository, type ExecutionEventRow, type ExecutionStepRow } from "../src/index.js";

/** A runner that records every statement and answers from registered matchers. */
class RecordingRunner implements SqlRunner {
  readonly queries: Array<{ text: string; values: readonly unknown[] }> = [];
  /** How many transactions were opened — the property `applyStepTransitions` asserts. */
  transactions = 0;
  private readonly routes: Array<{ match: RegExp; rows: Record<string, unknown>[] }> = [];

  on(match: RegExp, rows: Record<string, unknown>[]): this {
    this.routes.push({ match, rows });
    return this;
  }

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    this.queries.push({ text, values });
    const route = this.routes.find((candidate) => candidate.match.test(text));
    return { rows: route?.rows ?? [] };
  }

  async transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return fn(this);
  }

  /** The single statement issued, for tests that expect exactly one. */
  only(): { text: string; values: readonly unknown[] } {
    expect(this.queries).toHaveLength(1);
    return this.queries[0]!;
  }
}

function idRows(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({ event_id: `e${i}` }));
}

function event(overrides: Partial<ExecutionEventRow> = {}): ExecutionEventRow {
  return {
    eventId: "11111111-1111-4111-8111-111111111111",
    at: new Date("2026-09-12T03:00:00.000Z"),
    userId: "did:privy:user-1",
    runId: "22222222-2222-4222-8222-222222222222",
    intentId: null,
    stepId: null,
    type: "run.submitted",
    payload: { step: 1 },
    ...overrides,
  };
}

function step(overrides: Partial<ExecutionStepRow> = {}): ExecutionStepRow {
  return {
    stepId: "33333333-3333-4333-8333-333333333333",
    intentId: "44444444-4444-4444-8444-444444444444",
    userId: "did:privy:user-1",
    seq: 0,
    kind: "bridge",
    label: "Bridge USDC to Base",
    status: "bridging",
    chainId: 8453,
    txHash: null,
    nonce: null,
    gasUsed: null,
    srcTxHash: null,
    dstTxHash: null,
    guid: null,
    error: null,
    ...overrides,
  };
}

describe("recordEvents — batching", () => {
  it("writes a whole batch as one statement, not one per event", async () => {
    // The hot path: a single execution emits hundreds of events. One round trip
    // per event against a five-connection pool is what this prevents.
    const runner = new RecordingRunner().on(/INSERT INTO exec_events/, idRows(50));
    const repo = new ExecutionRepository(runner);

    const written = await repo.recordEvents(
      Array.from({ length: 50 }, (_, i) => event({ eventId: `e${i}` })),
    );

    const query = runner.only();
    expect(written).toBe(50);
    // 8 columns × 50 rows, in one VALUES list.
    expect(query.values).toHaveLength(8 * 50);
    expect(query.text.match(/\(\$/g)).toHaveLength(50);
    expect(query.text).toContain("ON CONFLICT (event_id, at) DO NOTHING");
  });

  it("issues no statement for an empty batch", async () => {
    const runner = new RecordingRunner();
    await expect(new ExecutionRepository(runner).recordEvents([])).resolves.toBe(0);
    expect(runner.queries).toHaveLength(0);
  });

  it("reports zero inserted on a replay, rather than pretending to have written", async () => {
    // ON CONFLICT DO NOTHING returns no rows for a duplicate, and the caller
    // needs to know that so it does not double-publish to the socket.
    const runner = new RecordingRunner().on(/INSERT INTO exec_events/, []);
    await expect(new ExecutionRepository(runner).recordEvents([event()])).resolves.toBe(0);
  });

  it("rejects an event whose id is empty before it reaches the database", async () => {
    const runner = new RecordingRunner();
    await expect(
      new ExecutionRepository(runner).recordEvents([event({ eventId: "" })]),
    ).rejects.toThrow();
    expect(runner.queries).toHaveLength(0);
  });
});

describe("getRunEvents — tenant scoping and replay", () => {
  it("filters by user as well as run, so a guessed run id reads nothing", async () => {
    const runner = new RecordingRunner().on(/FROM exec_events/, []);
    await new ExecutionRepository(runner).getRunEvents("did:privy:user-1", "run-1");

    const query = runner.only();
    expect(query.text).toContain("user_id = $1");
    expect(query.text).toContain("run_id = $2");
    expect(query.values[0]).toBe("did:privy:user-1");
  });

  it("passes null for an omitted `since`, so the OR-clause matches everything", async () => {
    // The resume path: `since` absent must mean "all of it", not "nothing".
    const runner = new RecordingRunner().on(/FROM exec_events/, []);
    await new ExecutionRepository(runner).getRunEvents("u", "r");
    expect(runner.only().values[2]).toBeNull();
  });

  it("passes the timestamp through when supplied", async () => {
    const runner = new RecordingRunner().on(/FROM exec_events/, []);
    const since = new Date("2026-09-12T03:05:00.000Z");
    await new ExecutionRepository(runner).getRunEvents("u", "r", since);
    expect(runner.only().values[2]).toEqual(since);
  });

  it("parses a returned row into the row shape", async () => {
    const runner = new RecordingRunner().on(/FROM exec_events/, [
      {
        event_id: "e1",
        at: new Date("2026-09-12T03:00:00.000Z"),
        user_id: "u",
        run_id: "r",
        intent_id: null,
        step_id: null,
        type: "step.bridging",
        payload: { chainId: 8453 },
      },
    ]);
    const [parsed] = await new ExecutionRepository(runner).getRunEvents("u", "r");
    expect(parsed?.type).toBe("step.bridging");
    expect(parsed?.payload).toEqual({ chainId: 8453 });
  });
});

describe("upsertSteps", () => {
  it("writes a batch in one statement and updates mutable state on conflict", async () => {
    const runner = new RecordingRunner().on(/INSERT INTO exec_steps/, [
      { step_id: "a" },
      { step_id: "b" },
    ]);
    const written = await new ExecutionRepository(runner).upsertSteps([
      step({ stepId: "a" }),
      step({ stepId: "b", seq: 1 }),
    ]);

    const query = runner.only();
    expect(written).toBe(2);
    // 15 columns × 2 rows.
    expect(query.values).toHaveLength(30);
    expect(query.text).toContain("ON CONFLICT (step_id) DO UPDATE");
    // A step's status is mutable by design; its history lives in exec_events.
    expect(query.text).toContain("status      = EXCLUDED.status");
  });
});

describe("liveSteps — what is in flight", () => {
  it("excludes terminal states in SQL so the database does the filtering", async () => {
    const runner = new RecordingRunner().on(/FROM exec_steps/, [
      {
        step_id: "a",
        intent_id: "i",
        user_id: "u",
        seq: 0,
        kind: "bridge",
        label: "Bridge",
        status: "bridging",
        chain_id: 8453,
        tx_hash: null,
        nonce: null,
        gas_used: null,
        src_tx_hash: null,
        dst_tx_hash: null,
        guid: "g",
        error: null,
      },
    ]);
    const live = await new ExecutionRepository(runner).liveSteps("u");

    expect(runner.only().text).toContain("status NOT IN ('confirmed', 'failed', 'skipped')");
    expect(live).toHaveLength(1);
    expect(live[0]?.status).toBe("bridging");
  });
});

describe("advanceRun — two guards, in the right order", () => {
  it("refuses an illegal transition before issuing any statement", async () => {
    // If the guard ran after the write, the database would briefly hold a state
    // the machine says is unreachable — which is what a dashboard would show.
    const runner = new RecordingRunner();
    await expect(
      new ExecutionRepository(runner).advanceRun({
        userId: "u",
        runId: "r",
        from: "draft",
        to: "closed",
      }),
    ).rejects.toThrow(/Illegal run transition/i);
    expect(runner.queries).toHaveLength(0);
  });

  it("guards the update on the expected current state, so a race has one winner", async () => {
    const runner = new RecordingRunner().on(/UPDATE exec_runs/, [{ run_id: "r" }]);
    const won = await new ExecutionRepository(runner).advanceRun({
      userId: "u",
      runId: "r",
      from: "awaiting_user",
      to: "signed",
    });

    const query = runner.only();
    expect(won).toBe(true);
    expect(query.text).toContain("status = $4");
    expect(query.values).toEqual(["signed", "r", "u", "awaiting_user"]);
  });

  it("reports the loss when another worker already advanced the run", async () => {
    const runner = new RecordingRunner().on(/UPDATE exec_runs/, []);
    await expect(
      new ExecutionRepository(runner).advanceRun({
        userId: "u",
        runId: "r",
        from: "signed",
        to: "submitting",
      }),
    ).resolves.toBe(false);
  });

  it("stamps finished_at only on a terminal state", async () => {
    const runner = new RecordingRunner().on(/UPDATE exec_runs/, [{ run_id: "r" }]);
    await new ExecutionRepository(runner).advanceRun({
      userId: "u",
      runId: "r",
      from: "confirmed",
      to: "reconciling",
    });
    expect(runner.only().text).toContain(
      "CASE WHEN $1 IN ('closed', 'failed') THEN now() ELSE finished_at END",
    );
  });

  it("allows a self-loop back to draft, which is both a rejection and a rebalance", async () => {
    // `awaiting_user → draft` is the user declining; `holding → draft` is a risk
    // breach starting a new run. Both are legitimate, so neither is a bug.
    const runner = new RecordingRunner().on(/UPDATE exec_runs/, [{ run_id: "r" }]);
    const repo = new ExecutionRepository(runner);
    await expect(
      repo.advanceRun({ userId: "u", runId: "r", from: "awaiting_user", to: "draft" }),
    ).resolves.toBe(true);
    await expect(
      repo.advanceRun({ userId: "u", runId: "r", from: "holding", to: "draft" }),
    ).resolves.toBe(true);
  });
});

describe("liveRuns — the in-flight list", () => {
  it("excludes holding, because an open position is not a running process", async () => {
    const runner = new RecordingRunner().on(/FROM exec_runs/, []);
    await new ExecutionRepository(runner).liveRuns("u");

    const states = runner.only().values[1] as readonly string[];
    expect(states).not.toContain("holding");
    expect(states).not.toContain("closed");
    expect(states).not.toContain("failed");
    expect(states).toContain("bridging");
  });
});

describe("applyStepTransitions — one transaction per intent", () => {
  const intentId = "44444444-4444-4444-8444-444444444444";

  it("writes the steps and their events inside a single transaction", async () => {
    // The log is what the dashboard rebuilds from, so a step that moved without
    // a matching event must be impossible rather than merely unlikely.
    const runner = new RecordingRunner()
      .on(/INSERT INTO exec_steps/, [{ step_id: "a" }])
      .on(/INSERT INTO exec_events/, [{ event_id: "e0" }]);

    const result = await new ExecutionRepository(runner).applyStepTransitions({
      userId: "did:privy:user-1",
      intentId,
      steps: [step({ intentId })],
      events: [event({ intentId })],
    });

    expect(runner.transactions).toBe(1);
    expect(result).toEqual({ steps: 1, events: 1 });
    // Two statements, both inside the one transaction.
    expect(runner.queries).toHaveLength(2);
  });

  it("refuses a step from another user before opening a transaction", async () => {
    const runner = new RecordingRunner();
    await expect(
      new ExecutionRepository(runner).applyStepTransitions({
        userId: "did:privy:user-1",
        intentId,
        steps: [step({ intentId, userId: "did:privy:other" })],
        events: [],
      }),
    ).rejects.toThrow(/does not belong to user/);

    expect(runner.transactions).toBe(0);
    expect(runner.queries).toHaveLength(0);
  });

  it("refuses a step from another intent", async () => {
    const runner = new RecordingRunner();
    await expect(
      new ExecutionRepository(runner).applyStepTransitions({
        userId: "did:privy:user-1",
        intentId,
        steps: [step({ intentId: "55555555-5555-4555-8555-555555555555" })],
        events: [],
      }),
    ).rejects.toThrow(/does not belong to intent/);

    expect(runner.transactions).toBe(0);
  });

  it("refuses an event from another user", async () => {
    const runner = new RecordingRunner();
    await expect(
      new ExecutionRepository(runner).applyStepTransitions({
        userId: "did:privy:user-1",
        intentId,
        steps: [],
        events: [event({ intentId, userId: "did:privy:other" })],
      }),
    ).rejects.toThrow(/does not belong to user/);

    expect(runner.transactions).toBe(0);
  });

  it("refuses an event bound to a different intent", async () => {
    const runner = new RecordingRunner();
    await expect(
      new ExecutionRepository(runner).applyStepTransitions({
        userId: "did:privy:user-1",
        intentId,
        steps: [],
        events: [event({ intentId: "55555555-5555-4555-8555-555555555555" })],
      }),
    ).rejects.toThrow(/does not belong to intent/);
  });
});

describe("lineage reads — walking §5.3 both ways", () => {
  it("returns a strategy's runs scoped by user and ordered newest first", async () => {
    const runner = new RecordingRunner().on(/FROM exec_runs/, []);
    await new ExecutionRepository(runner).runsForStrategy("u", "s", 10);

    const query = runner.only();
    expect(query.text).toContain("user_id = $1");
    expect(query.text).toContain("strategy_id = $2");
    expect(query.text).toMatch(/ORDER BY started_at DESC/);
    expect(query.values).toEqual(["u", "s", 10]);
  });

  it("returns a session's runs scoped by user and session", async () => {
    const runner = new RecordingRunner().on(/FROM exec_runs/, []);
    await new ExecutionRepository(runner).runsForSession("u", "ses");

    const query = runner.only();
    expect(query.text).toContain("user_id = $1");
    expect(query.text).toContain("session_id = $2");
    expect(query.values).toEqual(["u", "ses", 50]);
  });

  it("walks a step back to the run that triggered it, qualified and user-scoped", async () => {
    // `exec_runs` and `exec_intents` both have a `status`, so the join must
    // qualify its columns or Postgres rejects the query as ambiguous.
    const runner = new RecordingRunner().on(/FROM exec_runs r/, [
      {
        run_id: "r",
        strategy_id: "s",
        status: "holding",
        trigger: "risk_breach",
        trigger_detail: { metric: "apy", observed: 0.021 },
        mode: "live",
        started_at: new Date("2026-09-12T03:00:00.000Z"),
        finished_at: null,
      },
    ]);

    const run = await new ExecutionRepository(runner).triggerForStep("u", "step-1");

    const query = runner.only();
    expect(query.text).toContain("r.status");
    expect(query.text).not.toMatch(/SELECT\s+run_id/);
    expect(query.text).toContain("i.run_id = r.run_id");
    expect(query.text).toContain("s.intent_id = i.intent_id");
    expect(query.text).toContain("r.user_id = $1");
    expect(query.text).toContain("s.step_id = $2");
    expect(run?.trigger).toBe("risk_breach");
    expect(run?.triggerDetail).toEqual({ metric: "apy", observed: 0.021 });
  });

  it("returns null when the step belongs to nobody", async () => {
    const runner = new RecordingRunner().on(/FROM exec_runs r/, []);
    await expect(
      new ExecutionRepository(runner).triggerForStep("u", "step-1"),
    ).resolves.toBeNull();
  });
});
