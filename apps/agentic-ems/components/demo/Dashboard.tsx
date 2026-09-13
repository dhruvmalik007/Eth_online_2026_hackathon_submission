"use client";

import * as React from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { allocationsFor, AGENT_UPDATES, STRATEGIES, TICKER, TOTAL_BALANCE } from "@/lib/demo/data";
import type { ForecastPayload, RiskProfile } from "@/lib/demo/data";
import { ForecastFan } from "./ForecastFan";
import { PortfolioFlow } from "./PortfolioFlow";
import { DashboardExecutions } from "./DashboardExecutions";

const fmtB = (v: number) => `$${(v / 1e9).toFixed(2)}B`;

// Static yield curve (2s10s inversion-style, demo props from Metric Lock vocabulary)
const YIELD_CURVE = [1, 2, 3, 5, 7, 10, 20, 30].map((t, i) => ({
  tenor: `${t}Y`,
  onchain: [4.6, 4.4, 4.35, 4.3, 4.28, 4.32, 4.4, 4.5][i],
  tradfi: [4.62, 4.4, 4.3, 4.27, 4.3, 4.38, 4.52, 4.61][i],
}));

// Black-Scholes long-call payoff + premium breakeven (premium 0.4355 per Metric Lock)
const PAYOFF = Array.from({ length: 61 }, (_, i) => {
  const s = 80 + i * 2;
  return { spot: s, pnl: Math.max(0, s - 110) * 100, premium: 0.4355 * 1000 };
});

/**
 * Forecasts arrive as a prop, fetched on the server with `unstable_cache`; the
 * dashboard used to fetch them itself in an effect with `cache: "no-store"`,
 * which meant an empty first paint, five parallel client requests, and a cache
 * that never hit.
 */
