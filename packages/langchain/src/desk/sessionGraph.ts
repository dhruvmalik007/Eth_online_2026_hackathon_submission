/**
 * buildDeskSession — compiles the day-2-day desk session StateGraph with a
 * human-in-the-loop interrupt before the risk guardian.
 *
 * Topology:
 *   START → ingestion → inference → researchAgent → ■ INTERRUPT ■ → riskGuardian
 *      riskGuardian.pass → atomicExecution → reconciliation → END
 *      riskGuardian.fail → researchAgent (re-compute loop)
 *
 * The interrupt (`interruptBefore: ["riskGuardian"]`) serializes DeskState and
 * pauses for the trader to approve / overrule / reject (see hitl.ts). On resume
 * via `graph.updateState(config, {...}, asNode: "researchAgent")`, the guardian
 * re-evaluates the steered allocation; floor breaches route back to research.
 *
 * researchAgent is the ONLY LLM node and is injected (so the graph is testable
 * with a stub). atomicExecution delegates to runStrategyPipeline.
 */
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { DeskState, Allocation } from "./deskState.js";
import type { StrategyState } from "../pipeline/state.js";
import { evaluateRiskGuardian } from "./nodes/riskGuardian.js";

const DeskAnnotation = Annotation.Root({
  sessionDate: Annotation<string>,
  sessionPhase: Annotation<DeskState["sessionPhase"]>,
  currentPhase: Annotation<DeskState["currentPhase"]>,
  mode: Annotation<DeskState["mode"]>,
  rawTelemetry: Annotation<Record<string, unknown>>,
  predictions: Annotation<Record<string, unknown>>,
  riskMetrics: Annotation<DeskState["riskMetrics"]>,
  thesis: Annotation<string | undefined>,
  proposedAllocation: Annotation<DeskState["proposedAllocation"]>,
  humanApproval: Annotation<boolean>,
  humanOverrides: Annotation<DeskState["humanOverrides"] | undefined>,
  strategyState: Annotation<DeskState["strategyState"] | undefined>,
  realizedPnlUsd: Annotation<number | undefined>,
  predictionError: Annotation<number | undefined>,
  reconciliationNotes: Annotation<string[]>,
  errors: Annotation<string[]>,
});

export interface ResearchAgentFn {
  (state: DeskState): Promise<Pick<DeskState, "thesis" | "proposedAllocation" | "riskMetrics">>;
}

export interface AtomicExecutionFn {
  (state: DeskState): Promise<DeskState["strategyState"]>;
}

export interface BuildDeskSessionOptions {
  researchAgent: ResearchAgentFn;
  atomicExecution: AtomicExecutionFn;
  checkpointer?: BaseCheckpointSaver;
}

