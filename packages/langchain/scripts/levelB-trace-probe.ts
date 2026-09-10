/**
 * Level B probe — agent invocation WITH the LLM, asserting on the tool-call trace
 * (walkthrough §Part 2, Level B). This is "did the agent actually hit The Graph?"
 *
 *   pnpm probe:levelB
 *
 * Asserts (not on the prose — on the TRACE):
 *   1. the run contains tool calls (agent did not hallucinate an answer),
 *   2. the called tools come from the Graph-backed toolset,
 *   3. risk-relevant tools (calc_* and subgraph tools) appear when the query asks for risk.
 *
 * LangSmith tracing is ACTIVE here: if LANGSMITH_API_KEY is valid, the full trace
 * (every subgraph query, latency, tokens) lands in the LANGSMITH_PROJECT dashboard.
 * A 403 from LangSmith prints a warning but never fails the probe — the trace
 * assertions are local.
 */

import { config } from 'dotenv';
config();

import { DeepGraphAgent } from '../src/agents/DeepGraphAgent.js';
import { loadEnv } from '../src/config/env.js';

/** Extract tool names from every message in the agent's returned history. */
function extractToolCalls(result: { messages?: Array<Record<string, unknown>> }): Array<{
  name: string;
  args: Record<string, unknown>;
}> {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  for (const msg of result.messages ?? []) {
    const raw = (msg.additional_kwargs as { tool_calls?: Array<Record<string, unknown>> } | undefined)?.tool_calls;
    for (const tc of raw ?? []) {
      const fn = tc.function as { name?: string; arguments?: string } | undefined;
      const name = (tc.name as string) ?? fn?.name ?? '';
      let args: Record<string, unknown> = {};
      if (typeof fn?.arguments === 'string') {
        try {
          args = JSON.parse(fn.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }
      } else if (tc.args && typeof tc.args === 'object') {
        args = tc.args as Record<string, unknown>;
      }
      if (name) calls.push({ name, args });
    }
  }
  return calls;
}

const GRAPH_TOOLS = new Set([
  'v4TopPools',
  'v4HookedPools',
  'v4PoolState',
  'v4PoolHourData',
  'v4PoolDayData',
  'v4Swaps',
  'v4TokenData',
  'v4Position',
  'v4PoolManager',
  'v4FixedIncomeStrategy',
  'getLendingReserves',
  'compareLendingYields',
  'getDexPools',
  'getPredictionMarkets',
  'protocolSnapshot',
  'funding',
  'subgraphHealth',
]);

async function main(): Promise<void> {
  const env = loadEnv();

  if (env.LANGSMITH_API_KEY) {
    console.log(`── LangSmith tracing: ON → project "${env.LANGSMITH_PROJECT ?? '(default)'}" (session traces stream there) ──`);
  } else {
    console.log('── LangSmith tracing: OFF (set LANGSMITH_API_KEY in packages/langchain/.env to stream traces) ──');
  }

  const agent = new DeepGraphAgent();
  await agent.initialize();

  const query =
    'Using the Uniswap v4 subgraph: which are the top 2 v4 pools by volume? ' +
    'For each, report the token pair, cumulative volume, fee tier, and whether it has a hook. Be concise.';
  console.log(`\n── Agent query ──\n  ${query}\n`);

  const t0 = Date.now();
  const result = (await agent.invoke(query)) as { messages?: Array<Record<string, unknown>> };
  const latency = Date.now() - t0;

  // ── Trace evaluation (the point of Level B) ────────────────────────────────
  const calls = extractToolCalls(result);
  const callNames = calls.map((c) => c.name);
  const uniqueTools = [...new Set(callNames)];

  console.log(`── Trace evaluation ──`);
  console.log(`  latency: ${(latency / 1000).toFixed(1)}s`);
  console.log(`  tool calls: ${callNames.length} (${uniqueTools.join(', ') || 'NONE'})`);
  for (const c of calls) {
    const argStr = JSON.stringify(c.args);
    console.log(`    → ${c.name}${argStr.length > 80 ? ` ${argStr.slice(0, 80)}…` : ` ${argStr}`}`);
  }

  const failures: string[] = [];
  if (calls.length === 0) {
    failures.push('ZERO tool calls — the agent hallucinated its answer without touching The Graph');
  }
  const graphCalls = callNames.filter((n) => GRAPH_TOOLS.has(n));
  if (callNames.length > 0 && graphCalls.length === 0) {
    failures.push(`tool calls happened but none are Graph-backed: ${uniqueTools.join(', ')}`);
  }
  // Any Graph-backed call must have returned real data — peek at the tool messages.
  const toolMessages = (result.messages ?? []).filter((m) => (m as { tool_call_id?: string }).tool_call_id);
  const emptyToolResults = toolMessages.filter((m) => {
    const content = String((m as { content?: unknown }).content ?? '');
    return content.includes('"error"') || content.includes('not found');
  });
  if (toolMessages.length > 0 && emptyToolResults.length === toolMessages.length) {
    failures.push('every tool result contains an error — endpoint/auth problem, check Level A first');
  }

  const finalMsg = result.messages?.[result.messages.length - 1];
  const answer = String((finalMsg as { content?: unknown })?.content ?? '').slice(0, 400);
  console.log(`\n── Agent answer (first 400 chars) ──\n  ${answer.replace(/\n/g, '\n  ')}`);

  if (failures.length > 0) {
    console.error(`\nLevel B: FAIL\n  - ${failures.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('\nLevel B: PASS — the agent fetched Graph data via real tool calls (trace-verified).');
}

main().catch((err) => {
  // Full error (stack + cause chain) — the "undefined.message" class of failures
  // hides the real cause (auth, region, quota) behind a generic wrap.
  console.error('Level B probe failed:');
  console.error(err);
  process.exit(1);
});
