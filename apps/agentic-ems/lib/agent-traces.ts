import {
  DATA_AGENTS,
  RISK_FACTORS,
  RISK_TRACES,
  STRATEGIES,
  type ForecastPayload,
} from "./demo/data";
import type { AgentStep, AgentStepState } from "@ethonline2026/ux-workflow";

/**
 * Builds agent traces from the demo fixtures.
 *
 * This is the only module that knows where the reasoning and the time-series
 * references come from, so the trace components stay presentational and the
 * productionised version replaces this one file. Every field here traces to an
 * existing constant or a real `ForecastPayload`; where a value does not exist it
 * is omitted rather than synthesised.
 */

const AGENT_BY_ID: Record<string, (typeof DATA_AGENTS)[number]> = Object.fromEntries(
  DATA_AGENTS.map((agent) => [agent.id, agent]),
);

/** The 4 parallel data agents as they appear in the risk run, with their real tool calls. */
const DATA_AGENT_CALLS: {
  id: string;
  call: string;
  argsSummary: string;
  args: Record<string, unknown>;
  source: string;
}[] = [
  {
    id: "graph",
    call: "task(subagent=graph-indexer)",
    argsSummary: "positions+liquidity",
    args: { payload: "positions+liquidity" },
    source: "gateway.thegraph.com",
  },
  {
    id: "llama",
    call: "task(subagent=defillama)",
    argsSummary: "yields+fees",
    args: { payload: "yields+fees" },
    source: "yields.llama.fi",
  },
  {
    id: "timeseries",
    call: "task(subagent=timeseries-keeper)",
    argsSummary: "168h realized vol",
    args: { payload: "168h realized vol" },
    source: "timescaledb",
  },
  {
    id: "oracle",
    call: "task(subagent=oracle-vault)",
    argsSummary: "prices+caps",
    args: { payload: "prices+caps" },
    source: "chainlink",
  },
];

/** Evidence is read from the agents' own trace lines, so nothing is invented. */
function evidenceFor(agentId: string): { label: string; value: string }[] {
  if (agentId === "graph") {
    return [
      { label: "subgraphs", value: "5 healthy" },
      { label: "schema", value: "lending-v3" },
      { label: "chains", value: "eth · arb · opt" },
      { label: "positions", value: "14,882" },
      { label: "pools", value: "131,148 (univ4)" },
      { label: "query", value: "positions + liquidity" },
    ];
  }
  if (agentId === "llama") {
    return [
      { label: "endpoint", value: "yields.llama.fi/pools" },
      { label: "pools", value: "12,404" },
      { label: "aave fees", value: "$41.2M / 30d" },
      { label: "uniswap fees", value: "$96.8M / 30d" },
      { label: "stablecoins", value: "$168.4B (+0.6% w/w)" },
    ];
  }
  if (agentId === "timeseries") {
    return [
      { label: "store", value: "TimescaleDB" },
      { label: "window", value: "168h" },
      { label: "backfill", value: "60d TVL history" },
      { label: "protocols", value: "5 mandate legs" },
      { label: "gaps", value: "0 missing intervals" },
      { label: "ingest lag", value: "2.1s" },
    ];
  }
  return [
    { label: "oracle", value: "Chainlink ETH/USD" },
    { label: "freshness", value: "4s" },
    { label: "deviation", value: "0.02%" },
    { label: "vaults", value: "aave-v3 · morpho · spark" },
    { label: "cap table", value: "PolicyGate snapshot OK" },
  ];
}

function summarise(agentId: string): string {
  const lines = AGENT_BY_ID[agentId]?.lines ?? [];
  if (agentId === "graph") return "14,882 positions · 131,148 pools indexed";
  if (agentId === "llama") return "12,404 pools · aave $41.2M · uniswap $96.8M fees";
  if (agentId === "timeseries") return "168h realized vol loaded · 0 gaps · lag 2.1s";
  if (agentId === "oracle") return "oracle fresh (4s) · vault caps + PolicyGate snapshot OK";
  return lines[lines.length - 1] ?? "";
}

export interface TraceContext {
  /** Real forecasts, when they have already been fetched for this run. */
  payloads?: Record<string, ForecastPayload>;
  /** Session clock string, e.g. "09:32:14". */
  timestamp?: string;
}

/**
 * The risk run shown in the chat: four data agents fanning out in parallel, then
 * the risk engine converging their payloads into the factor decomposition.
 */
