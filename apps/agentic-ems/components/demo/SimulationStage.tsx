"use client";

import * as React from "react";
import { ArrowRight, CircleCheck } from "lucide-react";
import { useDemo } from "@/lib/demo/state";
import { allocationsFor, DATA_AGENTS, RISK_TRACES, STRATEGIES, TOTAL_BALANCE } from "@/lib/demo/data";
import { AgentTraceGroup } from "@ethonline2026/ux-workflow";
import { buildSpecialistSteps } from "@/lib/agent-traces";
import { fetchForecast } from "@/lib/demo/forecast-client";
import type { ForecastPayload } from "@/lib/demo/data";

const TOTAL_MS = 90_000;

type Phase = "orchestrator" | "data" | "risk" | "parallel" | "synthesis" | "proposal" | "feedback" | "signature";

interface SubagentState {
  status: "spawning" | "running" | "done";
  progress: number;
  lines: string[];
  payload: ForecastPayload | null;
  elapsed: number;
}

const TRACE_TEMPLATES: Record<string, string[]> = {
  lending: [
    "fetching aave v3 + morpho reserves (yields.llama.fi)…",
    "utilization stable: 78% → supply APY 4.2–5.1%",
    "timesfm3.predict_protocol(protocol=aave, metric=tvl, horizon=30)",
    "q10–q90 band tight · forecast gate: acceptable → HITL",
  ],
  staking: [
    "lido stETH 2.18% · rocketpool rETH 2.42% base yields",
    "checking validator queue + exit liquidity depth…",
    "timesfm3.predict_protocol(protocol=lido, metric=tvl, horizon=30)",
    "stETH/rETH basis within ±6bps · low dispersion",
  ],
  prediction: [
    "scanning polymarket order book for >92¢ contracts…",
    "filtering: low-volatility, ≤14d resolution, UMA-verified markets",
    "expected carry 6.2% annualized on committed tranche",
    "downside bounded · max loss = premium per market",
  ],
  perps: [
    "hyperliquid funding z-score: +1.8σ on ETH-USD",
    "constructing delta-neutral basis (long spot / short perp)",
    "timesfm3.predict_protocol(protocol=hyperliquid, metric=tvl, horizon=30)",
    "funding persistence backtest: hit-rate 0.74 · MAPE 0.19",
  ],
  lp: [
    "uniswap v4 pool scan: USDC/ETH 0.05% · 131k pools indexed",
    "fee slope k calibrated on 14d feeAPY vs realized σ",
    "netApy = (1−w)(k·σ) + w·r − L²σ²/8 → 7.3% net",
    "range ±10% · LVR-adjusted carry positive in 3 of 4 weeks",
  ],
};

const SYNTHESIS = (risk: string) =>
  `Synthesis complete. I ran the lending, staking, prediction, perps, and LP specialists in parallel and their forecasts agree on one point: funding stress is low and the q10–q90 bands are tight, so the ${risk} allocation tilts toward carry. Proposal below is ready for your per-agent approval — every number traces to DeFiLlama data and a TimesFM-3 forecast with provenance.`;

