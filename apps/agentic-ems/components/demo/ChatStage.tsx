"use client";

import * as React from "react";
import {
  Conversation,
  ConversationContent,
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  AgentTraceGroup,
  type AgentStep,
} from "@ethonline2026/ux-workflow";
import { ArrowRight, Terminal } from "lucide-react";
import dynamic from "next/dynamic";
import { useDemo } from "@/lib/demo/state";
import { fetchForecast } from "@/lib/demo/forecast-client";
import { RISK_FACTORS, RISK_TRACES, STRATEGIES, TRADER_LIFELINE } from "@/lib/demo/data";
import type { ForecastPayload } from "@/lib/demo/data";
import { parseIntent } from "@/lib/execution/intent";
import type { IntentLeg } from "@/lib/execution/types";
import { buildTraceSteps } from "@/lib/agent-traces";
import { useInferenceRun } from "@/lib/inference/useInferenceRun";

/**
 * Heavy widgets load on demand. Recharts alone (ForecastFan, MiniPortfolio) and
 * the execution flow were being pulled into the chat's initial compile and
 * bundle even though most runs never render them.
 */
const WidgetFallback = () => (
  <div className="h-24 animate-pulse border border-edge-2 bg-panel-2" aria-hidden />
);

const ForecastFan = dynamic(() => import("./ForecastFan").then((m) => m.ForecastFan), {
  loading: WidgetFallback,
});
const SimulationStage = dynamic(
  () => import("./SimulationStage").then((m) => m.SimulationStage),
  { loading: WidgetFallback },
);
const ApprovalsStage = dynamic(
  () => import("./ApprovalsStage").then((m) => m.ApprovalsStage),
  { loading: WidgetFallback },
);
const ExecutingStage = dynamic(
  () => import("./ExecutingStage").then((m) => m.ExecutingStage),
  { loading: WidgetFallback },
);
const MiniPortfolio = dynamic(() => import("./MiniPortfolio").then((m) => m.MiniPortfolio), {
  loading: WidgetFallback,
});
const PortfolioFlow = dynamic(() => import("./PortfolioFlow").then((m) => m.PortfolioFlow), {
  loading: WidgetFallback,
});
const StrategyExecution = dynamic(
  () => import("./StrategyExecution").then((m) => m.StrategyExecution),
  { loading: WidgetFallback },
);

const MANDATE = `Create a fixed income trading strategy that invests in:
1. Lending — Aave and Morpho, stablecoin yields
2. DeFi staking — Lido and RocketPool
3. Prediction markets — Polymarket, low-volatility trades only
4. Perpetuals — Hyperliquid, delta-neutral funding capture
5. Liquidity provisioning — Uniswap v4`;

interface ToolItem {
  name: string;
  args: Record<string, unknown>;
}

type Item =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "agent"; text: string }
  | { id: number; kind: "tools"; tools: ToolItem[]; done: boolean; steps: AgentStep[] }
  | { id: number; kind: "yields" }
  | { id: number; kind: "forecast"; payload: ForecastPayload; label: string }
  | { id: number; kind: "search" }
  | { id: number; kind: "risk" }
  | { id: number; kind: "updates" }
  | { id: number; kind: "intent" }
  | { id: number; kind: "sim" }
  | { id: number; kind: "approvals" }
  | { id: number; kind: "exec" }
  | { id: number; kind: "mini" }
  | { id: number; kind: "portfolio-flow" }
  | { id: number; kind: "execution"; legs: IntentLeg[]; notes: string[] };

const SUGGESTIONS = [
  "Search liquid fixed-income instruments",
  "Show me stablecoin yields",
  "Run risk analysis on my book",
  "Forecast Aave TVL for the next 30 days",
  "Show my portfolio flow",
  "Invest $100,000: $50k Morpho on Base, $35k Uniswap v4 on Optimism, $15k Polymarket on Polygon",
  "Any strategy updates from my agents?",
  "Define my mandate",
];

