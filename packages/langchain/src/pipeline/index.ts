/**
 * runStrategyPipeline — assembles the deterministic execution graph with the
 * dual-mode executor and runs a mandate end-to-end.
 *
 * Usage:
 *   const { state, report } = await runStrategyPipeline("$25M USDC, APR ≥ 6%", { mode: "dry" });
 *   console.log(report);
 *
 * The graph: parse → fetch → compute → gate → [plan → execute → verify] → render.
 * In dry mode every execution leg emits calldata (the demo artifact); in live mode
 * the same legs submit via arc-client / 1inch / v4.
 */
import { buildStrategyPipeline } from "./graph.js";
import { executeLegs } from "./executeLegs.js";
import { initialStrategyState } from "./state.js";
import type { StrategyState } from "./state.js";

export interface RunStrategyOptions {
  mode?: "dry" | "live";
}

export interface RunStrategyResult {
  state: StrategyState;
  report: string;
}

export async function runStrategyPipeline(
  mandate: string,
  opts: RunStrategyOptions = {},
): Promise<RunStrategyResult> {
  const mode = opts.mode ?? (process.env.EXECUTION_MODE as "dry" | "live") ?? "dry";
  const graph = buildStrategyPipeline({ executeLegs });
  const initial = initialStrategyState(mandate, mode);
  const finalState = (await graph.invoke(initial)) as StrategyState;
  return { state: finalState, report: finalState.report ?? renderFallback(finalState) };
}

function renderFallback(state: StrategyState): string {
  // Should never fire (renderReport is a graph node), but guarantees a string.
  if (state.report) return state.report;
  return `# Strategy Report (incomplete)\n\n_Mode: ${state.mode}_\n\n_Errors: ${state.errors.join("; ") || "none"}_`;
}

export { buildStrategyPipeline } from "./graph.js";
export { executeLegs } from "./executeLegs.js";
export type { StrategyState, ExecutionLeg, LegResult, MandateIntent, ExecutionMode } from "./state.js";
