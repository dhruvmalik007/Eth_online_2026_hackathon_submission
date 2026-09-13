/**
 * Deterministic agent script.
 *
 * This is what replaces `apps/agentic-ems`'s `ChatStage.runScript()` for the
 * scaffold pass: instead of keyword-matching a prompt and pushing pre-written
 * prose on a timer, it emits real `InferenceEvent`s in the real contract, through
 * the real orchestrator, with real run-state transitions and a real approval
 * intent. The only thing it does not do is call a model.
 *
 * That is deliberate: it makes the whole pipeline — SSE framing, event ordering,
 * `AgentStep` mapping, sandbox execution, the signing-intent envelope, the HITL
 * approval queue — testable end-to-end with no database, no model and no network.
 * `LangchainAgentPort` replaces it (ROADMAP T3.1/T3.3).
 */
import {
  SETTLEMENT_CHAIN_ID,
  SETTLEMENT_CHAIN_LABEL,
  SETTLEMENT_TOKENS,
  resolveSettlementVenue,
  type SettlementVenue,
} from "@ethonline2026/bridges";
import type { ExecutionPlan, ExecutionStep, IntentLeg, Quote } from "@ethonline2026/execution-domain";
import { buildSigningIntent, type SafeLeg, type SigningIntent, type SigningIntentInput } from "@ethonline2026/custody";
import type { AgentMode } from "../events/contract.js";
import type { AgentPort, AgentRequest, AgentRunContext, AgentRunOutcome } from "./AgentPort.js";
import { buildAgentStep } from "./eventMapper.js";

/**
 * The venues this fixture deploys to, resolved from the settlement registry.
 *
 * These were hardcoded Base **mainnet** constants while the custodian settled on
 * Sepolia, so the intent declared one chain and addressed another. That is invisible
 * to a digest check — the envelope is self-consistent — and shows up only as legs
 * that cannot execute on the chain they claim.
 *
 * Resolving them here means the fixture cannot drift from the chain it settles on:
 * move the settlement chain and the addresses follow, or the lookup fails loudly.
 */
function venue(protocol: string): SettlementVenue {
  const found = resolveSettlementVenue(protocol);
  if (found === null) {
    throw new Error(`fixture references "${protocol}", which has no registered settlement venue`);
  }
  return found;
}

/**
 * Aave for the lending leg, not Morpho — and not a preference.
 *
 * Morpho's registry entry carries no `token` on purpose: a Morpho Blue market is
 * keyed by its loan token, so a market's USDC has to be resolved per market. A fixture
 * that picked one would assert an address nobody verified. Aave's venue specifies its
 * token and spender exactly, which makes this approve→supply pair provably correct on
 * the settlement chain.
 */
const LEND_VENUE = venue("aave-v3");
const LP_VENUE = venue("uniswap-v4");
/** Providing liquidity goes through the PositionManager, not the PoolManager. */
const LP_TARGET = LP_VENUE.auxiliary?.["positionManager"]?.address ?? LP_VENUE.target.address;
const SAFE_ACCOUNT = "0x1111111111111111111111111111111111111111";

const FIXTURE_LEGS: IntentLeg[] = [
  {
    id: "leg-1",
    kind: "lend",
    protocol: "aave-v3",
    chain: SETTLEMENT_CHAIN_LABEL,
    amountUsd: 65_000,
    token: "USDC",
    sourceChain: SETTLEMENT_CHAIN_LABEL,
    minApy: 4.2,
    intent: `Supply 65,000 USDC to Aave v3 on ${SETTLEMENT_CHAIN_LABEL} at a minimum 4.2% APY`,
    resolvable: true,
  },
  {
    id: "leg-2",
    kind: "lp",
    protocol: "uniswap-v4",
    chain: SETTLEMENT_CHAIN_LABEL,
    amountUsd: 35_000,
    token: "USDC/ETH",
    sourceChain: SETTLEMENT_CHAIN_LABEL,
    minApy: 3.2,
    intent: `Provide 35,000 USDC of liquidity to the USDC/ETH v4 pool on ${SETTLEMENT_CHAIN_LABEL}`,
    resolvable: true,
    illustrative: true,
  },
];

