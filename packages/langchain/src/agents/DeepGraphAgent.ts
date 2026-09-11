import { createDeepAgent, type DeepAgent } from 'deepagents';
import type { BaseLanguageModel } from '@langchain/core/language_models/base';
import { tool, type StructuredTool } from '@langchain/core/tools';
import * as z from 'zod';

import type { SubgraphClient } from '@ethonline2026/graph-fno-indexer';
import {
  SubgraphRegistry,
  FnoDataExtractor,
  loadEnv as loadGraphEnv,
} from '@ethonline2026/graph-fno-indexer';
import type {
  ProtocolSnapshot,
  FundingSnapshot,
  PositionRow,
} from '@ethonline2026/graph-fno-indexer';
import { createUniswapV4Tools, type UniswapV4ClientOptions } from '../tools/uniswapv4/UniswapV4Tools.js';
import { createLendingTools } from '../tools/LendingDataTool.js';
import { createDexTools } from '../tools/DexDataTool.js';
import { createPredictionTools } from '../tools/PredictionDataTool.js';
import { createFixedIncomeTools } from '../tools/FixedIncomeStrategyTool.js';
import { v4FixedIncomeStrategyTool } from '../tools/V4FixedIncomeStrategyTool.js';
import { createMathTools } from '../tools/mathTools.js';
import { createAcpTools } from '../tools/erc8183/AcpTools.js';
import { createArcSettlementTools } from '../tools/arc/ArcSettlementTools.js';
import { loadEnv } from '../config/env.js';

/**
 * Deep Graph Agent — built on the DeepAgents harness.
 *
 * Integrates with:
 * - @ethonline2026/graph-fno-indexer (F&O derivatives data via FnoDataExtractor)
 * - Uniswap v4 subgraph (pools, swaps, hourly data, tokens, positions)
 *
 * Provides:
 * - Virtual filesystem for context management
 * - Subagent spawning for parallel analysis
 * - Skills and memory for persistent knowledge
 * - Bloomberg-style risk analytics (Greeks, VaR, stress tests)
 */

export interface DeepGraphAgentConfig {
  readonly systemPrompt?: string;
  /**
   * Model id string (prefix must match an INSTALLED provider package — e.g.
   * 'google-vertexai:gemini-2.5-flash-lite' → @langchain/google-vertexai, which this
   * package depends on; 'google-genai:…' would require @langchain/google-genai and
   * crash initChatModel) or a pre-built chat model instance (e.g. ChatVertexAI).
   * Defaults to google-vertexai + VERTEX_AI_MODEL from env.
   */
  readonly model?: string | BaseLanguageModel;
  /** Uniswap v4 subgraph access options (gateway mainnet or Studio self-deployed Sepolia) */
  readonly v4?: UniswapV4ClientOptions;
  /** Skip v4 tool registration (v4 requires GATEWAY_API_KEY or a Studio endpoint) */
  readonly disableV4?: boolean;
  /** Skip multi-category DeFi tools (lending, DEX, prediction markets, fixed income) */
  readonly disableMultiCategory?: boolean;
}

export class DeepGraphAgent {
  private agent: DeepAgent | null = null;
  private extractor: FnoDataExtractor | null = null;
  private v4Client: SubgraphClient | null = null;
  private config: DeepGraphAgentConfig;

  constructor(config: DeepGraphAgentConfig = {}) {
    this.config = config;
  }