export function Dashboard({
  payloads = {},
}: {
  payloads?: Record<string, ForecastPayload>;
}) {
  const risk = "balanced" as RiskProfile;
  const alloc = React.useMemo(() => allocationsFor(risk), [risk]);
  const [selected, setSelected] = React.useState(STRATEGIES[0].id);

  const weightedApy = alloc.reduce((sum, { strategy, pct }) => sum + (strategy.apy * pct) / 100, 0);
  const sel = STRATEGIES.find((s) => s.id === selected)!;
  const selPayload = payloads[selected];

  return (
    <div className="min-h-screen bg-ink">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge bg-panel px-4 py-3">
        <div className="flex items-center gap-4">
          <Link href="/demo" className="font-mono text-xs uppercase tracking-[0.2em] text-fg-dim hover:text-amber">
            ← EMS
          </Link>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
              portfolio-demo-001 · live
            </p>
            <p className="font-mono text-lg font-semibold tabular-nums text-fg">
              ${TOTAL_BALANCE.toLocaleString("en-US")}
              <span className="ml-2 text-xs font-normal text-up">+$342 (+0.34%) today</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
          <span className="border border-up/40 bg-up/10 px-2 py-1 text-up">● 5 agents active</span>
          <span className="border border-edge-2 px-2 py-1 text-fg-dim">safe 0x1C9a…2d51</span>
          <span className="border border-edge-2 px-2 py-1 text-fg-dim">2/2 threshold</span>
        </div>
      </header>

      {/* Ticker strip */}
      <div className="overflow-hidden border-b border-edge bg-panel-2">
        <div className="ticker-mask flex w-max gap-8 px-4 py-1.5" style={{ animation: "marquee 40s linear infinite" }}>
          {[...TICKER, ...TICKER].map((t, i) => (
            <span key={i} className="flex items-center gap-2 font-mono text-[11px] whitespace-nowrap">
              <span className="text-fg">{t.sym}</span>
              <span className={t.up ? "text-up" : "text-down"}>
                {t.apy.toFixed(2)}% {t.up ? "▲" : "▼"}
              </span>
              <span className="text-fg-faint">{t.tvl}</span>
            </span>
          ))}
        </div>
      </div>

      <main className="grid gap-3 p-3 lg:grid-cols-12">
        {/* KPI row */}
        {[
          { label: "NAV (USDC)", value: `$${TOTAL_BALANCE.toLocaleString("en-US")}`, cls: "text-fg" },
          { label: "Blended APY (est)", value: `${weightedApy.toFixed(2)}%`, cls: "text-up" },
          { label: "Portfolio VaR95 (1d)", value: "$1,847", cls: "text-amber" },
          { label: "Duration-equivalent", value: "0.14y", cls: "text-fg" },
        ].map((k) => (
          <div key={k.label} className="border border-edge-2 bg-panel px-4 py-3 lg:col-span-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">{k.label}</p>
            <p className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${k.cls}`}>{k.value}</p>
          </div>
        ))}

        {/* Portfolio flow — every position, NAV → strategy legs */}
        <div className="lg:col-span-12">
          <PortfolioFlow risk={risk} activeNodeId={selected} onNodeSelect={setSelected} />
        </div>

        {/* Allocation donut */}
        <section className="border border-edge-2 bg-panel lg:col-span-4">
          <WidgetHeader title="Allocation by strategy" note="HII 0.18 · HHI pass" />
          <div className="h-56 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={alloc.map(({ strategy, pct }) => ({ name: strategy.label, value: pct, color: strategy.color }))}
                  dataKey="value"
                  innerRadius={50}
                  outerRadius={78}
                  stroke="#0a0b0d"
                  isAnimationActive={false}
                >
                  {alloc.map(({ strategy }) => (
                    <Cell key={strategy.id} fill={strategy.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TIP} formatter={(value, name) => [`${value}%`, String(name)]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-edge px-3 py-2 font-mono text-[10px]">
            {alloc.map(({ strategy, pct, usd }) => (
              <p key={strategy.id} className="flex items-center gap-1.5 text-fg-dim">
                <span className="size-1.5 rounded-full" style={{ background: strategy.color }} />
                {strategy.label.split(" ")[0]} · {pct}% · ${usd.toLocaleString("en-US")}
              </p>
            ))}
          </div>
        </section>

        {/* Selected strategy forecast */}
        <section className="border border-edge-2 bg-panel lg:col-span-5">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
              TimesFM-3 forecast · {sel.label} · 30d
            </p>
            <div className="flex gap-1">
              {STRATEGIES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className={`px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                    selected === s.id ? "bg-amber/15 text-amber" : "text-fg-faint hover:text-fg"
                  }`}
                >
                  {s.id}
                </button>
              ))}
            </div>
          </div>
          <div className="p-2">
            {selPayload ? (
              <ForecastFan payload={selPayload} height={200} color={sel.color} />
            ) : (
              <div className="flex h-[200px] items-center justify-center font-mono text-[11px] text-fg-faint">
                loading forecast…
              </div>
            )}
          </div>
          {selPayload && (
            <p className="border-t border-edge px-3 py-1.5 font-mono text-[10px] text-fg-faint">
              current {fmtB(selPayload.current_tvl)} → median d30 {fmtB(selPayload.forecast_30d[29])} ·
              provenance {selPayload.provenance?.source ?? "data/forecasts"}
            </p>
          )}
        </section>

        {/* Agent status */}
        <section className="border border-edge-2 bg-panel lg:col-span-3">
          <WidgetHeader title="Agent status" note="policy-gated" />
          <div className="divide-y divide-edge">
            {alloc.map(({ strategy, usd }, i) => (
              <div key={strategy.id} className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full" style={{ background: strategy.color }} />
                  <div>
                    <p className="text-xs text-fg">{strategy.agentName}</p>
                    <p className="font-mono text-[9px] text-fg-faint">{strategy.subagent}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[10px] tabular-nums text-up">${usd.toLocaleString("en-US")}</p>
                  <p className="font-mono text-[9px] text-fg-faint">{["proposing", "idle", "monitoring", "proposing", "idle"][i]}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Yield curve */}
        <section className="border border-edge-2 bg-panel lg:col-span-6">
          <WidgetHeader title="Yield curve · on-chain vs TradFi" note="sparklines: llama yields" />
          <div className="h-52 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={YIELD_CURVE} margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
                <CartesianGrid stroke="#1e2126" vertical={false} />
                <XAxis dataKey="tenor" tick={AXIS} tickLine={false} axisLine={{ stroke: "#1e2126" }} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={[4.1, 4.75]} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={TIP} formatter={(v) => `${Number(v).toFixed(2)}%`} />
                <Line type="monotone" dataKey="onchain" name="on-chain" stroke="#16c784" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="tradfi" name="UST curve" stroke="#5f6670" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Option risk curve */}
        <section className="border border-edge-2 bg-panel lg:col-span-6">
          <WidgetHeader title="Option risk curve · hedged perps overlay" note="BSM premium 0.4355" />
          <div className="h-52 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={PAYOFF} margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
                <defs>
                  <linearGradient id="payoff" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ffb300" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#ffb300" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1e2126" vertical={false} />
                <XAxis dataKey="spot" tick={AXIS} tickLine={false} axisLine={{ stroke: "#1e2126" }} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `$${v / 1000}k`} />
                <Tooltip contentStyle={TIP} formatter={(v) => `$${Number(v).toLocaleString("en-US")}`} labelFormatter={(s) => `Spot $${s}`} />
                <Area type="monotone" dataKey="pnl" name="payoff at expiry" stroke="#ffb300" fill="url(#payoff)" strokeWidth={1.5} isAnimationActive={false} />
                <Line type="monotone" dataKey="premium" name="premium outlay" stroke="#ea3943" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Agent activity — live strategy update feed */}
        <section className="border border-edge-2 bg-panel lg:col-span-7">
          <WidgetHeader title="Agent activity · strategy updates" note="propose → PolicyGate → Ledger → execute" />
          <div className="divide-y divide-edge">
            {AGENT_UPDATES.map((u, i) => (
              <div key={i} className="flex items-start gap-3 px-3 py-2.5">
                <span className="mt-1 w-12 shrink-0 font-mono text-[9px] tabular-nums text-fg-faint">{u.ts}</span>
                <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: u.color }} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-[11px] font-semibold text-fg">{u.agent}</span>
                    <span
                      className={`font-mono text-[9px] uppercase tracking-[0.12em] ${
                        u.status === "blocked" ? "text-down" : u.status === "info" ? "text-fg-faint" : "text-up"
                      }`}
                    >
                      {u.status}
                    </span>
                  </p>
                  <p className="text-xs leading-snug text-fg-dim">{u.action}</p>
                  <p className="font-mono text-[10px] text-fg-faint">{u.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Agent workflow stepper */}
        <section className="border border-edge-2 bg-panel lg:col-span-5">
          <WidgetHeader title="Agent execution workflow" note="every leg, every agent" />
          <div className="space-y-2 px-3 py-3">
            {[
              { s: "1 · Propose", d: "Agent encodes leg (vault, size, slippage bound) as EIP-712 proposal", c: "#6747ee" },
              { s: "2 · PolicyGate", d: "Deterministic caps: per-tx, daily, allowlist — rejects before device prompt", c: "#12aab5" },
              { s: "3 · Ledger approve", d: "Clear Signing on device; owner countersigns the Safe digest", c: "#ffb300" },
              { s: "4 · Safe execute", d: "2/2 threshold met → execution via Safe v1.4.1 · tx hash recorded", c: "#16c784" },
              { s: "5 · Reconcile", d: "Fill vs proposal diff, drift check, TimesFM re-forecast on deviation", c: "#ff007a" },
            ].map((step) => (
              <div key={step.s} className="flex items-start gap-2.5 border border-edge-2 bg-ink px-3 py-2">
                <span className="mt-0.5 size-1.5 shrink-0 rounded-full" style={{ background: step.c }} />
                <div>
                  <p className="font-mono text-[11px] text-fg">{step.s}</p>
                  <p className="text-[10px] leading-snug text-fg-dim">{step.d}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Recent executions — durable record of clear-signed runs */}
        <DashboardExecutions />

        {/* Risk meters + recent activity */}
        <section className="border border-edge-2 bg-panel lg:col-span-12">
          <WidgetHeader title="Risk & activity" note="Merton-gated · Almgren-Chriss scheduling" />
          <div className="grid gap-px bg-edge md:grid-cols-4">
            {[
              { k: "VaR95 / VaR99", v: "$1,847 / $2,911", c: "text-amber" },
              { k: "Constraint: β floor", v: "0.60 · satisfied", c: "text-up" },
              { k: "LVR (LP leg)", v: "−0.38 / vol-pt", c: "text-down" },
              { k: "Daily spend used", v: "$8,412 / $100,000", c: "text-fg" },
            ].map((m) => (
              <div key={m.k} className="bg-panel px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">{m.k}</p>
                <p className={`mt-1 font-mono text-sm font-semibold tabular-nums ${m.c}`}>{m.v}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-edge px-4 py-2.5 font-mono text-[10px] leading-relaxed text-fg-faint">
            <p>09:32:14 · lending-agent proposed aave-v3 supply $12,400 → countersigned (ledger) · tx 0x8f2c…a41b</p>
            <p>09:31:47 · lp-agent rebalanced univ4 USDC/ETH range ±8% · tx 0xb204…9ce3</p>
            <p>09:30:02 · policygate blocked perp-agent: proposed $26,000 &gt; per-tx cap $25,000</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-edge px-4 py-3 text-center font-mono text-[10px] text-fg-faint">
        v0.1 demo · market data from DeFiLlama snapshots (data/) + TimesFM-3 forecast shapes · interactions mocked
      </footer>
    </div>
  );
}

const TIP = {
  background: "#14171a",
  border: "1px solid #2a2e35",
  fontFamily: "var(--font-jetbrains)",
  fontSize: 11,
} as const;

const AXIS = { fill: "#5f6670", fontSize: 10, fontFamily: "var(--font-jetbrains)" } as const;

function WidgetHeader({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-edge px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">{title}</p>
      {note && <p className="font-mono text-[9px] text-fg-faint">{note}</p>}
    </div>
  );
}
