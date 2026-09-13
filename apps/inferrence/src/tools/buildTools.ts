/**
 * Constructs the tool groups declared in `ToolRegistry`.
 *
 * The registry says *which* groups exist and where each runs; this is the adapter that actually
 * builds them (ROADMAP T6.1). They are separate on purpose — the registry is policy and has to stay
 * readable without knowing a single constructor signature, and this file knows every constructor and
 * nothing about placement policy.
 *
 * The load-bearing rule: **a group whose dependencies are absent is not registered.**
 *
 * A tool that exists and fails on every call is worse than a tool that is not there. The model calls
 * it, receives an error string, and reasons around the gap — and the trace shows a *tool call* rather
 * than a missing capability. An omitted group is a fact the operator can act on; a broken tool is a
 * fact only the model sees, and it will not report it faithfully.
 *
 * Omissions are returned rather than logged and dropped, so `/health` and the first event of every run
 * can name them. That is what makes "why can the agent not see pool data?" answerable from outside.
 */
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { RiskProfileReader } from "@ethonline2026/risk-analysis-data-pipeline";
import {
  createAcpTools,
  createAquaTools,
  createArcSettlementTools,
  createDexTools,
  createFixedIncomeTools,
  createLendingTools,
  createMathTools,
  createPredictionTools,
  createRiskTools,
  createTimeseriesTools,
  createTimesFM3Tools,
  createUniswapV4Tools,
  type TimesFM3ToolDeps,
  type TimeseriesToolDeps,
  type UniswapV4ClientOptions,
} from "@ethonline2026/langchain-agent";
import type { AgentMode } from "../events/contract.js";
import { toolsForMode } from "./ToolRegistry.js";

/**
 * Everything a tool group might need.
 *
 * Each field is optional so an unconfigured deployment degrades group-by-group instead of failing to
 * boot. Nothing here is a default: an absent field *omits* its groups rather than substituting a
 * stand-in, because a stubbed data source would put invented numbers in front of the model under the
 * appearance of real ones.
 */
export interface ToolDeps {
  /** `RISK_GCS_BUCKET` / `RISK_LOCAL_DIR`. Without it the risk snapshots cannot be read. */
  readonly risk?: RiskProfileReader;
  /** `TIMESERIES_DATABASE_URL`. Without it there is no forecast accuracy or decision history. */
  readonly timeseries?: TimeseriesToolDeps;
  /** `TIMESFM3_SERVICE_URL` — the self-hosted forecasting service. */
  readonly timesfm3?: TimesFM3ToolDeps;
  /** `GATEWAY_API_KEY` (+ optional Studio override) for the Uniswap v4 subgraph. */
  readonly uniswapV4?: UniswapV4ClientOptions;
}

export interface ToolOmission {
  readonly id: string;
  /** Why it was left out, naming the setting that would include it. */
  readonly reason: string;
}

export interface BuiltTools {
  readonly tools: readonly StructuredToolInterface[];
  /** Group ids that produced tools, in `TOOL_GROUPS` order. */
  readonly registered: readonly string[];
  readonly omitted: readonly ToolOmission[];
}

/**
 * The setting each dependency-bearing group needs.
 *
 * Kept next to the builders rather than in the registry: it is a fact about this adapter's wiring, not
 * about placement policy, and a reason string that drifts from the builder is worse than none.
 */
const REQUIRES: Readonly<Record<string, string>> = {
  risk: "risk snapshots are not configured (set RISK_GCS_BUCKET or RISK_LOCAL_DIR)",
  // Both settings, because the bundle includes the vector store: the SQL tools need the database and
  // `VectorRepository` needs an embedding client. Naming only one would send an operator to half a fix.
  timeseries:
    "the timeseries bundle is not fully configured (set TIMESERIES_DATABASE_URL and GOOGLE_CLOUD_PROJECT)",
  // TimesFM-3 forecasts a window read from TimescaleDB, so the service alone cannot answer.
  timesfm3:
    "forecasting needs both halves (set TIMESFM3_SERVICE_URL and TIMESERIES_DATABASE_URL)",
  "uniswap-v4": "the graph gateway is not configured (set GATEWAY_API_KEY)",
};

/**
 * Flatten a factory's return into a tool list.
 *
 * The factories in `packages/langchain` are **not consistent**: most return an array, but
 * `createAquaTools`, `createRiskTools`, `createTimeseriesTools` and `createTimesFM3Tools` return a
 * name-keyed object. This adapter is the right place to absorb that — a caller that assumed an array
 * would receive nothing and register an empty group *silently*, which is the exact failure this file
 * exists to make visible.
 *
 * The terminal cast is load-bearing rather than laziness. LangChain's `DynamicStructuredTool` carries
 * the tool's own name as a generic parameter, so one factory's result object is not assignable to
 * another's even though both are tool collections. That variance is absorbed here, in the single place
 * that knows which factory it called, instead of being widened across every call site.
 */
function toolsOf(
  built: readonly unknown[] | Record<string, unknown>,
): readonly StructuredToolInterface[] {
  return (Array.isArray(built) ? built : Object.values(built)) as readonly StructuredToolInterface[];
}

const BUILDERS: Readonly<
  Record<string, (deps: ToolDeps) => readonly StructuredToolInterface[] | undefined>
> = {
  createMathTools: () => createMathTools(),
  createFixedIncomeTools: () => createFixedIncomeTools(),
  createLendingTools: () => createLendingTools(),
  createDexTools: () => createDexTools(),
  createPredictionTools: () => createPredictionTools(),
  createArcSettlementTools: () => createArcSettlementTools(),
  createAcpTools: () => createAcpTools(),
  createAquaTools: () => toolsOf(createAquaTools()),

  createRiskTools: (deps) =>
    deps.risk === undefined ? undefined : toolsOf(createRiskTools({ reader: deps.risk })),
  createTimeseriesTools: (deps) =>
    deps.timeseries === undefined
      ? undefined
      : toolsOf(createTimeseriesTools(deps.timeseries)),
  createTimesFM3Tools: (deps) =>
    deps.timesfm3 === undefined ? undefined : toolsOf(createTimesFM3Tools(deps.timesfm3)),
  // This one returns a client *and* a tool list, so the list is taken here rather than leaking that
  // third shape to every caller.
  createUniswapV4Tools: (deps) =>
    deps.uniswapV4 === undefined ? undefined : createUniswapV4Tools(deps.uniswapV4).tools,
};

/**
 * Build every in-process group that applies to `mode`.
 *
 * Sandbox-placed groups are skipped: those run as a worker, not a factory, and reporting them as
 * "omitted" would be wrong — they are not missing, they are elsewhere.
 */
export function buildTools(mode: AgentMode, deps: ToolDeps = {}): BuiltTools {
  const tools: StructuredToolInterface[] = [];
  const registered: string[] = [];
  const omitted: ToolOmission[] = [];

  for (const group of toolsForMode(mode)) {
    if (group.placement !== "in-process") continue;

    const build = BUILDERS[group.factory];
    if (build === undefined) {
      // A registry entry with no builder is a wiring mistake, not a configuration choice. Report it
      // with the same shape as a missing dependency so it cannot hide.
      omitted.push({ id: group.id, reason: `no builder is wired for factory \`${group.factory}\`` });
      continue;
    }

    const built = build(deps);
    if (built === undefined) {
      omitted.push({ id: group.id, reason: REQUIRES[group.id] ?? "required configuration is absent" });
      continue;
    }

    tools.push(...built);
    registered.push(group.id);
  }

  return { tools, registered, omitted };
}