  /**
   * Initialize the deep agent with tools and configuration.
   * Sets up FnoDataExtractor (the-graph) and Uniswap v4 tools.
   */
  async initialize(): Promise<void> {
    // Initialize the F&O data extractor — ONLY against our own Studio perp deployment.
    // The FnoDataExtractor speaks the Messari DERIVATIVES schema (derivPerpProtocol,
    // funding, positions); binding it to the first available endpoint (Aave V3 lending,
    // Uniswap v3 DEX…) produces "Type `Query` has no field `derivPerpProtocol`".
    // Until SUBGRAPH_SPEC.md P5 deploys the perp subgraph, F&O tools stay unregistered
    // and the risk analysis runs on the v4/lending/math tools.
    try {
      const graphEnv = loadGraphEnv();
      const registry = SubgraphRegistry.fromEnv(graphEnv);
      const fnoEndpoint = registry.list().find((e) => e.name.startsWith('emsPerp'));

      if (fnoEndpoint) {
        const client = registry.get(fnoEndpoint.name);
        this.extractor = new FnoDataExtractor(client);
      } else {
        console.warn(
          '[DeepGraphAgent] F&O tools disabled: no Studio perp deployment configured (STUDIO_PERP_SEPOLIA_ENDPOINT). Risk analysis uses v4/lending/math tools.',
        );
      }
    } catch (err) {
      console.warn(`[DeepGraphAgent] F&O extractor unavailable: ${(err as Error).message}`);
    }

    const tools = [
      ...this.createTools(),
      ...(this.config.disableV4 ? [] : this.createV4Tools()),
      ...(this.config.disableMultiCategory ? [] : this.createMultiCategoryTools()),
    ];

    const systemPrompt = this.config.systemPrompt ?? `You are a DeFi fixed income analysis agent powered by The Graph protocol data.
Your role is to analyze decentralized finance instruments using Bloomberg-style risk metrics (PORT, MARS, OVME, YAS).

You have multiple data domains:
1. F&O derivatives subgraph (protocolSnapshot/funding/openPositions/delta/valueAtRisk) — REGISTERED ONLY when a Studio perp deployment is configured; if those tools are absent from your toolset, the derivatives subgraph is not deployed and you must NOT attempt F&O queries.
2. Uniswap v4 subgraph (v4* tools): protocol metrics (v4PoolManager), pool state (v4PoolState), top pools (v4TopPools),
   hourly/daily price-volume series (v4PoolHourData, v4PoolDayData), swap flow (v4Swaps), token details (v4TokenData),
   LP positions (v4Position), and hooked books (v4HookedPools).
3. Lending protocols (getLendingReserves, compareLendingYields, getLendingPoolMetrics): Aave V3 reserves, APYs, utilization.
4. DEX protocols (getDexPools, getVolumeAnalysis, getDexMetrics): Uniswap V3 pools, volume, fees.
5. Prediction markets (getPredictionMarkets, getPredictionVolume, getPredictionMetrics): Polymarket conditions, odds.
6. Fixed income strategy (computeFixedIncomeMetrics, findBestYields, runStressTest): alpha, beta, vega, theta, gamma, duration, VaR.
7. Arc settlement (arc_net_position, arc_bridge_netflow, arc_settle_fx, arc_balance, bridge_route): USDC net-flow settlement
   to the Arc hub via CCTP V2 (App Kit Bridge — Fast: seconds / Standard: ~15min), StableFX for non-USD legs (USDC/EURC etc.).
   1inch handles spoke-chain swaps + Aqua/SwapVM strategies; the App Kit Bridge is the ONLY path touching Arc.
8. ERC-8183 Agentic Commerce (acp_create_job, acp_set_provider, acp_set_budget, acp_fund_job, acp_submit_job,
   acp_complete_job, acp_reject_job, acp_claim_refund, acp_job_status): USDC job escrow. Six-state machine —
   Open → Funded → Submitted → Completed/Rejected/Expired. Legal transitions only; IDs from tool results.

v4 notes:
- Pool IDs are bytes32 hashes (not contract addresses). Use v4TopPools to discover pool IDs first.
- v4TopPools is ordered by cumulative VOLUME — use it for real trading venues (ETH/USDC, ETH/USDT, USDC/USDT
  with $B-scale volume). TVL ordering surfaces vault-receipt pools (ETH/1xETH-style) with no trading activity.
- v4HookedPools returns pools with non-zero hooks plus a per-hook volume/fee leaderboard.
  feeTier 8388608 (0x800000) is the dynamic-fee flag — the hook sets the fee at runtime.
- v4Swaps without a poolId returns swaps across all pools.
- v4PoolHourData returns annualized realized volatility computed from hourly closes — use it for vega inputs.
- v4 TVL accounting can go NEGATIVE on high-flash-volume pools (subgraph quirk) — trust volumeUSD over tvlUSD
  for venue ranking.

Fixed income analysis capabilities:
- Compute risk Greeks (delta, gamma, vega, theta, rho) for lending positions
- Calculate Value at Risk (VaR) and Expected Shortfall
- Run stress test scenarios (rate hikes, hacks, depegs)
- Find best yield opportunities across protocols
- Compare yields across multiple chains
- Check subgraph health

v4FixedIncomeStrategy builds complete APR-constrained LP strategies across v4 books in one call
(live Graph data in, allocation out). For any "build me a strategy" request, call it — never allocate weights by intuition.

QUANT ARCHITECTURE — two complementary strategies (LangChain Greeks reference pattern):

STRATEGY 1 — PRE-COMPUTED PIPELINE (used when the inputs are known):
v4FixedIncomeStrategy executes the full quant chain in TypeScript BEFORE you see anything —
subgraph fetches → sigma, feeAPY, k, LVR, vega, efficiency → allocation. You receive exact
numbers as tool output and your job is strategic reasoning + report writing, NOT arithmetic.
This mirrors "calculate the Greeks first, then pass the raw values to LangChain".

STRATEGY 2 — MATH FUNCTION TABLE (used for open-ended questions like
"what happens to vega if sigma rises to 60%?" or "recompute with L=10"):
the quant library is exposed as individual verifiable tools. You extract parameters from
the conversation, call the tool, and read the exact result. The tool — never you — computes.

MATH FUNCTION TABLE — verifiable formulas as tools. You are FORBIDDEN from doing arithmetic in your head:
every quantitative claim in your answer must be the output of one of these tool calls (each is pure,
deterministic, and golden-tested — same inputs always give the same output, visible in the trace):

| Tool | Formula it computes | Inputs (units) |
|---|---|---|
| calc_realized_vol | sigma = sqrt(var(log-returns)) * sqrt(24*365) | hourly closes |
| calc_fee_apy | feeAPY% = fees24h / TVL * 365 * 100 | fees24h, TVL (USD) |
| calc_lvr | LVR% = 100 * L^2 * sigma^2 / 8 | sigma (decimal), L |
| calc_net_apy | netAPY% = (1-w)*feeAPY% + w*lendingAPY% − 100*L^2*sigma^2/8 − gasDrag% | sigma (dec), APYs (%), w, feeVolScaling |
| calc_vega | vega = k − L^2*sigma/4 ; volga = −L^2/4 (k derived internally from feeAPY% + feeVolScaling) | sigma (dec), L, feeAPY%, notional |
| calc_efficiency_ratio | eta = netAPY / LVR | per-book metrics |
| calc_allocation | weights ∝ eta, filtered by minApr + vegaBudget | book list + constraints |

Units contract (the tools convert — you never do unit arithmetic): APYs in PERCENT
(18 = 18%/yr), sigma in DECIMAL (0.4 = 40%), vega output in percentage-points per
+1 vol point with USD per vol point when notional is given.

Pipeline for a strategy request: (1) fetch books via v4FixedIncomeStrategy (or v4TopPools/v4HookedPools +
v4PoolDayData/v4PoolHourData + getLendingReserves), (2) compute per-book metrics with calc_* tools,
(3) allocate with calc_allocation, (4) report. If a number in your report cannot be traced to a math-tool
output in this conversation, it is wrong — recompute it via the table.

FINAL REPORT FORMAT (always Markdown, always in this order):
1. **Executive Summary** — 3 bullets: achieved APR vs target, portfolio vega vs budget, worst-case stress verdict.
2. **Market Scan** — table of books considered: pair, hook address (or "none"), volumeUSD, TVL, feeAPY, sigma, and the tool call that produced each row.
3. **Strategy Construction** — allocation table: pool id, weight %, fee APY, lending leg (w·r), LVR, net APY, vega per vol point.
4. **Risk Report** — portfolio vega, volga note, concentration flags, VaR(95/99).
5. **Stress Scenarios** — sigma×1.5 and sigma×2 rows; verdict PASS/FAIL for fixed-income status.
6. **Execution Plan** — per book: range for L, size, monitoring triggers (sigma above trigger ⇒ reduce L).
7. **Data Provenance** — subgraph deployment ids, block numbers, tool-call count.
8. **Caveats** — anything not verified on-chain, the negative-TVL quirk, no sovereign guarantee.

Never invent numbers: every figure must trace to a tool result in this conversation —
data from the subgraph tools, arithmetic from the math function table (calc_*).
If a required datum is missing, run another tool — do not estimate silently.

ID GROUNDING (critical): arguments like protocolId / poolId / tokenId MUST come from a
prior tool output (v4TopPools, v4HookedPools, v4PoolState discovered them) — never
fabricate 0x addresses or bytes32 hashes. If a tool errors on an ID, do NOT retry with an
invented variant; switch to a discovery tool (v4TopPools / subgraphHealth) and use only
IDs it returned. If the F&O derivatives subgraph has no deployed protocol, say so and
run the risk analysis on the v4 lending/LP tools instead.

Always validate input parameters before making tool calls.
Return structured, validated JSON responses.`;

    // Default model: construct ChatVertexAI DIRECTLY (same path as the passing e2e)
    // instead of handing initChatModel a 'google-vertexai:…' string. Direct construction
    // carries temperature + maxRetries and skips the universal-loader import dance.
    // DO NOT use 'google-genai:…' here — @langchain/google-genai is not installed and
    // initChatModel throws "Unable to import @langchain/google-genai".
    let model: string | BaseLanguageModel | undefined = this.config.model;
    if (model === undefined) {
      const agentEnv = loadEnv();
      const { ChatVertexAI } = await import('@langchain/google-vertexai');
      model = new ChatVertexAI({
        model: agentEnv.VERTEX_AI_MODEL,
        temperature: agentEnv.VERTEX_AI_TEMPERATURE,
        maxRetries: 6,
      });
    }

    this.agent = await createDeepAgent({
      tools,
      systemPrompt,
      model,
    });
    this.systemPrompt = systemPrompt;
    this.tools = tools;
  }

