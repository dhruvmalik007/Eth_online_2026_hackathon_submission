/**
 * hitl — Human-in-the-Loop helpers for the desk session.
 *
 * The graph pauses at `interruptBefore: ["riskGuardian"]`. While paused:
 *   - `readProposal` renders the proposal block the trader sees (plan §10).
 *   - `resume` applies the trader's decision (approve / overrule / reject) and
 *     continues the graph via `graph.updateState(config, ...)`.
 *
 * The risk guardian's floor check is pure code: an overrule that breaches the floor
 * is rejected deterministically and routed back to research.
 */
import type { RunnableConfig } from "@langchain/core/runnables";
import type { DeskState } from "./deskState.js";
import { applyOverride } from "./nodes/riskGuardian.js";

export type TraderDecision = "approve" | "overrule" | "reject";

export interface ProposalView {
  sessionDate: string;
  sessionPhase: DeskState["sessionPhase"];
  thesis: string;
  proposedAllocation: DeskState["proposedAllocation"];
  riskMetrics: DeskState["riskMetrics"];
}

export function readProposal(state: DeskState): string {
  const a = state.proposedAllocation;
  const r = state.riskMetrics;
  return [
    "",
    "[ EMS CURRENT PORTFOLIO STATE: PAUSED FOR COMPLIANCE REVIEW ]",
    "-------------------------------------------------------------",
    `Session: ${state.sessionDate} (${state.sessionPhase})`,
    `Thesis: ${state.thesis ?? "(none)"}`,
    "",
    `Proposed Allocation:`,
    `  α (LST / long-duration):  ${(a.alpha * 100).toFixed(1)}%`,
    `  β (money-market sweep):  ${(a.beta * 100).toFixed(1)}%`,
    `  γ (dynamic pool fee):    ${(a.gamma * 100).toFixed(2)}%`,
    "",
    `Risk:`,
    `  VaR95: ${r.var95?.toFixed(2) ?? "n/a"}%   VaR99: ${r.var99?.toFixed(2) ?? "n/a"}%`,
    `  LVR:   ${r.lvr?.toFixed(2) ?? "n/a"} bps   HHI: ${r.hhi?.toFixed(2) ?? "n/a"}`,
    "",
    "[ ACTION REQUIRED ]",
    "  1. Approve proposal as-is",
    "  2. Overrule target allocation (α/β/γ)",
    "  3. Reject & force re-computation",
    "",
  ].join("\n");
}

export interface ResumeParams {
  graph: { updateState: (config: RunnableConfig, values: Partial<DeskState>, asNode: string) => Promise<unknown> };
  config: RunnableConfig;
  decision: TraderDecision;
  overrides?: Partial<DeskState["proposedAllocation"]>;
}

/**
 * Apply the trader's decision and resume the graph.
 *  - approve  → humanApproval = true; guardian evaluates as-is.
 *  - overrule → apply override (clamped to floors); humanApproval = true.
 *  - reject   → humanApproval = false; routes back to research for re-computation.
 */
export async function resume(params: ResumeParams): Promise<void> {
  const { graph, config, decision } = params;

  if (decision === "reject") {
    await graph.updateState(config, { humanApproval: false }, "researchAgent");
    return;
  }

  // approve or overrule: mark approval; overrides (if any) are applied by the
  // researchAgent node on the next pass via applyOverride in the steering shim.
  await graph.updateState(
    config,
    decision === "overrule" && params.overrides !== undefined
      ? { humanApproval: true, humanOverrides: params.overrides }
      : { humanApproval: true },
    "researchAgent",
  );
}

/** Apply a trader override with floor clamping (used by the researchAgent shim). */
export function clampOverride(
  base: DeskState["proposedAllocation"],
  overrides: Partial<DeskState["proposedAllocation"]> | undefined,
  phase: DeskState["sessionPhase"],
): { allocation: DeskState["proposedAllocation"]; rejected: string[] } {
  if (!overrides) return { allocation: base, rejected: [] };
  return applyOverride(base, overrides, phase);
}
