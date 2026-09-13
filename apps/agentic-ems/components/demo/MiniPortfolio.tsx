"use client";

import * as React from "react";
import Link from "next/link";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { fetchForecast } from "@/lib/demo/forecast-client";
import { AGENT_UPDATES, allocationsFor, STRATEGIES } from "@/lib/demo/data";
import type { ForecastPayload, RiskProfile } from "@/lib/demo/data";
import { ForecastFan } from "./ForecastFan";

const TIP = {
  background: "#14171a",
  border: "1px solid #2a2e35",
  fontFamily: "var(--font-jetbrains)",
  fontSize: 11,
} as const;

/** Compact portfolio view rendered inline in the chat once agents deploy. */
export function MiniPortfolio() {
  const risk = "balanced" as RiskProfile;
  const alloc = React.useMemo(() => allocationsFor(risk), [risk]);
  const [payloads, setPayloads] = React.useState<Record<string, ForecastPayload>>({});
  const [selected, setSelected] = React.useState(STRATEGIES[0].id);

  React.useEffect(() => {
    (async () => {
      const results: Record<string, ForecastPayload> = {};
      await Promise.all(
        STRATEGIES.map(async (s) => {
          try {
            results[s.id] = await fetchForecast(s.forecastKey);
          } catch {}
        }),
      );
      setPayloads(results);
    })();
  }, []);

  const sel = STRATEGIES.find((s) => s.id === selected)!;
  const selPayload = payloads[selected];

  return (
    <div className="border border-amber/50 bg-panel">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber">
          portfolio-demo-001 · live · rendered in-canvas
        </p>
        <Link
          href="/demo/dashboard"
          className="border border-edge-2 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim hover:border-amber/60 hover:text-amber"
        >
          Full portfolio ↗
        </Link>
      </div>

      <div className="grid gap-px bg-edge md:grid-cols-2">
        {/* Allocation */}
        <div className="bg-panel">
          <p className="px-3 pt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
            allocation · $100,000 USDC
          </p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={alloc.map(({ strategy, pct }) => ({ name: strategy.label, value: pct, color: strategy.color }))}
                  dataKey="value"
                  innerRadius={38}
                  outerRadius={60}
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
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 px-3 pb-2 font-mono text-[9px]">
            {alloc.map(({ strategy, pct, usd }) => (
              <p key={strategy.id} className="flex items-center gap-1 text-fg-dim">
                <span className="size-1.5 rounded-full" style={{ background: strategy.color }} />
                {strategy.label.split(" ")[0]} · {pct}% · ${usd.toLocaleString("en-US")}
              </p>
            ))}
          </div>
        </div>

        {/* Selected strategy forecast */}
        <div className="bg-panel">
          <div className="flex items-center justify-between px-3 pt-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
              TimesFM-3 · {sel.label} · 30d
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
          {selPayload ? (
            <ForecastFan payload={selPayload} height={140} color={sel.color} />
          ) : (
            <div className="flex h-[140px] items-center justify-center font-mono text-[10px] text-fg-faint">
              loading forecast…
            </div>
          )}
        </div>
      </div>

      {/* Agent activity */}
      <div className="border-t border-edge">
        <p className="px-3 pt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
          agent activity · propose → policygate → ledger → execute
        </p>
        <div className="divide-y divide-edge">
          {AGENT_UPDATES.slice(0, 4).map((u, i) => (
            <div key={i} className="flex items-start gap-2.5 px-3 py-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: u.color }} />
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-semibold text-fg">
                  {u.agent}{" "}
                  <span
                    className={`ml-1 font-normal uppercase tracking-[0.12em] ${
                      u.status === "blocked" ? "text-down" : u.status === "info" ? "text-fg-faint" : "text-up"
                    }`}
                  >
                    {u.status}
                  </span>
                </p>
                <p className="text-[11px] leading-snug text-fg-dim">{u.action}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