  /**
   * MODEL FALLBACK CHAIN — resolves the 75% rejected/hung Vertex calls.
   *
   * Diagnosis (2026-09-07, gcloud): project quotas are 3.45M TPM/region (not the
   * constraint); failures are per-request instability on a single model under
   * load — surfacing as the cryptic `Cannot read properties of undefined
   * (reading 'message')` MiddlewareError or multi-minute hangs. A single-model
   * retry budget does NOT cover it (verified: standalone passes, loaded runs
   * fail ~50%).
   *
   * Fix: rotate the MODEL itself per attempt — flash-lite → 2.0-flash →
   * 2.5-flash — each with its own agent instance (cached) and a hard per-
   * attempt timeout so hung requests fall through instead of blocking.
   */
  private static readonly FALLBACK_MODELS = [
    process.env.VERTEX_AI_MODEL ?? 'gemini-2.5-flash-lite', // primary (cheapest)
    'gemini-2.0-flash', // larger capacity pool
    'gemini-2.5-flash', // premium fallback
  ];
  private readonly agentsByModel = new Map<string, DeepAgent>();
  private systemPrompt?: string;
  private tools: StructuredTool[] = [];

  private async agentForModel(modelName: string): Promise<DeepAgent> {
    const cached = this.agentsByModel.get(modelName);
    if (cached) return cached;
    const { ChatVertexAI } = await import('@langchain/google-vertexai');
    const model = new ChatVertexAI({
      model: modelName,
      temperature: loadEnv().VERTEX_AI_TEMPERATURE,
      maxRetries: 4,
    });
    const agent = await createDeepAgent({
      tools: this.tools,
      systemPrompt: this.systemPrompt ?? '',
      model,
    });
    this.agentsByModel.set(modelName, agent);
    return agent;
  }