function Typewriter({ text }: { text: string }) {
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => {
      setN((v) => {
        if (v >= text.length) {
          clearInterval(t);
          return v;
        }
        return v + 2;
      });
    }, 14);
    return () => clearInterval(t);
  }, [text]);
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-px animate-blink bg-amber" />}
    </>
  );
}

function YieldsWidget() {
  const rows = [
    { label: "Aave v3 · USDC", apy: 4.2, note: "$17.3B supplied" },
    { label: "Spark · USDS", apy: 5.1, note: "$1.4B supplied" },
    { label: "Morpho · WETH market", apy: 3.2, note: "$892M supplied" },
    { label: "Lido · stETH", apy: 2.18, note: "validator yield" },
  ];
  return (
    <div className="border border-edge-2 bg-panel">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
          Fixed-income yield board · live (DeFiLlama)
        </p>
        <span className="font-mono text-[10px] text-up">▲ updated 09:27 UTC</span>
      </div>
      <div className="grid grid-cols-2 gap-px bg-edge md:grid-cols-4">
        {rows.map((r) => (
          <div key={r.label} className="bg-panel px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">{r.label}</p>
            <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-up">{r.apy.toFixed(2)}%</p>
            <p className="font-mono text-[10px] text-fg-dim">{r.note}</p>
          </div>
        ))}
      </div>
      <p className="border-t border-edge px-3 py-2 font-mono text-[10px] text-fg-faint">
        sources: api.llama.fi · yields.llama.fi/pools — Metric Lock 2026-09-03
      </p>
    </div>
  );
}

function ForecastWidget({ payload, label }: { payload: ForecastPayload; label: string }) {
  const cur = payload.current_tvl;
  const d30 = payload.forecast_30d[29];
  const pct = ((d30 - cur) / cur) * 100;
  return (
    <div className="border border-edge-2 bg-panel">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
          TimesFM-3 · {label} TVL · 30d horizon · q10/q50/q90
        </p>
        <span className="font-mono text-[10px] text-fg-dim">model: timesfm-3.0-pytorch · 330M</span>
      </div>
      <div className="px-2 pt-2">
        <ForecastFan payload={payload} />
      </div>
      <div className="grid grid-cols-3 border-t border-edge font-mono text-xs">
        <div className="border-r border-edge px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.14em] text-fg-faint">Current</p>
          <p className="tabular-nums text-fg">${(cur / 1e9).toFixed(2)}B</p>
        </div>
        <div className="border-r border-edge px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.14em] text-fg-faint">Median d30</p>
          <p className="tabular-nums text-fg">${(d30 / 1e9).toFixed(2)}B</p>
        </div>
        <div className="px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.14em] text-fg-faint">Δ30d</p>
          <p className={`tabular-nums ${pct >= 0 ? "text-up" : "text-down"}`}>
            {pct >= 0 ? "+" : ""}
            {pct.toFixed(2)}%
          </p>
        </div>
      </div>
    </div>
  );
}

function SearchWidget() {
  const rows = [
    { inst: "Aave v3 · USDC · Ethereum", apy: 4.2, liq: "$412M avail", score: 96 },
    { inst: "Spark · USDS · Ethereum", apy: 5.1, liq: "$96M avail", score: 91 },
    { inst: "Morpho · USDC Vault · Base", apy: 4.9, liq: "$38M avail", score: 88 },
    { inst: "stETH/ETH Uniswap v4 0.05%", apy: 7.3, liq: "$24M in range", score: 84 },
    { inst: "Polymarket · high-prob book", apy: 6.2, liq: "$12M depth", score: 79 },
  ];
  return (
    <div className="border border-edge-2 bg-panel">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
          instrument search · 5 of 12,404 pools · sorted by risk-adj. carry
        </p>
        <span className="font-mono text-[10px] text-fg-faint">112ms</span>
      </div>
      <div className="divide-y divide-edge font-mono text-[11px]">
        {rows.map((r) => (
          <div key={r.inst} className="flex items-center gap-3 px-3 py-2">
            <span className="flex-1 truncate text-fg">{r.inst}</span>
            <span className="tabular-nums text-fg-dim">{r.liq}</span>
            <span className="w-14 text-right tabular-nums text-up">{r.apy.toFixed(1)}%</span>
            <span className={`w-10 text-right tabular-nums ${r.score >= 90 ? "text-up" : "text-amber"}`}>
              {r.score}
            </span>
          </div>
        ))}
      </div>
      <p className="border-t border-edge px-3 py-1.5 font-mono text-[10px] text-fg-faint">
        columns: instrument · available liquidity · carry APY · liquidity score
      </p>
    </div>
  );
}

