"use client";

import * as React from "react";
import { CircleCheck, ExternalLink } from "lucide-react";
import { useDemo } from "@/lib/demo/state";
import { allocationsFor } from "@/lib/demo/data";

export function ExecutingStage({ onPortfolioLive }: { onPortfolioLive?: () => void } = {}) {
  const { state, dispatch } = useDemo();
  const risk = state.answers?.risk ?? "balanced";
  const alloc = React.useMemo(() => allocationsFor(risk), [risk]);
  const [progress, setProgress] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(alloc.map(({ strategy }) => [strategy.id, 0])),
  );
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    if (done && onPortfolioLive) onPortfolioLive();
  }, [done, onPortfolioLive]);

  React.useEffect(() => {
    const t = setInterval(() => {
      setProgress((prev) => {
        const next = { ...prev };
        let all = true;
        for (const { strategy } of alloc) {
          next[strategy.id] = Math.min(100, (prev[strategy.id] ?? 0) + 2 + Math.random() * 4);
          if (next[strategy.id] < 100) all = false;
        }
        if (all) {
          clearInterval(t);
          setDone(true);
        }
        return next;
      });
    }, 260);
    return () => clearInterval(t);
  }, [alloc]);

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="flex items-center gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber">
            agents executing · smart-account deployment
          </p>
          {/* Named plainly because it is one. Fills here are paced client-side, so declaring a
              hash or an execution price would state an on-chain fact that does not exist —
              and a hash is exactly the kind of detail a reviewer would try to verify. */}
          <span className="border border-edge-2 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-fg-faint">
            rehearsal
          </span>
        </div>
        <h1 className="mt-2 text-xl font-semibold">Five agents are deploying capital in parallel</h1>
        <p className="mt-1 text-sm text-fg-dim">
          Each agent proposes legs through the Safe; PolicyGate enforces caps; your Ledger countersigns
          execution.
        </p>

        <div className="mt-6 space-y-3">
          {alloc.map(({ strategy, usd }) => {
            const p = Math.round(progress[strategy.id] ?? 0);
            return (
              <div key={strategy.id} className="border border-edge-2 bg-panel px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="size-2 rounded-full" style={{ background: strategy.color }} />
                    <p className="text-sm text-fg">{strategy.agentName}</p>
                    <p className="font-mono text-[10px] text-fg-faint">
                      deploying ${usd.toLocaleString("en-US")}
                    </p>
                  </div>
                  <span
                    className={`font-mono text-[10px] tabular-nums ${
                      p >= 100 ? "text-up" : "text-fg-dim"
                    }`}
                  >
                    {p >= 100 ? "✓ filled" : `${p}%`}
                  </span>
                </div>
                <div className="mt-2 h-1 w-full bg-edge">
                  <div
                    className="h-1 transition-all"
                    style={{ width: `${p}%`, background: strategy.color }}
                  />
                </div>
                {p >= 100 && (
                  <p className="mt-1.5 font-mono text-[10px] text-fg-faint">
                    rehearsal · no on-chain transaction
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {done && (
          <div className="mt-6 border border-up/50 bg-up/5 p-5 text-center shadow-[0_0_48px_-12px] shadow-up/40" style={{ animation: "hero-line 0.5s ease-out both" }}>
            <CircleCheck className="mx-auto size-6 text-up" />
            <p className="mt-2 text-lg font-semibold text-fg">Portfolio is live</p>
            <p className="mt-1 font-mono text-[11px] text-fg-dim">
              portfolio-demo-001 · $100,000 USDC deployed across 5 agents
            </p>
            <a
              href="/demo/dashboard?portfolio=demo-001"
              className="mt-4 inline-flex items-center gap-2 bg-amber px-5 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-on-amber hover:opacity-90"
            >
              Open dashboard <ExternalLink className="size-3.5" />
            </a>
            <p className="mt-2 font-mono text-[10px] text-fg-faint">
              shareable link: /demo/dashboard?portfolio=demo-001
            </p>
            <button
              onClick={() => dispatch({ type: "restart" })}
              className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint hover:text-amber"
            >
              or restart the demo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
