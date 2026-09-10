/**
 * DeskState — channels for the day-2-day desk session graph.
 *
 * Implements the founder's trading-desk architecture (plan §9): a session-level
 * LangGraph that wraps the single-mandate strategy pipeline as its atomic execution
 * core. Routing is deterministic; only the research node uses an LLM.
 *
 * Topology (see sessionGraph.ts):
 *   START → ingestion → inference → researchAgent → [INTERRUPT: human steering]
 *      resume → riskGuardian
 *        pass → atomicExecution → reconciliation → END
 *        fail ("breaches hardcoded floors") → researchAgent (re-compute loop)
 */
import type { StrategyState } from "../pipeline/state.js";

export type DeskPhase =
  | "INGESTION"
  | "INFERENCE"
  | "RESEARCH"
  | "RISK_CHECK"
  | "EXECUTION"
  | "RECONCILIATION";

export type SessionPhase = "MON_MACRO" | "ALPHA_CAPTURE" | "FRI_DEFENSIVE";

export interface Allocation {
  alpha: number; // LST / long-duration leg weight
  beta: number; // money-market sweep weight
  gamma: number; // pool fee (dynamic)
}

export interface RiskMetrics {
  var95?: number;
  var99?: number;
  expectedShortfall?: number;
  hhi?: number; // Herfindahl-Hirschman concentration
  lvr?: number;
}

export interface DeskState {
  sessionDate: string; // ISO date; drives session phase (Mon/Fri posture)
  sessionPhase: SessionPhase;
  currentPhase: DeskPhase;
  mode: "dry" | "live";

  // 07:30 ingestion
  rawTelemetry: Record<string, unknown>;
  // 07:30 inference (rolling 4h σ̂² + utilization)
  predictions: Record<string, unknown>;

  riskMetrics: RiskMetrics;
  // 08:30 desk meeting proposal (written by the research agent)
  thesis?: string;
  proposedAllocation: Allocation;

  // [INTERRUPT] human steering
  humanApproval: boolean;
  humanOverrides?: Partial<Allocation>;

  // atomic execution result (delegates to runStrategyPipeline)
  strategyState?: StrategyState;

  // 16:30 reconciliation
  realizedPnlUsd?: number;
  predictionError?: number;
  reconciliationNotes: string[];

  errors: string[];
}

export const initialDeskState = (sessionDate: string, mode: "dry" | "live"): DeskState => {
  const date = sessionDate || new Date().toISOString().slice(0, 10);
  const dow = new Date(date).getDay(); // 0=Sun..6=Sat
  const sessionPhase: SessionPhase = dow === 1 ? "MON_MACRO" : dow === 5 ? "FRI_DEFENSIVE" : "ALPHA_CAPTURE";
  return {
    sessionDate: date,
    sessionPhase,
    currentPhase: "INGESTION",
    mode,
    rawTelemetry: {},
    predictions: {},
    riskMetrics: {},
    proposedAllocation: { alpha: 0.05, beta: 0.75, gamma: 0.003 }, // defensive β default (plan §9.3)
    humanApproval: false,
    reconciliationNotes: [],
    errors: [],
  };
};

/** Session-phase constraint modulation (plan §9.3). */
export function phaseConstraints(phase: SessionPhase): {
  betaFloor: number;
  gammaFeeBumpBps: number;
  varLimitPct: number;
} {
  switch (phase) {
    case "MON_MACRO":
      return { betaFloor: 0.6, gammaFeeBumpBps: 0, varLimitPct: 5 };
    case "FRI_DEFENSIVE":
      return { betaFloor: 0.8, gammaFeeBumpBps: 15, varLimitPct: 2 }; // defensive sweep + LVR fee bump
    case "ALPHA_CAPTURE":
    default:
      return { betaFloor: 0.5, gammaFeeBumpBps: 0, varLimitPct: 4 };
  }
}