function RiskWidget() {
  return (
    <div className="border border-edge-2 bg-panel">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
          risk engine · factor decomposition · interpretable
        </p>
        <span className="font-mono text-[10px] text-up">verdict: acceptable</span>
      </div>
      <div className="grid grid-cols-2 gap-px bg-edge md:grid-cols-3">
        {RISK_FACTORS.map((f) => (
          <details key={f.sym} className="group bg-panel">
            <summary className="cursor-pointer list-none px-3 py-2.5 hover:bg-panel-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                <span className="mr-1 text-amber">{f.sym}</span> {f.label}
              </p>
              <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-fg">{f.value}</p>
              <p className="mt-1 font-mono text-[9px] text-graph-soft group-open:hidden">
                ▸ what does this mean?
              </p>
            </summary>
            <p className="border-t border-edge px-3 py-2 font-mono text-[10px] leading-relaxed text-fg-dim">
              {f.interp}
            </p>
          </details>
        ))}
      </div>
      <details className="border-t border-edge bg-panel-2">
        <summary className="cursor-pointer px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
          ▸ full risk-engine trace (6 lines)
        </summary>
        <div className="space-y-1 px-3 pb-2 font-mono text-[10px] text-fg-dim">
          {RISK_TRACES.map((t, i) => (
            <p key={i}>
              <span className="text-graph-soft">{t.agent}│</span> {t.line}
            </p>
          ))}
        </div>
      </details>
    </div>
  );
}

