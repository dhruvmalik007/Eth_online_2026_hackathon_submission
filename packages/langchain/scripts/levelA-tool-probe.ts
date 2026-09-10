/**
 * Level A probe — direct tool invocation with NO LLM (walkthrough §Part 2, Level A).
 *
 * The tool IS the data path: if this prints real numbers, the agent's data supply works.
 * Run from the package root:
 *
 *   pnpm tsx scripts/levelA-tool-probe.ts
 *
 * Why a file and not `tsx -e`: `tsx -e` evaluates the string as CJS (no file context,
 * so the package's "type": "module" does not apply) and CJS rejects top-level await
 * with esbuild's "Top-level await is currently not supported with the cjs output format".
 * A real .ts file inside a type:module package is transformed as ESM.
 */

// Tracing must be off BEFORE dotenv loads — a stale LANGSMITH_* key in .env would
// otherwise spam 403s on every tool call. Level A is deterministic; nothing to trace.
process.env.LANGSMITH_TRACING = 'false';
delete process.env.LANGCHAIN_TRACING_V2;

import { config } from 'dotenv';
config();

import { createUniswapV4Tools } from '../src/tools/uniswapv4/UniswapV4Tools.js';
import { calcVegaTool } from '../src/tools/mathTools.js';
import { loadEnv } from '../src/config/env.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const { tools } = createUniswapV4Tools({
    gatewayApiKey: process.env.GATEWAY_API_KEY,
    subgraphId: env.UNISWAP_V4_SUBGRAPH_ID,
  });

  // ── 1. Data tool: top v4 venues by volume ─────────────────────────────────
  const topPoolsTool = tools.find((t) => t.name === 'v4TopPools');
  if (!topPoolsTool) throw new Error('v4TopPools tool not registered');
  const top = JSON.parse(await topPoolsTool.invoke({ first: 3 }));

  console.log('── v4TopPools (volume-ordered, no LLM) ──');
  for (const p of top.pools) {
    console.log(
      `  ${p.pair.padEnd(12)} volumeUSD=$${Number(p.volumeUSD).toLocaleString('en-US', { maximumFractionDigits: 0 })}  hook=${p.hooked ? p.hooks.slice(0, 10) + '…' : 'none'}`,
    );
  }

  // ── 2. Hooks tool: hooked books + per-hook leaderboard ────────────────────
  const hookedTool = tools.find((t) => t.name === 'v4HookedPools');
  if (!hookedTool) throw new Error('v4HookedPools tool not registered');
  const hooked = JSON.parse(await hookedTool.invoke({ first: 3 }));

  console.log('\n── v4HookedPools (top hooked books) ──');
  for (const p of hooked.pools) {
    console.log(
      `  ${p.pair.padEnd(12)} hook=${p.hook}  dynamicFee=${p.isDynamicFee}  volumeUSD=$${Number(p.volumeUSD).toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
    );
  }

  // ── 3. Math tool: golden-value vega, no subgraph needed ───────────────────
  const vega = JSON.parse(
    await calcVegaTool.invoke({ sigma: 0.4, leverage: 4, feeApyPct: 24, feeVolScaling: true, notionalUsd: 10_000_000 }),
  );

  console.log('\n── calc_vega (walkthrough golden: expect −1.0 pp/vol-pt ⇒ −$100k/yr on $10M) ──');
  console.log(`  vegaPctPerVolPoint=${vega.vegaPctPerVolPoint}  usdPerVolPoint=${vega.usdPerVolPoint}`);

  // ── 4. Assertions — this script IS the Level A test ────────────────────────
  const failures: string[] = [];
  const topPool = top.pools[0] as { volumeUSD?: string; id?: string } | undefined;
  if (!topPool || parseFloat(topPool.volumeUSD ?? '0') < 1_000_000) {
    failures.push('top pool volume below $1M — volume ordering broken or subgraph stale');
  }
  if (!topPool?.id?.match(/^0x[0-9a-fA-F]{64}$/)) {
    failures.push('top pool id is not a bytes32 hash');
  }
  if (hooked.pools[0]?.hook === '0x0000000000000000000000000000000000000000') {
    failures.push('hooked pool has the zero hook');
  }
  if (vega.vegaPctPerVolPoint !== -1) {
    failures.push(`vega golden value drifted: ${vega.vegaPctPerVolPoint} ≠ -1.0`);
  }

  if (failures.length > 0) {
    console.error(`\nLevel A: FAIL\n  - ${failures.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('\nLevel A: PASS — tools fetch real Graph data and the math table holds.');
}

main().catch((err) => {
  console.error(`Level A probe failed: ${(err as Error).message}`);
  process.exit(1);
});