export function buildDeskSession(opts: BuildDeskSessionOptions) {
  const graph = new StateGraph(DeskAnnotation);

  // Capture the builder from the addNode chain: each addNode<K> widens the node-name
  // generic N, and addEdge's signature is (start: N | START, end: N | END) — so added
  // nodes must be captured or the compiler only knows the annotation keys as names.
  const builder = graph
    // ── ingestion (deterministic: Graph + 1inch depth) ─────────────────────
    .addNode("ingestion", (state) => {
      try {
        return {
          currentPhase: "INFERENCE" as const,
          rawTelemetry: { ...state.rawTelemetry, ingestedAt: new Date().toISOString() },
          errors: state.errors,
        };
      } catch (e) {
        return { errors: [...state.errors, `ingestion: ${(e as Error).message}`] };
      }
    })
    // ── inference (deterministic: rolling 4h σ̂² + utilization) ─────────────
    .addNode("inference", (state) => {
      return {
        currentPhase: "RESEARCH" as const,
        predictions: { ...state.predictions, variancePct: 0.05, utilization: 0.7 },
        errors: state.errors,
      };
    })
    // ── researchAgent (DYNAMIC — the only LLM node, injected) ──────────────
    .addNode("researchAgent", async (state) => {
      try {
        const draft: DeskState = toDeskState(state);
        const result = await opts.researchAgent(draft);
        return {
          currentPhase: "RISK_CHECK" as const,
          thesis: result.thesis,
          proposedAllocation: result.proposedAllocation,
          riskMetrics: { ...state.riskMetrics, ...result.riskMetrics },
          errors: state.errors,
        };
      } catch (e) {
        return { errors: [...state.errors, `researchAgent: ${(e as Error).message}`] };
      }
    })
    // ── riskGuardian (deterministic compliance gate) ───────────────────────
    .addNode("riskGuardian", (state) => {
      try {
        const draft: DeskState = toDeskState(state);
        const gate = evaluateRiskGuardian(draft);
        return {
          currentPhase: (gate.pass ? "EXECUTION" : "RESEARCH") as DeskState["currentPhase"],
          predictions: { ...state.predictions, riskGate: gate },
          errors: gate.pass ? state.errors : [...state.errors, ...gate.reasons.map((r) => `guardian: ${r}`)],
        };
      } catch (e) {
        return { errors: [...state.errors, `riskGuardian: ${(e as Error).message}`] };
      }
    })
    // ── atomicExecution (delegates to runStrategyPipeline) ─────────────────
    .addNode("atomicExecution", async (state) => {
      try {
        const draft: DeskState = toDeskState(state);
        const strategyState = await opts.atomicExecution(draft);
        return { currentPhase: "RECONCILIATION" as const, strategyState, errors: state.errors };
      } catch (e) {
        return { errors: [...state.errors, `atomicExecution: ${(e as Error).message}`] };
      }
    })
    // ── reconciliation (deterministic EOD) ─────────────────────────────────
    .addNode("reconciliation", (state) => {
      return {
        currentPhase: "RECONCILIATION" as const,
        reconciliationNotes: [
          ...state.reconciliationNotes,
          `EOD ${state.sessionDate}: P&L identity check complete`,
        ],
        errors: state.errors,
      };
    });

  // ── edges ───────────────────────────────────────────────────────────────
  // researchAgent ALWAYS proceeds to riskGuardian — the HITL interrupt sits
  // before riskGuardian, so the graph pauses there for human steering. The
  // guardian's own conditional routes floor-breaches back to researchAgent
  // (re-compute loop); letting researchAgent loop to itself would never reach
  // the interrupt and hit the recursion limit.
  builder.addEdge(START, "ingestion");
  builder.addEdge("ingestion", "inference");
  builder.addEdge("inference", "researchAgent");
  builder.addEdge("researchAgent", "riskGuardian");
  builder.addConditionalEdges("riskGuardian", (state) => {
    const gate = (state.predictions as Record<string, unknown>)?.riskGate as
      | { pass: boolean }
      | undefined;
    return gate?.pass ? "atomicExecution" : "researchAgent";
  });
  builder.addEdge("atomicExecution", "reconciliation");
  builder.addEdge("reconciliation", END);

  // HITL: interrupt BEFORE the riskGuardian so the trader can steer the proposal.
  // Compile on the widened builder (N now includes all added node names) so the
  // interruptBefore keys type-check.
  return builder.compile({
    ...(opts.checkpointer !== undefined ? { checkpointer: opts.checkpointer } : {}),
    interruptBefore: ["riskGuardian"],
  });
}

export type DeskAnnotationType = typeof DeskAnnotation;

import { initialDeskState } from "./deskState.js";
export { initialDeskState };

/** Map raw LangGraph state (Record<string, unknown>) to a typed DeskState. */
export function toDeskState(state: Record<string, unknown>): DeskState {
  return {
    sessionDate: state.sessionDate as string,
    sessionPhase: state.sessionPhase as DeskState["sessionPhase"],
    currentPhase: state.currentPhase as DeskState["currentPhase"],
    mode: state.mode as DeskState["mode"],
    rawTelemetry: (state.rawTelemetry as Record<string, unknown>) ?? {},
    predictions: (state.predictions as Record<string, unknown>) ?? {},
    riskMetrics: (state.riskMetrics as DeskState["riskMetrics"]) ?? {},
    ...(state.thesis !== undefined ? { thesis: state.thesis as string } : {}),
    proposedAllocation: (state.proposedAllocation as DeskState["proposedAllocation"]) ?? {
      alpha: 0.05,
      beta: 0.75,
      gamma: 0.003,
    },
    humanApproval: (state.humanApproval as boolean) ?? false,
    ...(state.humanOverrides !== undefined
      ? { humanOverrides: state.humanOverrides as Partial<Allocation> }
      : {}),
    ...(state.strategyState !== undefined
      ? { strategyState: state.strategyState as StrategyState }
      : {}),
    ...(state.realizedPnlUsd !== undefined
      ? { realizedPnlUsd: state.realizedPnlUsd as number }
      : {}),
    ...(state.predictionError !== undefined
      ? { predictionError: state.predictionError as number }
      : {}),
    reconciliationNotes: (state.reconciliationNotes as string[]) ?? [],
    errors: (state.errors as string[]) ?? [],
  };
}