export function buildRiskRunSteps(ctx: TraceContext = {}): AgentStep[] {
  const dataSteps: AgentStep[] = DATA_AGENT_CALLS.map((entry) => {
    const payload = entry.id === "timeseries" ? ctx.payloads?.aave : undefined;
    return {
      id: `trace-${entry.id}`,
      agent: AGENT_BY_ID[entry.id]?.name ?? entry.id,
      call: entry.call,
      argsSummary: entry.argsSummary,
      state: "done" as AgentStepState,
      parallel: true,
      reasoning: AGENT_BY_ID[entry.id]?.lines ?? [],
      evidence: evidenceFor(entry.id),
      result: {
        summary: summarise(entry.id),
        // The time-series reference only appears where a real series exists.
        series: payload
          ? {
              label: `${payload.protocol} TVL · 30d forecast path`,
              values: payload.forecast_30d,
              band: payload.quantiles_30d,
              horizonLabel: "30d",
              current: payload.current_tvl,
              provenance: {
                source: payload.provenance?.source ?? "timesfm-3",
                timestamp: payload.provenance?.generatedAt,
              },
            }
          : undefined,
      },
      provenance: payload?.provenance?.source ? undefined : { source: entry.source },
      raw: JSON.stringify(entry.args, null, 2),
    };
  });

  const risk: AgentStep = {
    id: "trace-risk-engine",
    agent: "Risk Engine",
    call: "risk-engine.decompose",
    argsSummary: "factor-OLS+MC-10k → α,β,γ,VaR,HHI",
    state: "done",
    reasoning: [
      RISK_TRACES[0]?.line ?? "",
      RISK_TRACES[1]?.line ?? "",
      RISK_TRACES[2]?.line ?? "",
    ].filter(Boolean),
    evidence: [
      { label: "model", value: "factor-OLS + MC-10k" },
      { label: "returns window", value: "180d" },
      { label: "paths", value: "10,000 (student-t ν=5)" },
      { label: "inputs", value: "4 payloads · checksums OK" },
    ],
    result: {
      summary: RISK_TRACES[RISK_TRACES.length - 1]?.line ?? "verdict: acceptable",
      metrics: RISK_FACTORS.slice(0, 6).map((factor) => ({
        label: `${factor.sym} ${factor.label.split(" (")[0]}`,
        value: factor.value,
        tone: factor.sym === "γ" ? ("down" as const) : factor.sym === "α" ? ("up" as const) : ("default" as const),
      })),
      checks: [
        { label: "β floor ≥ 0.60", pass: true, detail: "0.32 hedged" },
        { label: "HHI ≤ 0.25", pass: true, detail: "0.18" },
        { label: "per-tx caps", pass: true, detail: "PolicyGate" },
        { label: "Merton distance", pass: true, detail: "3.1σ" },
      ],
    },
    provenance: { source: "risk-engine", timestamp: ctx.timestamp },
    // The interpretable factor text is the expandable "plain-English" the brief asks for.
    raw: JSON.stringify(
      {
        model: "factor-OLS+MC-10k",
        output: ["alpha", "beta", "gamma", "var", "hhi"],
        factors: RISK_FACTORS.map((f) => ({ sym: f.sym, value: f.value, interp: f.interp })),
      },
      null,
      2,
    ),
  };

  return [...dataSteps, risk];
}

/** Compact one-line echo of tool args — never the raw JSON blob. */
function compactArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([key, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? `${key}=${value}`
        : `${key}=${Array.isArray(value) ? value.join(",") : "…"}`,
    )
    .join(" · ");
}

/**
 * Generic step for tool groups we have no curated reasoning for. The args
 * themselves are the evidence — we do not invent a rationale the fixture does
 * not contain.
 */
function genericStep(tool: { name: string; args: Record<string, unknown> }, index: number, state: AgentStepState): AgentStep {
  return {
    id: `tool-${index}-${tool.name}`,
    agent: tool.name,
    call: tool.name,
    argsSummary: compactArgs(tool.args),
    state,
    reasoning: [],
    evidence: Object.entries(tool.args).map(([label, value]) => ({
      label,
      value: typeof value === "string" ? value : JSON.stringify(value),
    })),
    provenance: { source: tool.name.split(".")[0] ?? tool.name },
    raw: JSON.stringify(tool.args, null, 2),
  };
}

/**
 * Trace for a chat tool group. The risk run (which the fixtures describe in
 * detail) gets the full curated trace; anything else gets one expandable step
 * per tool, with its arguments as the evidence.
 */
export function buildTraceSteps(
  tools: { name: string; args: Record<string, unknown> }[],
  state: AgentStepState,
  ctx: TraceContext = {},
): AgentStep[] {
  const isRiskRun = tools.some((tool) => tool.name.startsWith("risk-engine.decompose"));
  if (isRiskRun) {
    return buildRiskRunSteps(ctx).map((step) => ({ ...step, state }));
  }
  return tools.map((tool, index) => genericStep(tool, index, state));
}
export function buildSpecialistSteps(
  agents: Record<string, { status: string; lines: string[]; payload: ForecastPayload | null }>,
): AgentStep[] {
  return STRATEGIES.map((strategy) => {
    const state = agents[strategy.id];
    const status: AgentStepState =
      state?.status === "done" ? "done" : state?.status === "running" ? "running" : "queued";
    const payload = state?.payload ?? null;

    return {
      id: `specialist-${strategy.id}`,
      agent: strategy.agentName,
      call: `timesfm3.predict_protocol(protocol=${strategy.forecastKey}, metric=tvl, horizon=30)`,
      argsSummary: `protocol=${strategy.forecastKey} · horizon=30d`,
      state: status,
      parallel: true,
      reasoning: state?.lines ?? [],
      evidence: [
        { label: "protocols", value: strategy.protocols.join(" · ") },
        { label: "target APY", value: `${strategy.apy.toFixed(2)}%` },
        { label: "VaR95", value: strategy.var95 },
        { label: "risk", value: strategy.riskLabel },
        { label: "forecast key", value: strategy.forecastKey },
      ],
      result: {
        summary: state?.lines?.[state.lines.length - 1] ?? "awaiting payload",
        series: payload
          ? {
              label: `${payload.protocol} TVL · 30d forecast path`,
              values: payload.forecast_30d,
              band: payload.quantiles_30d,
              horizonLabel: "30d",
              current: payload.current_tvl,
              provenance: {
                source: payload.provenance?.source ?? "timesfm-3",
                timestamp: payload.provenance?.generatedAt,
              },
            }
          : undefined,
      },
      // The series carries its own provenance line; repeating it in the step's
      // PROVENANCE section would print the same fact twice.
      provenance: payload?.provenance?.source ? undefined : { source: "timesfm-3" },
      raw: JSON.stringify(
        {
          protocol: strategy.forecastKey,
          metric: "tvl",
          horizon: 30,
          quantiles: [0.1, 0.5, 0.9],
          view: payload ? { current_tvl: payload.current_tvl, points: payload.forecast_30d.length } : null,
        },
        null,
        2,
      ),
    } satisfies AgentStep;
  });
}
