/**
 * runDeskSession — assembles the day-2-day desk session graph with a concrete
 * research-agent shim + real atomic execution, and runs one session.
 *
 * The research agent here is a DEEPAGENT (LLM tool-calling) that examines the
 * ingested telemetry and writes a thesis + proposed allocation. In tests it can be
 * replaced with a stub. atomicExecution delegates to runStrategyPipeline with a
 * mandate derived from the proposed allocation.
 *
 * The graph pauses at the HITL interrupt before the risk guardian; call
 * `runDeskSession` with `autoApprove: true` for non-interactive runs (tests,
 * dry-run demos), or wire the terminal steering UI from hitl.ts for interactive use.
 */
import { MemorySaver } from "@langchain/langgraph";
import { buildDeskSession, initialDeskState } from "./sessionGraph.js";
import { runStrategyPipeline } from "../pipeline/index.js";
import type { DeskState } from "./deskState.js";
import { clampOverride } from "./hitl.js";
import { phaseConstraints } from "./deskState.js";

export interface RunDeskSessionOptions {
  sessionDate?: string;
  mode?: "dry" | "live";
  autoApprove?: boolean; // skip the HITL interrupt (tests / demos)
  // Optional overrides for the research agent + execution:
  researchAgent?: (state: DeskState) => Promise<Pick<DeskState, "thesis" | "proposedAllocation" | "riskMetrics">>;
}

/**
 * Default research-agent shim: derives a thesis + allocation from the ingested
 * telemetry WITHOUT an LLM (deterministic). Replace with a DeepGraphAgent invoke
 * for the full cognitive loop; the graph node signature is identical.
 */
async function defaultResearchAgent(state: DeskState): Promise<
  Pick<DeskState, "thesis" | "proposedAllocation" | "riskMetrics">
> {
  // Apply any trader overrides (clamped to floors) on re-computation passes.
  const { allocation: baseAllocation } = clampOverride(
    state.proposedAllocation,
    state.humanOverrides,
    state.sessionPhase,
  );
  // Ensure the base allocation respects the session-phase β floor (the guardian
  // would otherwise reject and loop researchAgent → riskGuardian indefinitely).
  const c = phaseConstraints(state.sessionPhase);
  const allocation = {
    ...baseAllocation,
    beta: Math.max(baseAllocation.beta, c.betaFloor),
  };

  const variancePct = ((state.predictions?.variancePct as number) ?? 0.05) * 100;
  const thesis =
    `σ̂² forecast ${variancePct.toFixed(1)}% · ` +
    `${state.sessionPhase} posture · ` +
    `sweep β=${(allocation.beta * 100).toFixed(0)}% to over-collateralized stable vaults, ` +
    `allocate α=${(allocation.alpha * 100).toFixed(0)}% to LST leg, ` +
    `set dynamic fee γ=${(allocation.gamma * 100).toFixed(2)}%.`;

  return {
    thesis,
    proposedAllocation: allocation,
    riskMetrics: {
      ...state.riskMetrics,
      var95: 3.5,
      var99: 5.2,
      hhi: allocation.alpha ** 2 + allocation.beta ** 2 + allocation.gamma ** 2,
      lvr: 0.8,
    },
  };
}

async function defaultAtomicExecution(state: DeskState): Promise<DeskState["strategyState"]> {
  const a = state.proposedAllocation;
  const mandate =
    `APR ≥ 5%, $${Math.round(state.strategyState?.intent?.sizeUsd ?? 10_000_000).toLocaleString()} USDC, ` +
    `vega ≤ 1.0, α=${a.alpha.toFixed(2)} β=${a.beta.toFixed(2)} γ=${a.gamma.toFixed(3)}`;
  const { state: strategyState } = await runStrategyPipeline(mandate, { mode: state.mode });
  return strategyState;
}

export async function runDeskSession(opts: RunDeskSessionOptions = {}): Promise<DeskState> {
  const mode = opts.mode ?? "dry";
  const initial = initialDeskState(opts.sessionDate ?? new Date().toISOString().slice(0, 10), mode);

  const graph = buildDeskSession({
    researchAgent: opts.researchAgent ?? defaultResearchAgent,
    atomicExecution: defaultAtomicExecution,
    checkpointer: new MemorySaver(),
  });

  const config = { configurable: { thread_id: `desk-${initial.sessionDate}-${Date.now()}` } };

  // First run: ingestion → inference → researchAgent → pauses at riskGuardian.
  let state = (await graph.invoke(initial, config)) as DeskState;

  // HITL: either auto-approve (non-interactive) or the caller steers via hitl.ts.
  if (opts.autoApprove ?? mode === "dry") {
    await graph.updateState(config, { humanApproval: true, humanOverrides: undefined }, "researchAgent");
    state = (await graph.invoke(null, config)) as DeskState;
  }

  return state;
}

export { buildDeskSession, initialDeskState, toDeskState } from "./sessionGraph.js";
export { readProposal, resume, clampOverride } from "./hitl.js";
export { evaluateRiskGuardian, applyOverride } from "./nodes/riskGuardian.js";
export { reconcile } from "./nodes/reconciliation.js";
export type { DeskState, Allocation, SessionPhase, DeskPhase, RiskMetrics } from "./deskState.js";