function UpdatesWidget() {
  const updates = [
    { agent: "Lending Agent", color: "#16c784", line: "aave utilization 82% → supply APY tilted +12bps; added $3,000 USDC" },
    { agent: "LP Agent", color: "#ff007a", line: "univ4 range tightened ±10% → ±8%; fee APY +0.6%, LVR flat" },
    { agent: "Perps Agent", color: "#12aab5", line: "funding z-score +1.8σ; proposal queued — awaiting your Ledger" },
    { agent: "Staking Agent", color: "#6747ee", line: "rETH premium rich vs stETH — pausing new stakes this cycle" },
  ];
  return (
    <div className="border border-edge-2 bg-panel">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
          strategy updates · last 24h · 5 agents
        </p>
        <span className="font-mono text-[10px] text-fg-faint">2 proposals pending HITL</span>
      </div>
      <div className="divide-y divide-edge">
        {updates.map((u) => (
          <div key={u.agent} className="flex items-start gap-2.5 px-3 py-2.5">
            <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: u.color }} />
            <div>
              <p className="font-mono text-[11px] text-fg">{u.agent}</p>
              <p className="text-xs leading-relaxed text-fg-dim">{u.line}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="border-t border-edge px-3 py-1.5 font-mono text-[10px] text-fg-faint">
        full feed: <a className="text-amber underline-offset-2 hover:underline" href="/demo/dashboard">open dashboard → agent activity</a>
      </p>
    </div>
  );
}

function IntentCard({ onRun }: { onRun: () => void }) {
  return (
    <div className="border border-amber/50 bg-panel">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber">
          Parsed mandate · 5 strategies detected
        </p>
        <span className="font-mono text-[10px] text-fg-faint">intent-0x8f2c</span>
      </div>
      <div className="divide-y divide-edge">
        {STRATEGIES.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-3 py-2.5">
            <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-fg">{s.label}</p>
              <p className="truncate font-mono text-[10px] text-fg-faint">{s.protocols.join(" · ")}</p>
            </div>
            <span className="font-mono text-[10px] text-fg-dim">{s.riskLabel} risk</span>
            <span className="font-mono text-xs tabular-nums text-up">~{s.apy.toFixed(1)}%</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-edge px-3 py-2.5">
        <p className="font-mono text-[10px] text-fg-faint">
          ready for LLM + TimesFM-3 co-reasoning · est. 90s
        </p>
        <button
          onClick={onRun}
          className="flex items-center gap-1.5 bg-amber px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-on-amber hover:opacity-90"
        >
          Run simulation <ArrowRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function PortfolioFlowWidget() {
  return <PortfolioFlow height={300} />;
}

export function ChatStage() {
  const { state, dispatch } = useDemo();
  const [items, setItems] = React.useState<Item[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const idRef = React.useRef(0);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const nextId = () => ++idRef.current;
  const push = (item: DistributiveOmit<Item, "id"> & { id?: number }) =>
    setItems((prev) => [...prev, { ...item, id: item.id ?? nextId() } as Item]);

  const scrollDown = () => requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const runTools = async (tools: ToolItem[], holdMs = 2200) => {
    const id = nextId();
    // Build the trace up front so each step's reasoning and evidence are available
    // the moment the row appears — running steps stream their lines in the drawer.
    const steps = buildTraceSteps(tools, "running");
    setItems((prev) => [...prev, { id, kind: "tools", tools, done: false, steps }]);
    scrollDown();
    await sleep(holdMs);
    setItems((prev) =>
      prev.map((it) =>
        it.id === id && it.kind === "tools"
          ? { ...it, done: true, steps: buildTraceSteps(it.tools, "done") }
          : it,
      ),
    );
    scrollDown();
  };

  const agentSay = async (text: string, holdMs = 400) => {
    push({ kind: "agent", text });
    scrollDown();
    await sleep(text.length * 7 + holdMs);
  };

  // ---- Live inference -------------------------------------------------------------------------
  // `useInferenceRun` was written for exactly this and had no consumer: the desk ran `runScript`
  // unconditionally, so the simulation switch reported a mode the transcript never changed.
  const run = useInferenceRun();
  const liveStepsIdRef = React.useRef<number | null>(null);
  const liveSayIdRef = React.useRef<number | null>(null);
  const reportedFailureRef = React.useRef<string | null>(null);

  /**
   * Mirror the live run into the transcript.
   *
   * Each lane is addressed by one id held in a ref, so a step the service re-sends replaces its own
   * row rather than appending a duplicate. The stream is allowed to revise a step, and the
   * transcript should show the revision, not the history of revisions.
   */
  React.useEffect(() => {
    if (run.state.steps.length === 0) return;
    const id = liveStepsIdRef.current ?? (liveStepsIdRef.current = nextId());
    setItems((prev) => {
      if (!prev.some((it) => it.id === id)) {
        return [...prev, { id, kind: "tools", tools: [], done: false, steps: run.state.steps }];
      }
      return prev.map((it) =>
        it.id === id && it.kind === "tools"
          ? { ...it, steps: run.state.steps, done: !run.running }
          : it,
      );
    });
  }, [run.state.steps, run.running]);

  React.useEffect(() => {
    const text = run.state.message;
    if (text.length === 0) return;
    const id = liveSayIdRef.current ?? (liveSayIdRef.current = nextId());
    setItems((prev) => {
      if (!prev.some((it) => it.id === id)) return [...prev, { id, kind: "agent", text }];
      return prev.map((it) => (it.id === id && it.kind === "agent" ? { ...it, text } : it));
    });
  }, [run.state.message]);

  /**
   * A failed live run reports itself and stops there.
   *
   * It deliberately does *not* replay the scripted transcript: a desk that always looks populated
   * because the broken path quietly falls back is the one failure mode worth engineering against
   * here. Switching to simulation stays the operator's call, made with the failure visible.
   */
  React.useEffect(() => {
    if (run.failure === null || run.failure === reportedFailureRef.current) return;
    reportedFailureRef.current = run.failure;
    push({ kind: "agent", text: `Inference service unavailable — ${run.failure}` });
  }, [run.failure]);

  const runScript = async (prompt: string) => {
    setBusy(true);
    push({ kind: "user", text: prompt });
    scrollDown();

    if (prompt.startsWith("/wallet")) {
      await sleep(300);
      dispatch({ type: "set-stage", stage: "wallet-onboarding" });
      return;
    }

    // Matching is case-insensitive: users capitalise ("Invest $100k"), and the
    // suggestion chips do too.
    const q = prompt.toLowerCase();
    // A stated amount is what distinguishes an allocation from prose that merely
    // mentions investing — the mandate template says "a strategy that invests in…"
    // and must not be swallowed here.
    const statedAmount = /\$\s*[\d,]+/.test(prompt);

    if (
      (statedAmount && (q.includes("invest") || q.includes("allocate") || q.includes("deploy"))) ||
      q.includes("execute the") ||
      q.includes("deploy the")
    ) {
      // The agent's job: turn the prose into structured legs, then be explicit
      // about anything it could not resolve rather than guessing.
      const { legs, notes } = parseIntent(prompt);
      const understood = legs.map((leg, index) => `${index + 1}. ${leg.intent}`).join("  ·  ");
      await agentSay(
        `Understood — ${legs.length} legs. ${understood}`,
        notes.length ? 600 : 400,
      );
      if (notes.length) {
        await agentSay(`Two things I did not assume: ${notes.join(" ")}`);
      }
      await runTools(
        [
          { name: "execution.plan", args: { legs: legs.length, source: "Base", mode: "clear-signed-batch" } },
          { name: "lifi.routes", args: { aggregate: "bridges", order: "CHEAPEST" } },
          { name: "oneinch.quote", args: { api: "swap/v6.1", include: "gas,protocols" } },
          { name: "layerzero.quote", args: { eip: "OptionsBuilder", compose: true } },
        ],
        1500,
      );
      push({ kind: "execution", legs, notes });
      scrollDown();
      await sleep(400);
      await agentSay(
        "Routes priced. Review the batch below — the digest is what your signature will commit to. Nothing is broadcast until you sign.",
      );
    } else if (
      prompt.includes("portfolio") ||
      prompt.includes("allocation") ||
      prompt.includes("position") ||
      prompt.includes("flow")
    ) {
      await agentSay(
        "Reading every position in your portfolio and tracing where the NAV is deployed. Each leg is agent-managed — hover one for its APY, VaR and the specialist that runs it.",
      );
      await runTools([
        { name: "portfolio.positions", args: { portfolio: "portfolio-demo-001", groupBy: "strategy" } },
        { name: "graph.query", args: { entity: "allocation", include: "apy,var95,agent" } },
      ], 1400);
      push({ kind: "portfolio-flow" });
      scrollDown();
      await sleep(500);
      await agentSay(
        "Five legs live. Lending carries the largest weight, perps the highest forecast yield, and the LP leg is the only short-volatility exposure — that is where the −0.38 vega comes from.",
      );
    } else if (prompt.includes("mandate") || prompt.includes("strategy")) {
      // Checked *before* the fuzzy keyword branches: the mandate template says
      // "Liquidity provisioning", which `includes("liquid")` would otherwise
      // swallow into the search branch.
      await agentSay(
        "Understood. Parsing your mandate into strategy legs and mapping each one to a specialist agent. This is what I extracted:",
      );
      await sleep(500);
      push({ kind: "intent" });
      scrollDown();
    } else if (prompt.includes("search") || prompt.includes("instrument") || prompt.includes("liquid")) {
      await agentSay(
        "Searching across 12,404 yield pools and 8,172 protocols. Scoring by risk-adjusted carry — liquidity depth, utilization stability, and TimesFM forecast dispersion.",
      );
      await runTools([
        { name: "defillama.yields.search", args: { filters: { tvlMin: "10M", stable: true }, sort: "riskAdjustedApy" } },
        { name: "graph.query", args: { entity: "pool-liquidity", chains: ["eth", "arb", "base"] } },
      ]);
      push({ kind: "search" });
      scrollDown();
      await sleep(500);
      await agentSay(
        "Aave USDC leads on depth (score 96). Spark USDS pays 90bps more but with 4× less exit liquidity. Next, I can decompose the risk factors of any of these — or you can hand me a full mandate.",
      );
    } else if (prompt.includes("risk analysis") || prompt.includes("risk") || prompt.includes("book")) {
      await agentSay(
        "Running the risk engine over your current book — four data agents feed it in parallel, then it decomposes α, β, γ and tails. Every factor is expandable with a plain-English interpretation.",
      );
      // One group, not two: the four data agents fan out and the risk engine
      // converges them, so the fan-out → converge shape stays legible in a single
      // trace card and every step's reasoning lives in the same drawer.
      await runTools(
        [
          { name: "task(subagent=graph-indexer)", args: { payload: "positions+liquidity" } },
          { name: "task(subagent=defillama)", args: { payload: "yields+fees" } },
          { name: "task(subagent=timeseries-keeper)", args: { payload: "168h realized vol" } },
          { name: "task(subagent=oracle-vault)", args: { payload: "prices+caps" } },
          { name: "risk-engine.decompose", args: { model: "factor-OLS+MC-10k", output: "alpha,beta,gamma,var,hhi" } },
        ],
        2400,
      );
      push({ kind: "risk" });
      scrollDown();
      await sleep(500);
      await agentSay(
        "Book verdict: acceptable. α +2.41% is real carry, β 0.32 keeps you defensive, and the −0.38 vega is the LP leg's cost of short volatility. Open any factor for its interpretation.",
      );
    } else if (prompt.includes("updates") || prompt.includes("agent")) {
      await agentSay("Pulling the last 24h of agent activity across your five strategy legs.");
      await runTools([
        { name: "desk.activity", args: { window: "24h", agents: "all-5" } },
      ], 1200);
      push({ kind: "updates" });
      scrollDown();
    } else if (prompt.includes("stablecoin yields") || prompt.includes("yield")) {
      await agentSay(
        "Pulling live fixed-income yields from DeFiLlama and The Graph. Filtering for stablecoin and benchmark ETH markets.",
      );
      await runTools([
        { name: "graph.query", args: { endpoint: "gateway.thegraph.com", schema: "lending-v3", chains: ["eth", "arb"] } },
        { name: "defillama.yields", args: { pools: "aave-v3-usdc, spark-usds, morpho-weth", metric: "supplyApy" } },
      ]);
      push({ kind: "yields" });
      scrollDown();
      await sleep(600);
      await agentSay(
        "Aave USDC is the deepest stablecoin market at 4.2%; Spark USDS currently pays 5.1%. Flagging both as candidate carry legs for your mandate.",
      );
    } else if (prompt.includes("forecast") || prompt.includes("tvl")) {
      await agentSay(
        "Running TimesFM-3 on Aave's TVL history — 16k context, 30-day horizon, 9 quantile levels. One forward pass, no autoregression.",
      );
      await runTools([
        { name: "timesfm3.predict_protocol", args: { protocolSlug: "aave", metric: "tvl", horizon: 30, quantiles: [0.1, 0.5, 0.9] } },
      ]);
      try {
        const payload = await fetchForecast("aave");
        push({ kind: "forecast", payload, label: "Aave" });
        scrollDown();
        await sleep(400);
        await agentSay(
          "The median path is stable-to-up with a tight q10–q90 band — low forecast uncertainty, which supports a larger lending allocation in the simulation.",
        );
      } catch {
        await agentSay("Forecast service is unreachable right now — try again in a moment.");
      }
    } else {
      await agentSay(
        "I can pull live yields, run TimesFM-3 forecasts, or take your mandate. Try one of the suggestions below — or type /wallet to onboard your on-chain wallet.",
      );
    }
    setBusy(false);
  };

  /**
   * One entry point for a user turn.
   *
   * The simulation switch decides which path runs: `runScript` replays the recorded choreography,
   * and the live path calls the inference service and renders whatever it actually emits. Both
   * record the user's own message first, so the transcript reads the same either way.
   */
  const submit = (prompt: string) => {
    if (state.simulated) {
      void runScript(prompt);
      return;
    }
    // Fresh lanes per turn: a new turn's trace is its own, not an amendment to the last one.
    liveStepsIdRef.current = null;
    liveSayIdRef.current = null;
    reportedFailureRef.current = null;
    push({ kind: "user", text: prompt });
    scrollDown();
    void run.start({ query: prompt });
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy || run.running) return;
    setInput("");
    submit(text);
  };

  return (
    <Conversation className="flex-1">
      <ConversationContent className="mx-auto w-full max-w-3xl px-4 py-6">
        {items.length === 0 && (
          <div className="flex flex-col items-center py-10 text-center">
            <Terminal className="size-8 text-amber" />
            <h2 className="mt-4 text-xl font-semibold">Desk agent ready</h2>
            <p className="mt-2 max-w-md text-sm text-fg-dim">
              Ask for live market data, run TimesFM-3 forecasts, or give me a mandate in plain English.
              Onboard your on-chain wallet with <code className="border border-edge-2 bg-panel-2 px-1 font-mono text-xs text-amber">/wallet</code>.
            </p>
            <p className="mt-1 font-mono text-[10px] text-fg-faint">
              signed in as {state.email || "demo@agentic-ems.eth"} · embedded wallet provisioned
            </p>
            <div className="mt-8 w-full max-w-2xl border border-edge-2 bg-panel px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
                the fixed-income trader lifeline · how this desk works
              </p>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                {TRADER_LIFELINE.map((s) => (
                  <div key={s.step} className="flex items-start gap-2">
                    <span className="flex size-5 shrink-0 items-center justify-center border border-amber/40 bg-amber/10 font-mono text-[10px] text-amber">
                      {s.step}
                    </span>
                    <div>
                      <p className="font-mono text-[11px] text-fg">{s.label}</p>
                      <p className="text-[10px] leading-snug text-fg-faint">{s.hint}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 border-t border-edge pt-2 font-mono text-[10px] text-fg-faint">
                start with a suggestion below — every answer cites its data source
              </p>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {items.map((item) => {
            if (item.kind === "user")
              return (
                <div key={item.id} className="flex justify-end">
                  <p className="max-w-[80%] border border-edge-2 bg-panel-2 px-4 py-2.5 text-sm text-fg">
                    {item.text}
                  </p>
                </div>
              );
            if (item.kind === "agent")
              return (
                <div key={item.id} className="flex gap-3">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center border border-amber/40 bg-amber/10 font-mono text-[10px] text-amber">
                    Æ
                  </span>
                  <p className="max-w-[85%] text-sm leading-relaxed text-fg">
                    {items.filter((i) => i.kind === "agent").at(-1)?.id === item.id ? (
                      <Typewriter text={item.text} />
                    ) : (
                      item.text
                    )}
                  </p>
                </div>
              );
            if (item.kind === "tools")
              return (
                <div key={item.id} className="ml-9">
                  <AgentTraceGroup
                    title="Agent tasks"
                    subtitle={`${item.steps.length} steps · expand a step for its reasoning and evidence`}
                    steps={item.steps}
                    layout="fanout"
                    streaming={!item.done}
                  />
                </div>
              );
            if (item.kind === "yields") return <div key={item.id} className="ml-9"><YieldsWidget /></div>;
            if (item.kind === "portfolio-flow")
              return (
                <div key={item.id} className="ml-9">
                  <PortfolioFlowWidget />
                </div>
              );
            if (item.kind === "search") return <div key={item.id} className="ml-9"><SearchWidget /></div>;
            if (item.kind === "risk") return <div key={item.id} className="ml-9"><RiskWidget /></div>;
            if (item.kind === "updates") return <div key={item.id} className="ml-9"><UpdatesWidget /></div>;
            if (item.kind === "forecast")
              return (
                <div key={item.id} className="ml-9">
                  <ForecastWidget payload={item.payload} label={item.label} />
                </div>
              );
            if (item.kind === "intent")
              return (
                <div key={item.id} className="ml-9">
                  <IntentCard
                    onRun={() => {
                      agentSay(
                        "Spawning the orchestrator — four data agents fan out in parallel, the risk engine decomposes the book, and the five strategy specialists run their TimesFM-3 forecasts. Canvas follows:",
                      );
                      push({ kind: "sim" });
                      scrollDown();
                    }}
                  />
                </div>
              );
            if (item.kind === "sim")
              return (
                <div key={item.id} className="ml-9 flex h-[640px] flex-col border border-edge-2">
                  <SimulationStage
                    onNext={() => {
                      push({ kind: "approvals" });
                      scrollDown();
                    }}
                  />
                </div>
              );
            if (item.kind === "approvals")
              return (
                <div key={item.id} className="ml-9">
                  <ApprovalsStage
                    onNext={() => {
                      push({ kind: "exec" });
                      scrollDown();
                    }}
                  />
                </div>
              );
            if (item.kind === "exec")
              return (
                <div key={item.id} className="ml-9">
                  <ExecutingStage
                    onPortfolioLive={() => {
                      push({ kind: "mini" });
                      scrollDown();
                    }}
                  />
                </div>
              );
            if (item.kind === "execution")
              return (
                <div key={item.id} className="ml-9">
                  <StrategyExecution legs={item.legs} />
                </div>
              );
            if (item.kind === "mini")
              return (
                <div key={item.id} className="ml-9">
                  <MiniPortfolio />
                </div>
              );
          })}
        </div>

        <div ref={bottomRef} className="h-2" />
      </ConversationContent>

      <div className="border-t border-edge bg-panel">
        <div className="mx-auto w-full max-w-3xl px-4 py-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                disabled={busy || run.running}
                onClick={() => {
                  if (s === "Define my mandate") setInput(MANDATE);
                  else submit(s);
                }}
                className="border border-edge-2 px-2.5 py-1 font-mono text-[10px] text-fg-dim hover:border-amber/60 hover:text-amber disabled:opacity-40"
              >
                {s}
              </button>
            ))}
            <button
              disabled={busy || run.running}
              onClick={() => runScript("/wallet")}
              className="border border-amber/40 bg-amber/5 px-2.5 py-1 font-mono text-[10px] text-amber hover:bg-amber/10 disabled:opacity-40"
            >
              /wallet
            </button>
          </div>
          <PromptInput onSubmit={onSubmit}>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the desk agent… or type /wallet"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) onSubmit(e as unknown as React.FormEvent);
              }}
            />
            <PromptInputSubmit disabled={busy || run.running || !input.trim()} />
          </PromptInput>
        </div>
      </div>
    </Conversation>
  );
}
