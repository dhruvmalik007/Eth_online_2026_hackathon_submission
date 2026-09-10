import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Load root .env (GATEWAY_API_KEY lives in repo root, not in packages/langchain) ───
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const envPath = path.join(repoRoot, '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!;
}

const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY;
const hasGateway = !!GATEWAY_API_KEY && GATEWAY_API_KEY.length > 10;

// ─── Skip guard: this e2e needs live credentials ───
const skipMsg =
  'E2E skipped: set GATEWAY_API_KEY in repo root .env (and run `gcloud auth application-default login`) to run live Vertex + mainnet v4 subgraph tests.';

// ─── Imports (deferred so the file parses without the deps) ───
const { DeepGraphAgent } = await import('../../src/agents/DeepGraphAgent.js');
const { createUniswapV4Tools } = await import('../../src/tools/uniswapv4/UniswapV4Tools.js');
const { loadEnv: loadAgentEnv } = await import('../../src/config/env.js');

describe('E2E: Fixed-income trader on Uniswap v4 mainnet (Vertex AI + deep agent)', () => {
  let model: any;
  let agent: any;

  beforeAll(async () => {
    if (!hasGateway) return;
    const { ChatVertexAI } = await import('@langchain/google-vertexai');
    model = new ChatVertexAI({
      model: process.env.VERTEX_AI_MODEL ?? 'gemini-2.5-flash-lite',
      temperature: 0.1,
      // flash-lite free tier throttles hard under parallel test load; without a
      // healthy retry budget the 429s surface as the cryptic
      // "Cannot read properties of undefined (reading 'message')" MiddlewareError.
      maxRetries: 6,
    });

    const deep = new DeepGraphAgent({
      model,
      systemPrompt: `You are a fixed-income / rates trader operating in DeFi.
Your job is to find the best execution venue for large stablecoin orders using Uniswap v4 mainnet data.
Think step by step: (1) discover top pools, (2) pull 24h hourly series for the deepest candidates,
(3) compare TVL depth, 24h volume, fees, and realized volatility, (4) recommend the best pool
with its bytes32 pool ID and a one-paragraph rationale. Be concise and quantitative.`,
    });
    await deep.initialize();
    agent = deep.getAgent();
  }, 60_000);

  it('loads the v4 subgraph client and registers v4 tools', { retry: 2 }, async () => {
    if (!hasGateway) {
      console.warn(skipMsg);
      return;
    }
    const deep = new DeepGraphAgent({ model });
    await deep.initialize();
    expect(deep.getV4Client()).not.toBeNull();
  });

  it('queries mainnet v4: top pools + hourly series return real data', { retry: 2, timeout: 30_000 }, async () => {
    if (!hasGateway) {
      console.warn(skipMsg);
      return;
    }
    const v4Env = loadAgentEnv();
    const { tools } = createUniswapV4Tools({
      gatewayApiKey: GATEWAY_API_KEY!,
      subgraphId: v4Env.UNISWAP_V4_SUBGRAPH_ID,
    });

    // Discover top pools — ordered by cumulative VOLUME (not TVL, which surfaces
    // vault-receipt pools like ETH/1xETH with near-zero trading)
    const topPoolsTool = tools.find((t) => t.name === 'v4TopPools');
    expect(topPoolsTool).toBeDefined();
    const topRes = await topPoolsTool!.invoke({ first: 5, skip: 0 });
    const top = JSON.parse(topRes);
    expect(top.pools.length).toBeGreaterThan(0);
    expect(top.pools[0].id).toMatch(/^0x[0-9a-fA-F]{64}$/); // bytes32 pool id
    // Volume ordering must return pools with real trading activity ($M+ cumulative)
    expect(parseFloat(top.pools[0].volumeUSD)).toBeGreaterThan(1_000_000);

    // Hooked pools — v4 hooks are first-class; expect at least one hooked pool
    // among the top volume venues, with a per-hook leaderboard in the response
    const hookedTool = tools.find((t) => t.name === 'v4HookedPools');
    expect(hookedTool).toBeDefined();
    const hookedRes = await hookedTool!.invoke({ first: 5, skip: 0 });
    const hooked = JSON.parse(hookedRes);
    expect(hooked.pools.length).toBeGreaterThan(0);
    expect(hooked.pools[0].hook).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(hooked.pools[0].hook).not.toBe('0x0000000000000000000000000000000000000000');
    expect(hooked.hookLeaderboard.length).toBeGreaterThan(0);
    const dynamicFeePool = hooked.pools.find((p: any) => p.isDynamicFee === true);

    // Pull hourly data — walk down the top-5 until one returns series data.
    const hourTool = tools.find((t) => t.name === 'v4PoolHourData');
    expect(hourTool).toBeDefined();

    let hour: any = null;
    let poolId: string | null = null;
    for (const pool of top.pools) {
      const hourRes = await hourTool!.invoke({ poolId: pool.id, hours: 24 });
      const parsed = JSON.parse(hourRes);
      if (parsed.series?.length > 0) {
        hour = parsed;
        poolId = pool.id;
        break;
      }
    }
    expect(hour).not.toBeNull(); // at least one of the top pools must have 24h activity
    expect(hour!.series.length).toBeGreaterThan(0);
    expect(hour!.series[0].price).toBeDefined();
    expect(typeof hour!.volatilityAnnualized).toBe('number');

    console.log(`  [e2e] top pool by volume: ${top.pools[0].pair} cumulative $${(parseFloat(top.pools[0].volumeUSD) / 1e6).toFixed(1)}M`);
    console.log(`  [e2e] top hooked pool: ${hooked.pools[0].pair} hook=${hooked.pools[0].hook}${dynamicFeePool ? ' (dynamic fee)' : ''}`);
    console.log(`  [e2e] pool with 24h data: ${poolId!.slice(0, 10)}…`);
    console.log(`  [e2e] 24h hourly points: ${hour!.series.length}, annualized vol: ${hour!.volatilityAnnualized}`);
  });

  it('deep agent reasons about a large fixed-income order end-to-end', { retry: 2, timeout: 120_000 }, async () => {
    if (!hasGateway) {
      console.warn(skipMsg);
      return;
    }
    expect(agent).toBeDefined();

    const t0 = Date.now();
    let result: any;
    try {
      result = await agent.invoke({
        messages: [
          {
            role: 'user',
            content: `I am a fixed-income trader. I need to deploy $25,000,000 USDC into the deepest, most liquid
stablecoin pool on Uniswap v4 mainnet for a 1-hour holding period. Find the best venue using the v4 tools:
first list the top pools by TVL, then pull the last 24 hours of hourly data for the top 2-3 candidates,
and recommend the single best pool with its bytes32 ID, current TVL, 24h volume, fee tier, and a short
rationale covering depth, volatility, and expected slippage.`,
          },
        ],
      });
    } catch (err) {
      // The langchain MiddlewareError wrap loses the original cause behind
      // "Cannot read properties of undefined (reading 'message')". Walk the
      // full cause chain so the REAL Vertex/API error is visible in CI output.
      console.error('[e2e] RAW FAILURE — full error cause chain:');
      let e: unknown = err;
      let depth = 0;
      while (e !== null && e !== undefined && depth < 8) {
        if (e instanceof Error) {
          console.error(`  [${depth}] ${e.name}: ${e.message}`);
          const resp = (e as { response?: unknown }).response;
          const details = (e as { details?: unknown }).details;
          if (resp !== undefined) console.error(`      response: ${JSON.stringify(resp)?.slice(0, 600)}`);
          if (details !== undefined) console.error(`      details: ${JSON.stringify(details)?.slice(0, 600)}`);
        } else {
          console.error(`  [${depth}]`, JSON.stringify(e)?.slice(0, 600) ?? e);
        }
        e = (e as { cause?: unknown }).cause;
        depth += 1;
      }
      throw err;
    }
    const latency = Date.now() - t0;

    // The deepagents harness returns messages; the last AI message is the synthesis
    const messages = result?.messages ?? [];
    const aiMessages = messages.filter((m: any) => m._getType?.() === 'ai' || m.role === 'assistant');
    const lastAi = aiMessages[aiMessages.length - 1];
    const text = typeof lastAi?.content === 'string' ? lastAi.content : JSON.stringify(lastAi?.content ?? '');

    console.log(`  [e2e] agent latency: ${(latency / 1000).toFixed(1)}s`);
    console.log(`  [e2e] agent output (first 400 chars): ${text.slice(0, 400)}`);

    // Assert the agent produced a substantive answer referencing a pool id or pool metrics
    expect(text.length).toBeGreaterThan(100);
    const hasPoolId = /^0x[0-9a-fA-F]{64}/m.test(text);
    const hasMetrics = /TVL|tvl|volume|liquidity|fee|slippage|volatility/i.test(text);
    expect(hasPoolId || hasMetrics).toBe(true);
  });
});
