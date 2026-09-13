#!/usr/bin/env node
/**
 * verify-tracing — prove that one turn actually lands in LangSmith.
 *
 * Runs a turn in-process with tracing enabled, flushes, and prints the command
 * that shows the tree. It does not fail when tracing is simply off — that is a
 * configuration state, not an error — but it does say exactly what to set.
 *
 *   LANGSMITH_TRACING=true LANGSMITH_API_KEY=lsv2_pt_… \
 *     pnpm --filter @ethonline2026/inference exec tsx scripts/verify-tracing.ts
 *
 * EU accounts must also set LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com:
 * a valid EU key against the US host 403s on every call.
 */
import { loadInferenceEnv } from "../src/env.js";
import { createRuntime } from "../src/runtime.js";
import type { InferenceEvent } from "../src/events/contract.js";

async function main(): Promise<void> {
  const env = loadInferenceEnv({
    ...process.env,
    INFERENCE_MODE: "dry",
    AGENT_IMPL: "mock",
    SANDBOX_PROVIDER: "local",
    LOG_LEVEL: "silent",
  });

  console.log(`tracing      ${env.LANGSMITH_TRACING ? "enabled" : "disabled"}`);
  console.log(`project      ${env.LANGSMITH_PROJECT}`);
  console.log(`endpoint     ${env.LANGSMITH_ENDPOINT ?? "(default US host)"}`);
  console.log(`mode         ${env.INFERENCE_MODE}`);

  if (!env.LANGSMITH_TRACING || env.LANGSMITH_API_KEY === undefined) {
    console.log("\nTracing is OFF, so nothing was sent. To turn it on:");
    console.log("  LANGSMITH_TRACING=true");
    console.log("  LANGSMITH_API_KEY=lsv2_pt_…");
    console.log("  LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com   # EU accounts only");
    console.log("  LANGSMITH_PROJECT=ethonline2026-fixed-income");
    return;
  }

  const runtime = createRuntime({ env });
  if (!runtime.tracing.enabled) {
    console.log("\nTracing reported disabled despite configuration — check the key.");
    return;
  }

  const session = await runtime.sessions.open({ userId: "trace-verify", agent: "v01" });
  const handle = await runtime.orchestrator.beginTurn({
    userId: "trace-verify",
    sessionId: session.sessionId,
    query: "rebalance my USDC into the best 30d yield",
    mode: "v01",
    pools: ["morpho-usdc-base"],
    protocols: ["morpho"],
    horizonDays: 30,
    dry: true,
  });

  const events = await waitForCompletion(handle.emitter);
  console.log(`\nrun          ${handle.runId}`);
  console.log(`events       ${events.length} (last: ${events.at(-1)?.type ?? "none"})`);

  // Feedback recorded after the turn is part of the picture too.
  const pending = runtime.approvals.pending(handle.runId)[0];
  if (pending !== undefined) {
    await runtime.orchestrator.recordApproval(handle.runId, pending.intent.intentId, "approved");
    console.log(`intent       ${pending.intent.intentId} (digest ${pending.intent.digest.slice(0, 18)}…)`);
  }

  await runtime.tracing.flush();
  console.log("\nFlushed. Verify the tree landed:");
  console.log(
    `  LANGSMITH_ENDPOINT=${env.LANGSMITH_ENDPOINT ?? "(default)"} \\\n` +
      `  langsmith trace list --project ${env.LANGSMITH_PROJECT} --limit 1 --show-hierarchy --api-key $LANGSMITH_API_KEY`,
  );
  console.log("\nExpected hierarchy:");
  console.log("  inference.turn (chain)");
  console.log("  ├── task(subagent=graph-indexer)  (tool)");
  console.log("  ├── sandbox.exec(wc -l series.csv) (tool)");
  console.log("  ├── widget.forecast (tool)");
  console.log("  └── custody.proposeIntent (tool)");
}

/** Wait until the run completes, then return everything it emitted. */
async function waitForCompletion(
  emitter: { since(seq: number): InferenceEvent[] },
): Promise<InferenceEvent[]> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const events = emitter.since(0);
    if (events.some((event) => event.type === "run.completed")) return events;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return emitter.since(0);
}

main().catch((error: unknown) => {
  console.error("verify-tracing failed:");
  console.error(error);
  process.exitCode = 1;
});
