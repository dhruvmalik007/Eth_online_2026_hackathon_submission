/**
 * `@ethonline2026/execution-domain` — the execution contract.
 *
 * Three concerns, deliberately separated:
 *
 * - **state** — the step-state vocabulary and the run lifecycle machine. Pure,
 *   no I/O, and the single place a transition is judged legal.
 * - **lineage** — session → strategy → run → intent → step, with branded ids so
 *   an id cannot be passed where a different one is expected.
 * - **execution** — the plan/quote/step/fee contract the dashboard renders and
 *   the service produces.
 *
 * Nothing here performs I/O or imports a framework: the service and the SPA both
 * depend on it, so it must stay usable from either side.
 */

export * from "./state.js";
export * from "./lineage.js";
export * from "./execution.js";