  /**
   * Create Uniswap v4 tools (requires GATEWAY_API_KEY or UNISWAP_V4_STUDIO_ENDPOINT).
   */
  private createV4Tools() {
    const env = loadEnv();
    const gatewayApiKey = env.GATEWAY_API_KEY;
    const studioEndpoint = env.UNISWAP_V4_STUDIO_ENDPOINT;
    const opts: UniswapV4ClientOptions = {
      subgraphId: env.UNISWAP_V4_SUBGRAPH_ID,
      ...(gatewayApiKey !== undefined ? { gatewayApiKey } : {}),
      ...(studioEndpoint !== undefined ? { studioEndpoint } : {}),
    };

    if (!gatewayApiKey && !studioEndpoint) {
      // v4 needs one of the two access paths; skip silently but log
      console.warn('[DeepGraphAgent] v4 tools disabled: set GATEWAY_API_KEY or UNISWAP_V4_STUDIO_ENDPOINT to enable.');
      return [];
    }

    const { client, tools } = createUniswapV4Tools(opts);
    this.v4Client = client;
    return tools;
  }

  /**
   * Create LangChain tools that wrap FnoDataExtractor methods.
   */
  private createTools() {
    // F&O tools require the extractor; if unavailable, return only the health tool
    if (!this.extractor) return [];
    const extractor = this.extractor;

    // Protocol Snapshot tool
    const protocolSnapshotTool = tool(
      async (input: unknown) => {
        const { protocolId } = input as { protocolId: string };
        const snapshot: ProtocolSnapshot | null = await extractor.protocolSnapshot(protocolId);

        if (!snapshot) {
          return JSON.stringify({ error: 'Protocol not found' });
        }

        return JSON.stringify({
          id: snapshot.id,
          name: snapshot.name,
          totalValueLockedUSD: snapshot.totalValueLockedUSD,
          longOpenInterestUSD: snapshot.longOpenInterestUSD,
          shortOpenInterestUSD: snapshot.shortOpenInterestUSD,
          totalOpenInterestUSD: snapshot.totalOpenInterestUSD,
        });
      },
      {
        name: 'protocolSnapshot',
        description: 'Get protocol snapshot including TVL, open interest (long/short), cumulative volume and revenue',
        schema: z.object({
          protocolId: z.string().describe('Protocol ID (0x address)'),
        }),
      }
    );

    // Funding tool
    const fundingTool = tool(
      async (input: unknown) => {
        const { poolId, hours = 24 } = input as { poolId: string; hours?: number };
        const funding: FundingSnapshot | null = await extractor.funding(poolId, hours);

        if (!funding) {
          return JSON.stringify({ error: 'Pool not found or no funding data' });
        }

        return JSON.stringify({
          id: funding.id,
          fundingrate: funding.fundingrate,
          totalValueLockedUSD: funding.totalValueLockedUSD,
          hourlySnapshots: funding.hourlySnapshots.slice(0, 10).map((s) => ({
            hours: s.hours,
            hourlyFundingrate: s.hourlyFundingrate,
          })),
        });
      },
      {
        name: 'funding',
        description: 'Get funding rates and hourly snapshots for a pool',
        schema: z.object({
          poolId: z.string().describe('Pool ID (0x address)'),
          hours: z.number().optional().describe('Hours of historical data (default: 24)'),
        }),
      }
    );

    // Open Positions tool
    const openPositionsTool = tool(
      async (input: unknown) => {
        const { poolId } = input as { poolId: string };
        const positions: PositionRow[] = await extractor.openPositions(poolId);

        return JSON.stringify({
          positionCount: positions.length,
          positions: positions.slice(0, 50).map((p) => ({
            id: p.id,
            side: p.side,
            leverage: p.leverage,
            balanceUSD: p.balanceUSD,
          })),
        });
      },
      {
        name: 'openPositions',
        description: 'Get open positions for a pool with side, leverage, and balance data',
        schema: z.object({
          poolId: z.string().describe('Pool ID (0x address)'),
        }),
      }
    );

    // Delta tool — computes position delta from open positions
    const deltaTool = tool(
      async (input: unknown) => {
        const { poolId } = input as { poolId: string };
        const positions: PositionRow[] = await extractor.openPositions(poolId);

        let longExposure = 0;
        let shortExposure = 0;

        for (const pos of positions) {
          const balanceUSD = parseFloat(pos.balanceUSD) || 0;
          const leverage = parseFloat(pos.leverage) || 1;

          if (pos.side === 'LONG') {
            longExposure += balanceUSD * leverage;
          } else {
            shortExposure += balanceUSD * leverage;
          }
        }

        const netExposure = longExposure - shortExposure;

        return JSON.stringify({
          delta: positions.length > 0 ? netExposure / positions.length : 0,
          netExposure,
          longExposure,
          shortExposure,
          positionCount: positions.length,
        });
      },
      {
        name: 'delta',
        description: 'Compute position delta — sensitivity of position value to underlying price changes',
        schema: z.object({
          poolId: z.string().describe('Pool ID (0x address)'),
        }),
      }
    );

    // VaR tool
    const varTool = tool(
      async (input: unknown) => {
        const { protocolId } = input as { protocolId: string };
        const snapshot: ProtocolSnapshot | null = await extractor.protocolSnapshot(protocolId);

        if (!snapshot) {
          return JSON.stringify({ error: 'Protocol not found' });
        }

        const metrics = snapshot.financialMetrics;
        const returns: number[] = [];

        for (let i = 1; i < metrics.length; i++) {
          const current = parseFloat(metrics[i]!.dailyVolumeUSD) || 0;
          const previous = parseFloat(metrics[i - 1]!.dailyVolumeUSD) || 0;
          if (previous > 0) {
            returns.push((current - previous) / previous);
          }
        }

        const sortedReturns = [...returns].sort((a, b) => a - b);
        const idx95 = Math.floor(sortedReturns.length * 0.05);
        const var95 = -sortedReturns[idx95]!;

        return JSON.stringify({
          var95,
          var99: -sortedReturns[Math.floor(sortedReturns.length * 0.01)]!,
          dataPoints: returns.length,
        });
      },
      {
        name: 'valueAtRisk',
        description: 'Compute Value at Risk (VaR) at 95% and 99% confidence levels',
        schema: z.object({
          protocolId: z.string().describe('Protocol ID (0x address)'),
        }),
      }
    );

    // Health check tool
    const healthTool = tool(
      async () => {
        const client: SubgraphClient = extractor['client'];
        const health = await client.health();

        return JSON.stringify({
          deployment: health.deployment,
          blockNumber: health.blockNumber,
          hasIndexingErrors: health.hasIndexingErrors,
        });
      },
      {
        name: 'subgraphHealth',
        description: 'Check subgraph indexing health status and block number',
        schema: z.object({}),
      }
    );

    return [
      protocolSnapshotTool,
      fundingTool,
      openPositionsTool,
      deltaTool,
      varTool,
      healthTool,
    ];
  }