const FIXTURE_STEPS: ExecutionStep[] = [
  {
    id: "step-approve-usdc",
    legId: "leg-1",
    kind: "approve",
    label: "Approve USDC",
    intent: "Approve 65,000 USDC for Aave v3",
    // The allowance goes to the venue's own token and its spender, both from the
    // registry — so the approve cannot name a token the venue does not accept.
    tx: { to: SETTLEMENT_TOKENS.usdc.address, value: "0", data: "0x095ea7b3", operation: 0 },
    state: "queued",
  },
  {
    id: "step-supply-lend",
    legId: "leg-1",
    kind: "supply",
    label: "Supply to Aave v3",
    intent: `Supply 65,000 USDC to Aave v3 on ${SETTLEMENT_CHAIN_LABEL}`,
    tx: { to: LEND_VENUE.target.address, value: "0", data: "0x617ba037", operation: 0 },
    state: "queued",
  },
  {
    id: "step-mint-v4",
    legId: "leg-2",
    kind: "supply",
    label: "Provide v4 liquidity",
    intent: "Provide 35,000 USDC of liquidity to the USDC/ETH v4 pool",
    tx: { to: LP_TARGET, value: "0", data: "0xdd46508f", operation: 0 },
    state: "queued",
  },
];

const FIXTURE_QUOTES: Quote[] = [
  {
    legId: "leg-1",
    provider: "direct",
    venue: `Aave v3 · ${SETTLEMENT_CHAIN_LABEL}`,
    fees: [
      { id: "fee-gas", label: "Network fee", tier: "cost", amountUsd: 0.31, token: "ETH", chain: SETTLEMENT_CHAIN_LABEL },
      { id: "fee-slip", label: "Slippage bound", tier: "bound", amountUsd: 6.5, bps: 10 },
    ],
    slippageBoundPct: 0.1,
    priceImpactPct: 0.0,
    estimatedSeconds: 30,
  },
  {
    legId: "leg-2",
    provider: "direct",
    venue: `Uniswap v4 · ${SETTLEMENT_CHAIN_LABEL}`,
    fees: [
      { id: "fee-gas-2", label: "Network fee", tier: "cost", amountUsd: 0.44, token: "ETH", chain: SETTLEMENT_CHAIN_LABEL },
      { id: "fee-impact-2", label: "Price impact", tier: "market", amountUsd: 12.1 },
    ],
    slippageBoundPct: 0.5,
    priceImpactPct: 0.03,
    estimatedSeconds: 45,
  },
];

const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
};

function fixturePlan(createdAt: number): ExecutionPlan {
  return {
    id: "plan-fixture-1",
    createdAt,
    legs: FIXTURE_LEGS,
    quotes: FIXTURE_QUOTES,
    steps: FIXTURE_STEPS,
    batchDigest: "0x9f2f4c2b1d3e5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
    batchIntent: `Supply 65,000 USDC to Aave v3 and provide 35,000 USDC of USDC/ETH v4 liquidity on ${SETTLEMENT_CHAIN_LABEL}`,
    totals: { notionalUsd: 100_000, costUsd: 0.75, boundUsd: 6.5 },
    mode: "batch",
    signing: "safe-batch",
    simulated: true,
  };
}

/**
 * The plan's `ExecutionStep`s, projected into Safe legs.
 *
 * This is the real direction of travel — an `ExecutionStep.tx` is already
 * `{to, value, data, operation}`, which is exactly a Safe `MetaTransactionData` —
 * so the fixture exercises the same projection production will use.
 */
function legsFrom(plan: ExecutionPlan): SafeLeg[] {
  return plan.steps.map((step) => ({
    to: step.tx.to,
    value: step.tx.value,
    data: step.tx.data,
    operation: step.tx.operation,
  }));
}

/**
 * What the human is shown.
 *
 * Derived from the plan rather than written as prose, so the displayed notional
 * and costs cannot drift from the batch being authorised — which is the property
 * an approval is worthless without.
 */
