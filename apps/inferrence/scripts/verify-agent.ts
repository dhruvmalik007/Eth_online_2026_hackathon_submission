/**
 * Live verification: does the real agent emit real steps?
 *
 * Runs `DeepGraphAgent` against the configured Vertex project with an
 * `AgentTraceHandler` attached, and asserts that the trace came from actual tool
 * calls rather than from anything this repository wrote down. This is the
 * checkpoint-1 evidence for the staging plan: if it prints tool calls with
 * non-empty results, the fixture it replaces (`lib/agent-traces.ts`) is provably
 * redundant.
 *
 *   pnpm --filter @ethonline2026/inferrence verify:agent
 *
 * Exits non-zero when no tool call was observed, because "the model replied
 * without calling anything" is not a passing trace.
 */
import { DeepGraphAgent } from "@ethonline2026/langchain-agent";
import type { AgentStep } from "../src/events/agentStep.js";
import type { InferenceEventInput } from "../src/events/contract.js";
import { AgentTraceHandler } from "../src/observability/agentCallbacks.js";

/** Environment files the agent reads, nearest-last so the repo root wins. */
const ENV_FILES = [
  "packages/langchain/.env",
  "packages/the-graph/.env",
  "packages/custody/.env",
  ".env",
];

function loadEnv(): void {
  for (const file of ENV_FILES) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Absent files are expected: a deployed host supplies real environment vars.
    }
  }
}

const QUERY =
  process.argv.slice(2).join(" ").trim() ||
  "Using the lending tools, report the current USDC supply APY for Aave v3 on Base and Ethereum. " +
    "Call the tools for each chain and quote the exact numbers you get back.";

function renderStep(step: AgentStep, events: InferenceEventInput[]): void {
  const seq = events.length;
  const mark = step.state === "done" ? "✓" : step.state === "failed" ? "✗" : "◐";
  const duration = step.durationMs === undefined ? "" : ` ${step.durationMs}ms`;
  console.log(`${mark} [${step.state}] ${step.agent} · ${step.call}${duration}  (${seq})`);
  if (step.argsSummary !== undefined) console.log(`    args: ${step.argsSummary}`);
  if (step.result !== undefined) console.log(`    result: ${step.result.summary}`);
  for (const row of step.evidence ?? []) {
    console.log(`    evidence ${row.label}: ${row.value.slice(0, 120)}`);
  }
  if (step.error !== undefined) console.log(`    error: ${step.error}`);
}

async function main(): Promise<void> {
  loadEnv();

  console.log("project :", process.env["GOOGLE_CLOUD_PROJECT"] ?? "(unset)");
  console.log("location:", process.env["GOOGLE_CLOUD_LOCATION"] ?? "(unset)");
  console.log("model   :", process.env["VERTEX_AI_MODEL"] ?? "(default)");
  console.log("query   :", QUERY);
  console.log("");

  const events: InferenceEventInput[] = [];
  const handler = new AgentTraceHandler({
    emit: (event) => {
      events.push(event);
      if (event.type === "step.completed" || event.type === "step.start") {
        renderStep(event.step, events);
      }
    },
  });

  const agent = new DeepGraphAgent({});
  await agent.initialize();

  const started = Date.now();
  const result = await agent.invoke(QUERY, 1, { callbacks: [handler] });
  const elapsed = Date.now() - started;

  // Steps are classified by the provenance the handler set, so a LangGraph node is
  // never counted as a tool call — the distinction this whole exercise rests on.
  const completed = events.filter(
    (event): event is Extract<InferenceEventInput, { type: "step.completed" }> =>
      event.type === "step.completed",
  );
  const byProvenance = (source: string): typeof completed =>
    completed.filter((event) => event.step.provenance?.source === source);
  const nodeSteps = byProvenance("langgraph");
  const modelSteps = byProvenance("vertex-ai");
  const toolSteps = completed.filter((event) => {
    const source = event.step.provenance?.source;
    return source !== "langgraph" && source !== "vertex-ai";
  });
  const toolCalls = toolSteps.filter((event) => event.step.state === "done");
  const withResults = toolCalls.filter((event) => event.step.result !== undefined);

  console.log("");
  console.log(`elapsed         : ${elapsed}ms`);
  console.log(`total events    : ${events.length}`);
  console.log(`graph node steps: ${nodeSteps.length}`);
  console.log(`model calls     : ${modelSteps.length}`);
  console.log(`tool calls      : ${toolCalls.length}`);
  console.log(`  with results  : ${withResults.length}`);
  console.log(`failed steps    : ${completed.filter((event) => event.step.state === "failed").length}`);
  console.log(`model text      : ${handler.lastMessage.slice(0, 200).replace(/\n/g, " ")}`);
  console.log(`result type     : ${typeof result}`);

  if (toolCalls.length === 0) {
    console.error("\nNO TOOL CALLS OBSERVED — the trace would be empty. Failing.");
    process.exitCode = 1;
    return;
  }
  console.log("\nAGENT TRACE VERIFIED");
}

main().catch((error: unknown) => {
  console.error("\nVERIFY FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