export function SimulationStage({ onNext }: { onNext?: () => void } = {}) {
  const { state, dispatch } = useDemo();
  const risk = state.answers?.risk ?? "balanced";
  const alloc = React.useMemo(() => allocationsFor(risk), [risk]);

  const [phase, setPhase] = React.useState<Phase>("orchestrator");
  const [agents, setAgents] = React.useState<Record<string, SubagentState>>({});
  const [payloads, setPayloads] = React.useState<Record<string, ForecastPayload>>({});
  const [elapsed, setElapsed] = React.useState(0);
  const [skipped, setSkipped] = React.useState(false);
  const startedAt = React.useRef(Date.now());

  const showProposal = () => setPhase("proposal");

  // Countdown + auto progression
  React.useEffect(() => {
    if (phase === "proposal") return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt.current), 250);
    return () => clearInterval(t);
  }, [phase]);

  React.useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    // orchestrator → 4 data agents → risk engine → 5 specialists → synthesis → proposal
    timers.push(setTimeout(() => setPhase("data"), 3500));
    timers.push(setTimeout(() => setPhase("risk"), 13000));
    timers.push(setTimeout(() => setPhase("parallel"), 20000));
    timers.push(setTimeout(() => setPhase("synthesis"), TOTAL_MS - 34000));
    timers.push(setTimeout(() => setPhase("proposal"), TOTAL_MS - 30000));
    return () => timers.forEach(clearTimeout);
  }, []);

  // Spawn all five task() cards simultaneously
  React.useEffect(() => {
    if (phase !== "parallel" || Object.keys(agents).length > 0) return;
    const init: Record<string, SubagentState> = {};
    for (const s of STRATEGIES) {
      init[s.id] = { status: "running", progress: 0, lines: [], payload: null, elapsed: 0 };
    }
    setAgents(init);

    const t = setInterval(() => {
      setAgents((prev) => {
        const next: Record<string, SubagentState> = {};
        for (const s of STRATEGIES) {
          const cur = prev[s.id];
          if (cur.status === "done") {
            next[s.id] = cur;
            continue;
          }
          const progress = Math.min(100, cur.progress + 1.1 + Math.random() * 1.4);
          const lineCount = Math.min(TRACE_TEMPLATES[s.id].length, Math.floor(progress / 26));
          const lines = TRACE_TEMPLATES[s.id].slice(0, lineCount);
          const status = progress >= 100 ? "done" : "running";
          next[s.id] = { ...cur, progress, lines, status };
        }
        return next;
      });
    }, 900);

    return () => clearInterval(t);
  }, [phase, agents]);

  // Forecast payloads load on mount, independent of the animation, so the time-series
  // reference is available in a step's drawer even if the user skips ahead instantly.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      for (const s of STRATEGIES) {
        try {
          const payload = await fetchForecast(s.forecastKey);
          if (alive) setPayloads((prev) => ({ ...prev, [s.id]: payload }));
        } catch {}
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const skip = () => {
    setSkipped(true);
    startedAt.current = Date.now() - TOTAL_MS;
    setElapsed(TOTAL_MS);
    setAgents((prev) => {
      const next = { ...prev };
      for (const s of STRATEGIES) {
        next[s.id] = {
          ...next[s.id],
          status: "done",
          progress: 100,
          lines: TRACE_TEMPLATES[s.id],
        };
      }
      return next;
    });
    setPhase("proposal");
  };

  const doneCount = Object.values(agents).filter((a) => a.status === "done").length;
  // Rebuilt as the agents progress, so a running step streams its lines into the
  // drawer. Payloads are merged in from their own state so the forecast series
  // survives a skip.
  const specialistSteps = React.useMemo(() => {
    const merged: Record<string, { status: string; lines: string[]; payload: ForecastPayload | null }> = {};
    for (const s of STRATEGIES) {
      const agent = agents[s.id];
      merged[s.id] = {
        status: agent?.status ?? "queued",
        lines: agent?.lines ?? [],
        payload: agent?.payload ?? payloads[s.id] ?? null,
      };
    }
    return buildSpecialistSteps(merged);
  }, [agents, payloads]);
  const pct = Math.min(100, (elapsed / TOTAL_MS) * 100);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-edge bg-panel px-4 py-2.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber">
          simulation · LLM + TimesFM-3 co-reasoning · deepagents orchestrator
        </p>
        <div className="flex items-center gap-3">
          {phase !== "proposal" && (
            <>
              <span className="font-mono text-[11px] tabular-nums text-fg-dim">
                {String(Math.floor(elapsed / 1000)).padStart(2, "0")}s / 90s
              </span>
              <button
                onClick={skip}
                className="border border-edge-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim hover:border-amber/60 hover:text-amber"
              >
                Skip →
              </button>
            </>
          )}
        </div>
      </div>
      {phase !== "proposal" && (
        <div className="h-0.5 w-full bg-edge">
          <div className="h-0.5 bg-amber transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          <ReasoningLine text="I'll fan out four data agents in parallel — graph, DeFiLlama, timeseries, oracle — feed their payloads to the risk engine, then run the five strategy specialists on top." />

          {(phase === "data" || phase === "risk" || phase === "parallel" || phase === "synthesis" || phase === "proposal" || phase === "feedback" || phase === "signature" || skipped) && (
            <div>
              <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
                <span className="text-graph-soft">task()</span> data squad · 4 fetchers in one turn
              </p>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {DATA_AGENTS.map((a, i) => (
                  <div key={a.id} className="border border-graph/30 bg-panel px-3 py-2" style={{ animation: "hero-line 0.4s ease-out both", animationDelay: `${i * 0.15}s` }}>
                    <p className="flex items-center justify-between font-mono text-[11px] font-semibold" style={{ color: a.color }}>
                      {a.name}
                      <CircleCheck className="size-3.5 text-up" />
                    </p>
                    <div className="mt-1 space-y-0.5 font-mono text-[10px] leading-relaxed text-fg-dim">
                      {a.lines.map((l, j) => (
                        <p key={j} style={{ animation: "hero-line 0.4s ease-out both", animationDelay: `${0.4 + j * 0.7}s` }}>
                          <span className="text-fg-faint">│ </span>{l}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(phase === "risk" || phase === "parallel" || phase === "synthesis" || phase === "proposal" || phase === "feedback" || phase === "signature" || skipped) && (
            <div className="border border-amber/40 bg-panel">
              <div className="flex items-center justify-between border-b border-edge px-3 py-2">
                <p className="font-mono text-[11px] font-semibold text-amber">risk-engine.decompose()</p>
                <span className="font-mono text-[10px] text-up">verdict: acceptable → HITL</span>
              </div>
              <p className="px-3 pt-2 font-mono text-[10px] text-fg-faint">
                merged 4/4 data payloads · OLS factor decomposition + 10k-path Monte Carlo
              </p>
              <details className="border-t border-edge">
                <summary className="cursor-pointer px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  ▸ reasoning trace · 6 lines (click to expand)
                </summary>
                <div className="space-y-1 px-3 pb-2 font-mono text-[10px] leading-relaxed text-fg-dim">
                  {RISK_TRACES.map((t, i) => (
                    <p key={i}>
                      <span className="text-graph-soft">{t.agent}│</span> {t.line}
                    </p>
                  ))}
                </div>
              </details>
            </div>
          )}

          {(phase === "parallel" || phase === "synthesis" || phase === "proposal" || phase === "feedback" || phase === "signature" || skipped) && (
            <>
              <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
                <span className="text-amber">task()</span> spawning 5 specialists in one turn
                {doneCount === 5 && <CircleCheck className="size-3.5 text-up" />}
              </p>
              {/* Same component as the chat tool group — one trace vocabulary everywhere.
                  The forecast fan used to be inlined in each card; it now lives in the
                  expanded drawer as a SeriesPreview, so the row stays scannable. */}
              <AgentTraceGroup
                title="Specialist forecasts"
                subtitle="one turn · expand a leg for its reasoning, evidence and the forecast series"
                steps={specialistSteps}
                layout="fanout"
                streaming={doneCount < STRATEGIES.length}
              />
            </>
          )}

          {(phase === "synthesis" || phase === "proposal" || phase === "feedback" || phase === "signature") && (
            <ReasoningLine text={SYNTHESIS(risk)} final />
          )}

          {(phase === "proposal" || phase === "feedback" || phase === "signature") && (
            <div className="border border-amber/50 bg-panel" style={{ animation: "hero-line 0.5s ease-out both" }}>
              <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber">
                  allocation proposal · ${TOTAL_BALANCE.toLocaleString("en-US")} · {risk} profile
                </p>
                <span className="font-mono text-[10px] text-fg-faint">provenance: llama + timesfm-3</span>
              </div>
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-edge text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                    <th className="px-4 py-2 font-normal">Strategy</th>
                    <th className="px-4 py-2 font-normal">Agent</th>
                    <th className="px-4 py-2 text-right font-normal">Alloc</th>
                    <th className="px-4 py-2 text-right font-normal">USD</th>
                    <th className="px-4 py-2 text-right font-normal">APY est</th>
                    <th className="px-4 py-2 text-right font-normal">VaR95</th>
                  </tr>
                </thead>
                <tbody>
                  {alloc.map(({ strategy, pct: p, usd }) => (
                    <tr key={strategy.id} className="border-b border-edge/60">
                      <td className="px-4 py-2.5">
                        <span className="mr-2 inline-block size-2 rounded-full align-middle" style={{ background: strategy.color }} />
                        {strategy.label}
                      </td>
                      <td className="px-4 py-2.5 text-fg-dim">{strategy.agentName}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-fg">{p}%</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-amber">${usd.toLocaleString("en-US")}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-up">{strategy.apy.toFixed(1)}%</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-fg-dim">{strategy.var95}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between border-t border-edge px-4 py-3">
                <p className="font-mono text-[10px] text-fg-faint">
                  forecast gate: acceptable — TimesFM-3 feedback requested before HITL
                </p>
                <button
                  onClick={() => setPhase("feedback")}
                  className="flex items-center gap-1.5 bg-amber px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-on-amber hover:opacity-90"
                >
                  Provide feedback <ArrowRight className="size-3.5" />
                </button>
              </div>
            </div>
          )}

          {phase === "feedback" && (
            <FeedbackForm
              onSubmit={() => setPhase("signature")}
              onSkip={() => setPhase("signature")}
            />
          )}

          {phase === "signature" && (
            <SignatureGate
              onDone={() => (onNext ? onNext() : dispatch({ type: "set-stage", stage: "approvals" }))}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function FeedbackForm({ onSubmit, onSkip }: { onSubmit: () => void; onSkip: () => void }) {
  const [cycle, setCycle] = React.useState<string | null>(null);
  const [timing, setTiming] = React.useState<string | null>(null);
  const [coupon, setCoupon] = React.useState<string | null>(null);
  const ready = cycle && timing && coupon;

  const Q = ({
    q, hint, options, value, onPick,
  }: {
    q: string; hint: string; options: string[]; value: string | null; onPick: (v: string) => void;
  }) => (
    <div className="border-b border-edge px-4 py-3 last:border-b-0">
      <p className="text-sm text-fg">{q}</p>
      <p className="mt-0.5 font-mono text-[10px] text-fg-faint">{hint}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onPick(o)}
            className={`border px-2.5 py-1.5 font-mono text-[10px] ${
              value === o ? "border-amber bg-amber/10 text-amber" : "border-edge-2 text-fg-dim hover:border-amber/40"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="border border-graph/50 bg-panel" style={{ animation: "hero-line 0.5s ease-out both" }}>
      <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-graph-soft">
          TimesFM-3 feedback · shape your allocation through the yield cycle
        </p>
        <span className="font-mono text-[10px] text-fg-faint">4 quantile paths · 30d horizon</span>
      </div>
      <Q
        q="How should the desk deploy through the yield generation cycle?"
        hint="TimesFM paths show APY peaking around day 12–18 before mean-reverting"
        options={["Front-load carry", "Smooth DCA", "Back-load on dip"]}
        value={cycle}
        onPick={setCycle}
      />
      <Q
        q="What execution timing do you want the agents to use?"
        hint="Almgren-Chriss schedule vs opportunistic fills — impact model attached"
        options={["TWAP 4h", "Immediate", "Opportunistic"]}
        value={timing}
        onPick={setTiming}
      />
      <Q
        q="Coupon & yield policy for realized returns?"
        hint="Compounding vs distribution changes the NAV curve the agents target"
        options={["Auto-compound", "Distribute weekly", "Split 50/50"]}
        value={coupon}
        onPick={setCoupon}
      />
      <div className="flex items-center justify-between border-t border-edge px-4 py-3">
        <button onClick={onSkip} className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint hover:text-amber">
          Skip feedback →
        </button>
        <button
          onClick={onSubmit}
          disabled={!ready}
          className="flex items-center gap-1.5 bg-amber px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-on-amber hover:opacity-90 disabled:opacity-40"
        >
          Confirm & request signature <ArrowRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function SignatureGate({ onDone }: { onDone: () => void }) {
  const [signed, setSigned] = React.useState(false);

  React.useEffect(() => {
    const t1 = setTimeout(() => setSigned(true), 2600);
    const t2 = setTimeout(onDone, 4600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onDone]);

  return (
    <div className="border border-up/50 bg-up/5 p-5 text-center shadow-[0_0_48px_-12px] shadow-up/40" style={{ animation: "hero-line 0.5s ease-out both" }}>
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-up">
        mandate signature · Ledger (DNK) + Gnosis Safe
      </p>
      {!signed ? (
        <>
          <div className="mx-auto mt-4 flex h-12 w-20 items-center justify-center rounded border border-edge-2 bg-panel">
            <span className="animate-pulse font-mono text-[10px] tracking-widest text-amber">●●●</span>
          </div>
          <p className="mt-3 font-mono text-xs text-fg">Confirm the EIP-712 mandate digest on your Ledger…</p>
          <p className="mt-1 font-mono text-[10px] text-fg-faint">
            digest 0x4e1f…9ab2 · Safe 0x1C9a…2d51 · threshold 2/2
          </p>
        </>
      ) : (
        <>
          <p className="mt-4 font-mono text-2xl text-up">✓</p>
          <p className="mt-1 font-mono text-xs text-fg">Signed — Safe owner threshold met (2/2)</p>
          <p className="mt-1 font-mono text-[10px] text-fg-faint">
            agent proposals can now be provisioned · continuing to approvals…
          </p>
        </>
      )}
    </div>
  );
}

function ReasoningLine({ text, final }: { text: string; final?: boolean }) {
  return (
    <div className={`flex gap-3 border bg-panel p-4 ${final ? "border-amber/40" : "border-edge-2"}`}>
      <span
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center border font-mono text-[10px] ${
          final ? "border-amber/50 bg-amber/10 text-amber" : "border-graph/50 bg-graph/10 text-graph-soft"
        }`}
      >
        {final ? "Σ" : "Æ"}
      </span>
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
          {final ? "orchestrator · synthesis" : "orchestrator agent · reasoning"}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-fg">{text}</p>
      </div>
    </div>
  );
}
