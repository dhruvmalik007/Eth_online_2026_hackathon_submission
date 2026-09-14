"use client";

import * as React from "react";
import { Check, X } from "lucide-react";
import { useDemo } from "@/lib/demo/state";
import { allocationsFor } from "@/lib/demo/data";
import { useNav } from "@/lib/portfolio/context";
import { formatAllocUsd } from "@/lib/portfolio/nav";

export function ApprovalsStage({ onNext }: { onNext?: () => void }) {
  const { state, dispatch } = useDemo();
  const risk = state.answers?.risk ?? "balanced";
  const { nav } = useNav();
  const alloc = React.useMemo(() => allocationsFor(risk, nav.pricedUsd), [risk, nav.pricedUsd]);
  const approved = new Set(state.approved);
  const [rejected, setRejected] = React.useState<Set<string>>(new Set());
  const allApproved = approved.size === alloc.length;

  const approveAll = () => {
    for (const { strategy } of alloc) dispatch({ type: "approve", id: strategy.id });
  };

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto px-4 py-10">
      <div className="w-full max-w-2xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber">
          human-in-the-loop · per-agent spend approval
        </p>
        <h1 className="mt-2 text-xl font-semibold">Grant each agent its spending authority</h1>
        <p className="mt-1 text-sm text-fg-dim">
          Each strategy runs its own LangChain agent connected to your Safe. Approving provisions a spend
          cap — the agent can <em>propose</em> up to this amount; execution still requires your Ledger.
        </p>

        <div className="mt-6 space-y-3">
          {alloc.map(({ strategy, pct, usd }) => {
            const isApproved = approved.has(strategy.id);
            const isRejected = rejected.has(strategy.id);
            return (
              <div
                key={strategy.id}
                className={`border bg-panel p-4 transition-all ${
                  isApproved ? "border-up/50" : "border-edge-2"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="size-2.5 rounded-full" style={{ background: strategy.color }} />
                    <div>
                      <p className="text-sm font-medium text-fg">
                        Grant <span className="text-amber">{strategy.agentName}</span> authority to deploy{" "}
                        <span className="font-mono tabular-nums text-amber">
                          {formatAllocUsd(usd)}
                        </span>{" "}
                        <span className="font-mono text-xs text-fg-dim">({pct}%)</span>
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-fg-faint">
                        into {strategy.label.toLowerCase()} · {strategy.protocols.join(" + ")} · VaR95{" "}
                        {strategy.var95}
                      </p>
                    </div>
                  </div>
                  {isApproved ? (
                    <span className="flex items-center gap-1.5 border border-up/40 bg-up/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-up">
                      <Check className="size-3.5" /> approved · cap provisioned via Safe
                    </span>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => dispatch({ type: "approve", id: strategy.id })}
                        className="flex items-center gap-1 border border-up/40 bg-up/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-up hover:bg-up/20"
                      >
                        <Check className="size-3.5" /> approve
                      </button>
                      <button
                        onClick={() => setRejected((prev) => new Set(prev).add(strategy.id))}
                        className="flex items-center gap-1 border border-edge-2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim hover:border-down/50 hover:text-down"
                      >
                        <X className="size-3.5" /> reject
                      </button>
                    </div>
                  )}
                </div>
                {isRejected && !isApproved && (
                  <p className="mt-2 font-mono text-[10px] text-down">
                    rejected — {formatAllocUsd(usd)} stays unallocated
                  </p>
                )}
                {isApproved && (
                  <p className="mt-2 font-mono text-[10px] text-fg-faint">
                    policygate: per-tx ≤ {formatAllocUsd(usd === null ? null : usd / 2)} · daily ≤
                    {formatAllocUsd(usd)} · recipients: {strategy.protocols[0].toLowerCase()}-vaults
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-between border border-edge-2 bg-panel px-4 py-3">
          <p className="font-mono text-[11px] tabular-nums text-fg-dim">
            {approved.size}/{alloc.length} approved · $
            {alloc
              .filter(({ strategy }) => approved.has(strategy.id))
              .reduce((sum, { usd }) => sum + (usd ?? 0), 0)
              .toLocaleString("en-US")}{" "}
            of $100,000 provisioned
          </p>
          {allApproved ? (
            <button
              onClick={() =>
                onNext ? onNext() : dispatch({ type: "set-stage", stage: "executing" })
              }
              className="bg-amber px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-on-amber hover:opacity-90"
            >
              Deploy agents →
            </button>
          ) : (
            <button
              onClick={approveAll}
              className="border border-amber/60 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-amber hover:bg-amber/10"
            >
              Approve all
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
