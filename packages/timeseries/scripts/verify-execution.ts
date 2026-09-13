/**
 * Live check for the execution store — T1.3 to T1.5.
 *
 * Proves the things unit tests cannot: that the batched INSERT is valid SQL
 * against the real hypertable, that the tenant filter genuinely returns nothing
 * for another user, that the transaction boundary holds on a real connection,
 * and that the lineage join resolves a step back to its trigger.
 *
 * Writes to throwaway users and cleans up after itself, so it is safe to run
 * against the shared instance.
 *
 * Run: `TIMESERIES_DATABASE_URL=… pnpm --filter @ethonline2026/timeseries exec tsx scripts/verify-execution.ts`
 */
import { randomUUID } from "node:crypto";
import {
  ExecutionEventBuffer,
  ExecutionReadModel,
  ExecutionRepository,
  PgSqlRunner,
  SessionRepository,
  StrategyRepository,
  type ExecutionEventRow,
  type ExecutionStepRow,
} from "../src/index.js";

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = ""): void {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail.length > 0 ? ` — ${detail}` : ""}`);
}

const runner = PgSqlRunner.fromEnv();
const repo = new ExecutionRepository(runner);
const sessions = new SessionRepository(runner);
const strategies = new StrategyRepository(runner);
const readModel = new ExecutionReadModel(runner, repo);

const owner = `did:privy:verify-${randomUUID()}`;
const stranger = `did:privy:verify-other-${randomUUID()}`;
const sessionId = randomUUID();
const strategyId = randomUUID();
const runId = randomUUID();
const rebalanceRunId = randomUUID();
const intentId = randomUUID();
const stepA = randomUUID();
const stepB = randomUUID();
const accountId = randomUUID();

async function cleanup(): Promise<void> {
  // Newest chunk is uncompressed, so a plain DELETE works; a compressed chunk
  // would need `timescaledb.decompress_chunk` first.
  await runner.query("DELETE FROM exec_events WHERE user_id = $1", [owner]);
  await runner.query("DELETE FROM exec_fee_actuals WHERE user_id = $1", [owner]);
  await runner.query("DELETE FROM exec_steps WHERE intent_id = $1", [intentId]);
  await runner.query("DELETE FROM exec_intents WHERE intent_id = $1", [intentId]);
  await runner.query("DELETE FROM exec_position_snapshots WHERE user_id = $1", [owner]);
  await runner.query("DELETE FROM exec_runs WHERE run_id = ANY($1::uuid[])", [[runId, rebalanceRunId]]);
  await runner.query("DELETE FROM exec_strategies WHERE strategy_id = $1", [strategyId]);
  await runner.query("DELETE FROM exec_sessions WHERE session_id = $1", [sessionId]);
  await runner.query("DELETE FROM exec_users WHERE user_id = ANY($1::text[])", [[owner, stranger]]);
}

try {
  console.log("\n[1] seed two users, a session, a strategy, a run and a rebalance");
  await runner.query("INSERT INTO exec_users (user_id) VALUES ($1), ($2)", [owner, stranger]);
  await runner.query(
    "INSERT INTO exec_sessions (session_id, user_id, agent, status) VALUES ($1, $2, 'v01', 'open')",
    [sessionId, owner],
  );
  await runner.query(
    "INSERT INTO exec_strategies (strategy_id, user_id, name, risk_thresholds) VALUES ($1, $2, $3, $4::jsonb)",
    [strategyId, owner, "verify", JSON.stringify([{ metric: "apy", comparison: "below" }])],
  );
  // The risk-triggered run carries a session_id, so the session→runs hop has a row.
  await runner.query(
    "INSERT INTO exec_runs (run_id, strategy_id, user_id, session_id, trigger, trigger_detail) VALUES ($1, $2, $3, $4, 'risk_breach', $5::jsonb)",
    [runId, strategyId, owner, sessionId, JSON.stringify({ metric: "apy", observed: 0.021 })],
  );
  // A second, in-flight run gives the live-run panel something to show.
  await runner.query(
    "INSERT INTO exec_runs (run_id, strategy_id, user_id, session_id, trigger, mode, status) VALUES ($1, $2, $3, $4, 'schedule', 'dry', 'bridging')",
    [rebalanceRunId, strategyId, owner, sessionId],
  );
  await runner.query(
    "INSERT INTO exec_intents (intent_id, run_id, user_id, status) VALUES ($1, $2, $3, 'proposed')",
    [intentId, runId, owner],
  );
  await runner.query(
    "INSERT INTO exec_position_snapshots (at, user_id, account_id, chain_id, protocol, pool_id, value_usd, units, apy) VALUES (now(), $1, $2, 8453, 'aave', 'usdc', 1000, 1000, 4.2)",
    [owner, accountId],
  );
  check("seeded the lineage and a position", true);

  console.log("\n[2] the write buffer batches and flushes");
  const events: ExecutionEventRow[] = Array.from({ length: 25 }, (_, i) => ({
    eventId: randomUUID(),
    at: new Date(Date.now() + i),
    userId: owner,
    runId,
    intentId: null,
    stepId: null,
    type: `step.transition.${i}`,
    payload: { i },
  }));
  const buffer = new ExecutionEventBuffer(repo, { maxEvents: 25 });
  for (const event of events) await buffer.add(event);
  check("the buffer drained itself at the bound", buffer.isEmpty);
  const afterBuffer = await repo.getRunEvents(owner, runId);
  check("the buffer wrote all 25 events", afterBuffer.length === 25, `read ${afterBuffer.length}`);

  console.log("\n[3] replay is idempotent");
  const replayBuffer = new ExecutionEventBuffer(repo, { maxEvents: 25 });
  for (const event of events) await replayBuffer.add(event);
  const afterReplay = await repo.getRunEvents(owner, runId);
  check("a replay added nothing", afterReplay.length === 25, `read ${afterReplay.length}`);

  console.log("\n[4] read back, scoped to the owner");
  check("ordered oldest first", afterReplay[0]?.type === "step.transition.0");
  check("jsonb payload round-tripped", afterReplay[0]?.payload['i'] === 0);

  console.log("\n[5] cross-user isolation on the event log");
  const foreignEvents = await repo.getRunEvents(stranger, runId);
  check("a stranger reading the same run id gets nothing", foreignEvents.length === 0);

  console.log("\n[6] one transaction per intent transition");
  const transitions: ExecutionStepRow[] = [
    {
      stepId: stepA,
      intentId,
      userId: owner,
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
    },
    {
      stepId: stepB,
      intentId,
      userId: owner,
      seq: 1,
      kind: "supply",
      label: "Supply to Aave",
      status: "confirmed",
      chainId: 8453,
      txHash: "0xabc",
      nonce: 7,
      gasUsed: 21000,
      srcTxHash: null,
      dstTxHash: null,
      guid: null,
      error: null,
    },
  ];
  const transitionEvents: ExecutionEventRow[] = [
    { eventId: randomUUID(), at: new Date(), userId: owner, runId, intentId, stepId: stepA, type: "step.bridging", payload: {} },
    { eventId: randomUUID(), at: new Date(), userId: owner, runId, intentId, stepId: stepB, type: "step.confirmed", payload: {} },
  ];
  const applied = await repo.applyStepTransitions({
    userId: owner,
    intentId,
    steps: transitions,
    events: transitionEvents,
  });
  check("steps and events committed together", applied.steps === 2 && applied.events === 2, JSON.stringify(applied));

  const persisted = await runner.query(
    "SELECT count(*)::int AS n FROM exec_steps WHERE intent_id = $1",
    [intentId],
  );
  check("both steps were persisted", Number(persisted.rows[0]?.['n'] ?? 0) === 2);

  let refused = false;
  try {
    await repo.applyStepTransitions({
      userId: owner,
      intentId,
      steps: [{ ...transitions[0]!, intentId: randomUUID() }],
      events: [],
    });
  } catch {
    refused = true;
  }
  check("a mismatched intent is refused before any write", refused);

  await runner.query(
    "INSERT INTO exec_fee_actuals (fee_id, step_id, user_id, chain_id, token, amount, usd, kind, estimated) VALUES ($1, $2, $3, 8453, 'USDC', 0.42, 0.42, 'gas', true)",
    [randomUUID(), stepA, owner],
  );

  console.log("\n[7] the lineage walks both ways");
  const strategyRuns = await strategies.runs(owner, strategyId);
  check("strategy → runs returns both runs", strategyRuns.length === 2, `read ${strategyRuns.length}`);
  check(
    "runs are newest first",
    strategyRuns[0] !== undefined && strategyRuns[0].startedAt >= strategyRuns[strategyRuns.length - 1]!.startedAt,
  );
  const foreignStrategyRuns = await strategies.runs(stranger, strategyId);
  check("a stranger reading the strategy's runs gets nothing", foreignStrategyRuns.length === 0);

  const sessionRuns = await sessions.runs(owner, sessionId);
  check("session → runs returns the runs that named it", sessionRuns.length === 2, `read ${sessionRuns.length}`);
  const foreignSessionRuns = await sessions.runs(stranger, sessionId);
  check("a stranger reading the session's runs gets nothing", foreignSessionRuns.length === 0);

  const trigger = await repo.triggerForStep(owner, stepA);
  check("step → run resolves the trigger", trigger?.trigger === "risk_breach");
  check("the breached parameter is readable", trigger?.triggerDetail?.['metric'] === "apy");
  const foreignTrigger = await repo.triggerForStep(stranger, stepA);
  check("a stranger asking for the same step gets nothing", foreignTrigger === null);

  console.log("\n[8] the dashboard read model never crosses a tenant");
  const ownerView = await readModel.overview(owner);
  check("owner sees the in-flight run", ownerView.liveRuns.some((run) => run.runId === rebalanceRunId));
  check("owner sees the in-flight step", ownerView.liveSteps.some((s) => s.stepId === stepA));
  check("owner sees the position", ownerView.positions.length === 1, `read ${ownerView.positions.length}`);

  const strangerView = await readModel.overview(stranger);
  check("stranger's live runs are empty", strangerView.liveRuns.length === 0);
  check("stranger's live steps are empty", strangerView.liveSteps.length === 0);
  check("stranger's positions are empty", strangerView.positions.length === 0);
  check("stranger's live run lookup is null", (await readModel.liveRun(stranger, strategyId)) === null);
  check("stranger's step read is empty", (await readModel.transactionStatus(stranger, intentId)).length === 0);
  check("owner's step read returns both steps", (await readModel.transactionStatus(owner, intentId)).length === 2);
  check("owner's fee breakdown returns the estimate", (await readModel.feeBreakdown(owner, intentId)).length === 1);
  check("stranger's fee breakdown is empty", (await readModel.feeBreakdown(stranger, intentId)).length === 0);
} finally {
  await cleanup();
  console.log("\n[cleanup] probe rows removed");
}

const failed = checks.filter((c) => !c.ok);
console.log(
  `\n${failed.length === 0 ? "EXECUTION STORE VERIFICATION PASSED" : "FAILED"} — ${checks.length - failed.length}/${checks.length} checks`,
);
process.exit(failed.length === 0 ? 0 : 1);
