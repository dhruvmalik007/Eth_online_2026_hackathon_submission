/**
 * buildStrategyPipeline — compiles the deterministic execution StateGraph.
 *
 * Topology:
 *   START → parseMandate → fetchMarketData → computeStrategy → riskGate
 *      riskGate.fail → renderReport → END        (abort: mandate infeasible)
 *      riskGate.pass → buildExecutionPlan → executeLegs → verifyResults → renderReport → END
 *
 * The risk gate is the only conditional edge. Every node is deterministic TS; the
 * money path never touches an LLM. `executeLegs` is injected (dual-mode arc/1inch/v4)
 * so the graph stays protocol-agnostic and unit-testable with stub executors.
 */
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import type { StrategyState } from "./state.js";
import { parseMandate } from "./nodes/parseMandate.js";
import { fetchMarketSnapshot } from "./marketData.js";
import { computeStrategyFromSnapshot } from "./strategy.js";
import { evaluateRiskGate } from "./nodes/riskGate.js";
import { verifyResults, summarizeChecks } from "./nodes/verifyResults.js";
import { renderReport } from "./nodes/renderReport.js";

const StrategyAnnotation = Annotation.Root({
  mandate: Annotation<string>,
  mode: Annotation<"dry" | "live">,
  intent: Annotation<StrategyState["intent"] | undefined>,
  market: Annotation<StrategyState["market"] | undefined>,
  strategy: Annotation<StrategyState["strategy"] | undefined>,
  gate: Annotation<StrategyState["gate"] | undefined>,
  plan: Annotation<StrategyState["plan"]>,
  results: Annotation<StrategyState["results"]>,
  verification: Annotation<StrategyState["verification"]>,
  report: Annotation<string | undefined>,
  errors: Annotation<string[]>,
});

export type StrategyAnnotationType = typeof StrategyAnnotation;
// (kept for forward-compat; the graph builder uses StrategyAnnotation directly)

export interface ExecuteLegs {
  (state: StrategyState): Promise<StrategyState>;
}

export interface BuildStrategyPipelineOptions {
  executeLegs: ExecuteLegs;
}

/** Widen annotation state (optional props as `T | undefined`) into a StrategyState draft. */
function toStrategyState(state: StrategyAnnotationType["State"]): StrategyState {
  return {
    mandate: state.mandate,
    mode: state.mode,
    ...(state.intent !== undefined ? { intent: state.intent } : {}),
    ...(state.market !== undefined ? { market: state.market } : {}),
    ...(state.strategy !== undefined ? { strategy: state.strategy } : {}),
    ...(state.gate !== undefined ? { gate: state.gate } : {}),
    plan: state.plan,
    results: state.results,
    verification: state.verification,
    ...(state.report !== undefined ? { report: state.report } : {}),
    errors: state.errors,
  };
}