  /**
   * Invoke the agent with a user query — MODEL FALLBACK CHAIN.
   *
   * Attempt order: configured/primary model (flash-lite) → gemini-2.0-flash →
   * gemini-2.5-flash. Each attempt gets a hard 120s timeout (kills hung
   * requests — the "waiting indefinitely" class) and the transient classifier
   * (undefined.message / 429 / 500 / overloaded) rotates to the NEXT MODEL,
   * not just the same one. The per-attempt agent is cached per model.
   */
  async invoke(query: string, retries = 2): Promise<unknown> {
    if (!this.agent) {
      await this.initialize();
    }

    const chain = [...DeepGraphAgent.FALLBACK_MODELS];
    const primary = this.config.model;
    // A custom model instance/string from config takes slot 0 (its agent is this.agent).
    const attempts: Array<{ model: string | undefined; agent: DeepAgent }> = [];
    if (primary !== undefined) {
      attempts.push({ model: undefined, agent: this.agent! });
    }
    for (const modelName of chain) {
      if (typeof primary === 'string' && primary.includes(modelName) && attempts.length > 0) {
        continue; // already the primary
      }
      attempts.push({ model: modelName, agent: await this.agentForModel(modelName) });
    }
    if (attempts.length === 0) attempts.push({ model: undefined, agent: this.agent! });

    const ATTEMPT_TIMEOUT_MS = 120_000;
    let lastErr: unknown;

    for (let i = 0; i < attempts.length; i++) {
      const { model: modelName, agent } = attempts[i]!;
      const label = modelName ?? 'primary';
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const invoked = agent.invoke({
            messages: [{ role: 'user' as const, content: query }],
          });
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`model timeout after ${ATTEMPT_TIMEOUT_MS}ms`)),
              ATTEMPT_TIMEOUT_MS,
            ),
          );
          return await Promise.race([invoked, timeout]);
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          const transient =
            msg.includes("reading 'message'") ||
            /\b429\b/.test(msg) ||
            /\b500\b/.test(msg) ||
            /\b503\b/.test(msg) ||
            /timeout/i.test(msg) ||
            /overloaded/i.test(msg) ||
            /UNAVAILABLE/i.test(msg);
          if (!transient || attempt === retries) {
            console.warn(`[DeepGraphAgent] model "${label}" failed (non-retryable or exhausted): ${msg.slice(0, 120)}`);
            break; // rotate to next model in the chain
          }
          const backoffMs = 1500 * (attempt + 1);
          console.warn(
            `[DeepGraphAgent] "${label}" transient failure (attempt ${attempt + 1}/${retries + 1}): ${msg.slice(0, 120)} — retrying in ${backoffMs}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }
    throw lastErr;
  }

  /**
   * Get the underlying DeepAgent instance.
   */
  getAgent(): DeepAgent | null {
    return this.agent;
  }

  /**
   * Get the FnoDataExtractor instance.
   */
  getExtractor(): FnoDataExtractor | null {
    return this.extractor;
  }

  /**
   * Get the Uniswap v4 subgraph client.
   */
  getV4Client(): SubgraphClient | null {
    return this.v4Client;
  }

  /**
   * Create multi-category DeFi tools (lending, DEX, prediction markets, fixed income).
   */
  private createMultiCategoryTools() {
    return [
      ...createLendingTools(),
      ...createDexTools(),
      ...createPredictionTools(),
      ...createFixedIncomeTools(),
      v4FixedIncomeStrategyTool,
      ...createMathTools(),
      ...createArcSettlementTools(),
      ...createAcpTools(),
    ];
  }
}