function displayFor(plan: ExecutionPlan): SigningIntentInput["display"] {
  const usd = (value: number, digits = 0): string =>
    `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  return {
    title: `Deploy ${usd(plan.totals.notionalUsd)}`,
    sentence: plan.batchIntent,
    fields: [
      { label: "Notional", value: usd(plan.totals.notionalUsd) },
      { label: "Wallet cost", value: usd(plan.totals.costUsd, 2) },
      { label: "Slippage bound", value: usd(plan.totals.boundUsd, 2) },
      { label: "Legs", value: String(plan.legs.length) },
    ],
    warnings: ["leg-2 is illustrative: the v4 pool was not resolved on-chain."],
  };
}

/**
 * Ask custody for the intent.
 *
 * In `live` mode this is a **real** Safe proposal — real `safeTxHash`, real
 * `execTransaction` calldata — built by `SafeClient.proposeIntent`. In `dry` mode
 * there is no chain and no signer, so a fixture is used; that is the only
 * difference between the demo and production on this path.
 */
async function proposeIntent(
  context: AgentRunContext,
  plan: ExecutionPlan,
): Promise<SigningIntent> {
  const legs = legsFrom(plan);
  const display = displayFor(plan);
  if (context.custody.mode === "live") {
    return await context.custody.proposeIntent({
      legs,
      display,
      requestId: context.runId,
      agentId: "v01",
      kind: "v01-readjustment",
      policy: {
        perTxCapUsdc: 250_000,
        dailyCapUsdc: 500_000,
        allowlistOk: true,
        evaluatedAt: new Date().toISOString(),
        privyPolicyId: null,
      },
      provenance: {
        agentId: "v01",
        agentRunId: context.runId,
        langsmithTraceId: null,
        model: null,
        decisionIds: plan.legs.map((leg) => leg.id),
      },
    });
  }
  return fixtureIntent(plan, context.runId);
}

function fixtureIntent(plan: ExecutionPlan, runId: string): SigningIntent {
  return buildSigningIntent({
    intentId: `intent-${runId}`,
    requestId: runId,
    agentId: "v01",
    createdAt: new Date(plan.createdAt).toISOString(),
    chain: `eip155:${SETTLEMENT_CHAIN_ID}`,
    chainId: SETTLEMENT_CHAIN_ID,
    account: SAFE_ACCOUNT,
    kind: "v01-readjustment",
    signing: {
      scheme: "safe-typed-data",
      safeAddress: SAFE_ACCOUNT,
      safeTxHash: plan.batchDigest,
      safeNonce: 42,
      typedData: {
        primaryType: "SafeTx",
        domain: { chainId: SETTLEMENT_CHAIN_ID, verifyingContract: SAFE_ACCOUNT },
        message: {
          to: LP_TARGET,
          value: "0",
          data: "0xdd46508f",
          operation: 1,
          safeTxGas: "0",
          baseGas: "0",
          gasPrice: "0",
          gasToken: "0x0000000000000000000000000000000000000000",
          refundReceiver: "0x0000000000000000000000000000000000000000",
          nonce: 42,
        },
        types: SAFE_TX_TYPES,
      },
    },
    display: displayFor(plan),
    authorized: {
      legs: legsFrom(plan),
      // Honest: no `execTransaction` calldata exists until a proposal is built
      // against a chain, so the fixture says so instead of inventing bytes.
      calldata: null,
      nonce: 42,
    },
    policy: { perTxCapUsdc: 250_000, dailyCapUsdc: 500_000, allowlistOk: true, evaluatedAt: null, privyPolicyId: null },
    provenance: {
      agentId: "v01",
      agentRunId: runId,
      langsmithTraceId: null,
      model: null,
      decisionIds: plan.legs.map((leg) => leg.id),
    },
  });
}

function safeTxHashOf(intent: SigningIntent): string | null {
  return intent.signing.scheme === "safe-typed-data" ? intent.signing.safeTxHash : null;
}

export class MockAgentPort implements AgentPort {
  constructor(readonly id: AgentMode = "v01") {}

  async run(request: AgentRequest, context: AgentRunContext): Promise<AgentRunOutcome> {
    const { emit } = context;
    const messageId = `msg-${context.runId}`;

    // 1. The agent's prose, streamed as deltas the UI can type out.
    const prose = `Understood — ${request.horizonDays}d horizon across ${request.pools.length} pool(s). Running the v0.1 cycle: ingest, parse rules, forecast, synthesise, readjust.`;
    for (const chunk of splitChunks(prose, 64)) {
      emit({ type: "message.delta", messageId, text: chunk });
    }
    emit({ type: "message.completed", messageId, text: prose });

    // 2. The four data agents fan out in parallel. Each `AgentStep` is the real
    //    UI contract; the evidence is what the (fixture) source actually returned.
    const dataAgents = [
      { id: "graph", agent: "Graph Indexer", call: "task(subagent=graph-indexer)", args: { payload: "positions+liquidity" }, source: "gateway.thegraph.com", reasoning: ["Resolved 5 healthy subgraphs", "Read lending-v3 schema"] },
      { id: "llama", agent: "DefiLlama", call: "task(subagent=defillama)", args: { payload: "yields+fees" }, source: "yields.llama.fi", reasoning: ["Pulled 12,404 pools", "Cross-checked fee tiers"] },
      { id: "timeseries", agent: "Timeseries Keeper", call: "task(subagent=timeseries-keeper)", args: { payload: "168h realized vol" }, source: "timescaledb", reasoning: ["Loaded 168h window", "0 missing intervals"] },
      { id: "oracle", agent: "Oracle Vault", call: "task(subagent=oracle-vault)", args: { payload: "prices+caps" }, source: "chainlink", reasoning: ["ETH/USD fresh (4s)", "PolicyGate snapshot OK"] },
    ];
    for (const agent of dataAgents) {
      emit({
        type: "step.start",
        step: buildAgentStep({
          id: `trace-${agent.id}`,
          agent: agent.agent,
          call: agent.call,
          argsSummary: Object.values(agent.args).join(" · "),
          state: "running",
          parallel: true,
          reasoning: agent.reasoning,
          provenance: { source: agent.source },
        }),
      });
    }
    for (const agent of dataAgents) {
      emit({
        type: "step.completed",
        step: buildAgentStep({
          id: `trace-${agent.id}`,
          agent: agent.agent,
          call: agent.call,
          argsSummary: Object.values(agent.args).join(" · "),
          state: "done",
          parallel: true,
          reasoning: agent.reasoning,
          evidence: Object.entries(agent.args).map(([label, value]) => ({ label, value: String(value) })),
          result: { summary: `${agent.agent} payload received` },
          provenance: { source: agent.source },
        }),
      });
    }

    // 3. One real sandbox round-trip, so the E2B-shaped flow is exercised rather
    //    than described. Failure here degrades the step, it does not fail the run.
    await this.#runSandboxStep(context);

    // 4. The coupled model step: TimesFM-3 output meets the parsed constraints.
    const plan = fixturePlan(Date.now());
    emit({
      type: "widget",
      widget: {
        kind: "forecast",
        protocol: "morpho",
        metric: "tvl",
        horizonDays: request.horizonDays,
        point: [1.02, 1.05, 1.08, 1.1, 1.09, 1.11, 1.14],
        q10: [0.98, 0.99, 1.0, 1.01, 0.99, 1.0, 1.02],
        q90: [1.06, 1.1, 1.14, 1.18, 1.19, 1.22, 1.26],
        model: "timesfm-3.0",
        provenance: "timesfm3-inference (fixture in dry mode)",
      },
    });
    emit({
      type: "widget",
      widget: {
        kind: "yields",
        pools: [
          { poolId: "morpho-usdc-base", protocol: "morpho", apy: 4.31, tvlUsd: 812_400_000 },
          { poolId: "uniswap-v4-usdc-eth-base", protocol: "uniswap-v4", apy: 3.28, tvlUsd: 455_100_000 },
        ],
      },
    });
    emit({
      type: "step.completed",
      step: buildAgentStep({
        id: "trace-risk-engine",
        agent: "Risk Engine",
        call: "risk-engine.decompose",
        argsSummary: "factor-OLS+MC-10k → α,β,γ,VaR,HHI",
        state: "done",
        reasoning: ["Decomposed factor exposure", "Ran 10,000 student-t paths"],
        evidence: [
          { label: "model", value: "factor-OLS + MC-10k" },
          { label: "inputs", value: "4 payloads · checksums OK" },
        ],
        result: {
          summary: "verdict: acceptable",
          metrics: [
            { label: "β", value: "0.32 hedged", tone: "up" },
            { label: "HHI", value: "0.18" },
            { label: "VaR95", value: "2.4%" },
          ],
          checks: [
            { label: "β floor ≥ 0.60", pass: false, detail: "0.32 hedged" },
            { label: "HHI ≤ 0.25", pass: true, detail: "0.18" },
            { label: "per-tx caps", pass: true, detail: "PolicyGate" },
          ],
        },
        provenance: { source: "risk-engine" },
      }),
    });

    // 5. The readjustment engine emits a plan, then the signing intent.
    emit({ type: "widget", widget: { kind: "intent", plan } });
    emit({ type: "widget", widget: { kind: "execution", planId: plan.id, steps: plan.steps } });

    const intent = await proposeIntent(context, plan);
    emit({
      type: "step.completed",
      step: buildAgentStep({
        id: "trace-readjustment",
        agent: "Readjustment Engine",
        call: "intent.build",
        argsSummary: `legs=${plan.legs.length} · notional=$${plan.totals.notionalUsd} · custody=${context.custody.mode}`,
        state: "done",
        reasoning: ["Intersected rules with projections", "Built the Safe batch intent"],
        evidence: [
          { label: "intentId", value: intent.intentId },
          { label: "digest", value: intent.digest.slice(0, 18) + "…" },
          { label: "safeTxHash", value: safeTxHashOf(intent) ?? "(no chain)" },
        ],
        result: { summary: "1 signable intent awaiting approval" },
        provenance: { source: "custody.intent-builder" },
      }),
    });
    emit({ type: "widget", widget: { kind: "approvals", intents: [intent] } });
    emit({ type: "approval.requested", intent });

    return { summary: "Plan ranked; 1 intent awaiting device approval.", state: "awaiting_user" };
  }

  async #runSandboxStep(context: AgentRunContext): Promise<void> {
    const stepId = "trace-sandbox";
    const started = Date.now();
    let handle: Awaited<ReturnType<typeof context.sandbox.create>> | null = null;
    try {
      handle = await context.sandbox.create({
        template: "python-3.12",
        ttlMs: 60_000,
        egressAllowlist: [],
      });
      context.emit({
        type: "step.start",
        step: buildAgentStep({
          id: stepId,
          agent: "Sandbox",
          call: `sandbox.create(${context.sandbox.name})`,
          state: "running",
          reasoning: ["Untrusted work is confined to the sandbox"],
        }),
      });
      await context.sandbox.write(handle, "series.csv", "ts,apy\n0,4.11\n1,4.19\n2,4.31\n");
      const result = await context.sandbox.exec(handle, "wc -l < series.csv", {
        timeoutMs: 5_000,
      });
      context.emit({
        type: "step.completed",
        step: buildAgentStep({
          id: stepId,
          agent: "Sandbox",
          call: "sandbox.exec(wc -l series.csv)",
          argsSummary: `exit=${result.exitCode}`,
          state: result.exitCode === 0 ? "done" : "failed",
          durationMs: Date.now() - started,
          reasoning: ["Wrote the series to the sandbox filesystem", "Counted rows in-sandbox"],
          evidence: [
            { label: "sandbox", value: handle.id },
            { label: "stdout", value: result.stdout.trim() || "(empty)" },
          ],
          result: { summary: `sandbox exec exit ${result.exitCode}` },
          provenance: { source: context.sandbox.name },
        }),
      });
    } catch (error) {
      context.emit({
        type: "step.completed",
        step: buildAgentStep({
          id: stepId,
          agent: "Sandbox",
          call: "sandbox.exec",
          state: "failed",
          durationMs: Date.now() - started,
          reasoning: [],
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    } finally {
      if (handle !== null) {
        await context.sandbox.destroy(handle).catch(() => undefined);
      }
    }
  }
}

function splitChunks(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}