export function buildStrategyPipeline(opts: BuildStrategyPipelineOptions) {
  const graph = new StateGraph(StrategyAnnotation);

  // Capture the builder from the addNode chain: each addNode<K> widens the node-name
  // generic N, and addEdge's signature is (start: N | START, end: N | END) — so added
  // nodes must be captured or the compiler only knows the annotation keys as names.
  const builder = graph
    // ── parseMandate ────────────────────────────────────────────────────────
    .addNode("parseMandate", (state) => {
      try {
        const intent = parseMandate(state.mandate);
        return { intent, errors: state.errors };
      } catch (e) {
        return { errors: [...state.errors, `parseMandate: ${(e as Error).message}`] };
      }
    })
    // ── fetchMarketData ─────────────────────────────────────────────────────
    .addNode("fetchMarketData", async (state) => {
      try {
        if (!state.intent) throw new Error("intent missing after parseMandate");
        const market = await fetchMarketSnapshot({
          maxCandidates: state.intent.maxCandidates,
          leverageStable: state.intent.leverageStable,
          leverageVolatile: state.intent.leverageVolatile,
          idleFractionHooked: state.intent.idleFractionHooked,
          minVolumeUsd: state.intent.minVolumeUsd,
          feeSlopeMode: state.intent.feeSlopeMode,
        });
        return { market, errors: state.errors };
      } catch (e) {
        return { errors: [...state.errors, `fetchMarketData: ${(e as Error).message}`] };
      }
    })
    // ── computeStrategy ─────────────────────────────────────────────────────
    .addNode("computeStrategy", (state) => {
      try {
        if (!state.market || !state.intent) throw new Error("market/intent missing");
        const strategy = computeStrategyFromSnapshot(state.market, {
          minAprPercent: state.intent.minAprPercent,
          vegaBudget: state.intent.vegaBudget,
          sizeUsd: state.intent.sizeUsd,
          minVolumeUsd: state.intent.minVolumeUsd,
        });
        return { strategy, errors: state.errors };
      } catch (e) {
        return { errors: [...state.errors, `computeStrategy: ${(e as Error).message}`] };
      }
    })
    // ── riskGate ────────────────────────────────────────────────────────────
    .addNode("riskGate", (state) => {
      try {
        if (!state.strategy || !state.market || !state.intent) throw new Error("strategy/market/intent missing");
        const gate = evaluateRiskGate({
          strategy: state.strategy,
          legs: state.market.legs,
          minAprPercent: state.intent.minAprPercent,
          vegaBudget: state.intent.vegaBudget,
        });
        return { gate, errors: state.errors };
      } catch (e) {
        return { errors: [...state.errors, `riskGate: ${(e as Error).message}`] };
      }
    })
    // ── buildExecutionPlan ──────────────────────────────────────────────────
    .addNode("buildExecutionPlan", (state) => {
      try {
        if (!state.strategy || !state.intent) throw new Error("strategy/intent missing");
        const plan = buildPlan(state.strategy, state.intent);
        return { plan, errors: state.errors };
      } catch (e) {
        return { errors: [...state.errors, `buildExecutionPlan: ${(e as Error).message}`] };
      }
    })
    // ── executeLegs (injected, dual-mode) ───────────────────────────────────
    .addNode("executeLegs", async (state) => {
      try {
        const draft = toStrategyState(state);
        const next = await opts.executeLegs(draft);
        return { results: next.results, errors: next.errors };
      } catch (e) {
        return { errors: [...state.errors, `executeLegs: ${(e as Error).message}`] };
      }
    })
    // ── verifyResults ───────────────────────────────────────────────────────
    .addNode("verifyResults", (state) => {
      try {
        const draft = toStrategyState(state);
        const checks = verifyResults(draft);
        return { verification: { checks, passed: summarizeChecks(checks) }, errors: state.errors };
      } catch (e) {
        return { errors: [...state.errors, `verifyResults: ${(e as Error).message}`] };
      }
    })
    // ── renderReport ────────────────────────────────────────────────────────
    .addNode("renderReport", (state) => {
      const draft = toStrategyState(state);
      const report = renderReport(draft);
      return { report, errors: state.errors };
    });

  // ── edges ───────────────────────────────────────────────────────────────
  builder.addEdge(START, "parseMandate");
  builder.addEdge("parseMandate", "fetchMarketData");
  builder.addEdge("fetchMarketData", "computeStrategy");
  builder.addEdge("computeStrategy", "riskGate");
  builder.addConditionalEdges("riskGate", (state) =>
    state.gate?.passed ? "buildExecutionPlan" : "renderReport",
  );
  builder.addEdge("buildExecutionPlan", "executeLegs");
  builder.addEdge("executeLegs", "verifyResults");
  builder.addEdge("verifyResults", "renderReport");
  builder.addEdge("renderReport", END);

  return graph.compile();
}

import type { MandateIntent, ExecutionLeg } from "./state.js";
import type { StrategyResult } from "../tools/fixedIncomeMath.js";

function buildPlan(strategy: StrategyResult, intent: MandateIntent): ExecutionLeg[] {
  const legs: ExecutionLeg[] = [];
  let seq = 1;

  for (const leg of strategy.legs) {
    const notional = leg.notionalUsd;

    // v4 LP position leg (always present for every allocated book)
    legs.push({
      seq: seq++,
      kind: "v4-mint",
      label: `Mint ${leg.pair} LP`,
      chain: "ethereum",
      poolId: leg.poolId,
      pair: leg.pair,
      notionalUsd: notional,
    });

    // swap leg: volatile books need USDC→volatile (here represented as a spoke swap)
    const isStable = leg.pair.startsWith("USDC") || leg.pair.startsWith("USDT") || leg.pair.startsWith("DAI");
    if (!isStable && intent.chains[0]) {
      legs.push({
        seq: seq++,
        kind: "oneinch-swap",
        label: `Swap USDC→${leg.pair.split("/")[1] ?? "ETH"}`,
        chain: intent.chains[0],
        fromToken: "USDC",
        toToken: leg.pair.split("/")[1] ?? "WETH",
        swapAmountUsdc: notional,
      });
    }

    // bridge leg: hooked/idle fraction sweeps to Arc
    if (leg.hook) {
      const idleUsd = notional * 0.3; // idleFractionHooked default
      legs.push({
        seq: seq++,
        kind: "arc-bridge",
        label: `Bridge idle ${leg.pair} → Arc`,
        chain: intent.chains[0] ?? "ethereum",
        fromChain: intent.chains[0] ?? "ethereum",
        toChain: "arc",
        bridgeAmountUsdc: idleUsd,
      });
    }
  }

  return legs;
}
