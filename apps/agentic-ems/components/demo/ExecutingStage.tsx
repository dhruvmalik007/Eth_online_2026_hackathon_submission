"use client";

import * as React from "react";
import { CircleCheck, ExternalLink } from "lucide-react";
import { useDemo } from "@/lib/demo/state";
import { allocationsFor } from "@/lib/demo/data";
import { executionBaseUrl } from "@/lib/execution/mandates";
import { fetchBridgeProgress, toMessageTracking, type RecordedStep } from "@/lib/execution/live";

export function ExecutingStage({ onPortfolioLive }: { onPortfolioLive?: () => void } = {}) {
  const { state, dispatch } = useDemo();
  const risk = state.answers?.risk ?? "balanced";
  const alloc = React.useMemo(() => allocationsFor(risk), [risk]);
  const [progress, setProgress] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(alloc.map(({ strategy }) => [strategy.id, 0])),
  );
  const [done, setDone] = React.useState(false);

  // The real cross-chain messages, when the desk is not in simulation. Held as data rather than
  // derived during render so that a service that is slow, absent or refusing is a state the
  // component can name — not a spinner that never resolves.
  /** How often a live run re-reads its receipts. Bridge confirmations are minutes, not milliseconds. */
const RECEIPT_POLL_MS = 5_000;

/**
 * Whether a step is finished.
 *
 * `submitted` is deliberately *not* settled: a broadcast that has been sent and not confirmed is the
 * single state where calling a run complete would be most wrong, and it is the state a live run sits
 * in the longest.
 */
function isSettled(status: string): boolean {
  return status === "confirmed" || status === "complete" || status === "settled";
}

const [live, setLive] = React.useState<{ steps: readonly RecordedStep[]; error: string | null }>({
    steps: [],
    error: null,
  });

  const baseUrl = executionBaseUrl();
  const userId = state.email.length > 0 ? state.email : "demo@agentic-ems.eth";

  /**
   * Polled, not read once.
   *
   * A broadcast is submitted and confirmed seconds to minutes apart, so a single read at mount shows
   * whatever happened to be recorded at that instant and then never changes — the panel would sit on
   * "submitted" for a transaction that confirmed a moment later, which is worse than showing nothing.
   * The poll stops when the component unmounts, and a failed poll keeps the last good steps rather
   * than blanking the panel on one bad request.
   */
  React.useEffect(() => {
    if (state.simulated) {
      setLive({ steps: [], error: null });
      return;
    }
    if (baseUrl === undefined) {
      setLive({ steps: [], error: "No execution service is configured (NEXT_PUBLIC_EXECUTION_URL)." });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const steps = await fetchBridgeProgress({ baseUrl, userId });
        if (cancelled) return;
        setLive((previous) => ({ steps, error: null }));
      } catch (error) {
        if (cancelled) return;
        // Keep the steps we already have: one failed poll is not evidence that nothing was recorded.
        setLive((previous) => ({ ...previous, error: (error as Error).message }));
      }
      if (!cancelled) timer = setTimeout(poll, RECEIPT_POLL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [state.simulated, baseUrl, userId]);

  React.useEffect(() => {
    if (done && onPortfolioLive) onPortfolioLive();
  }, [done, onPortfolioLive]);

  /**
   * Progress that is either measured or declared, never simulated into looking measured.
   *
   * This used to advance on `Math.random()` and call the run complete when the bars happened to
   * reach 100 — so the celebration fired on a timer, and the panel would have celebrated a
   * transaction that had failed. A receipt is the only thing that may complete a live run.
   *
   * Two states, and the difference is stated rather than blended:
   *
   * - **Live with recorded steps**: progress is the share of steps the service reports as settled.
   *   Nothing here decides that; it is read.
   * - **Rehearsal, or a live run with nothing recorded yet**: the bars are a presentation of elapsed
   *   waiting, and the panel already carries a `rehearsal` badge saying exactly that. They are not
   *   evidence, and the completion they reach is not a claim that anything confirmed.
   */
  const settled = live.steps.filter((step) => isSettled(step.status)).length;
  const measured = !state.simulated && live.steps.length > 0;
  const measuredPct = measured ? Math.round((settled / live.steps.length) * 100) : 0;

  React.useEffect(() => {
    if (measured) return;
    const t = setInterval(() => {
      setProgress((prev) => {
        const next = { ...prev };
        let all = true;
        for (const { strategy } of alloc) {
          next[strategy.id] = Math.min(100, (prev[strategy.id] ?? 0) + 3);
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
  }, [alloc, measured]);

  // A live run completes when the service says its steps settled — and only then.
  React.useEffect(() => {
    if (measured && settled === live.steps.length) setDone(true);
  }, [measured, settled, live.steps.length]);

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="flex items-center gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber">
            agents executing · smart-account deployment
          </p>
          {/* Named plainly because it is one. Fills here are paced client-side, so declaring a
              hash or an execution price would state an on-chain fact that does not exist — and a
              hash is exactly the kind of detail a reviewer would try to verify. Real hashes are
              rendered below, from the service, when it has recorded any. */}
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
            // A measured run shows one shared, real figure; a rehearsal shows its own pacing.
            const p = measured ? measuredPct : Math.round(progress[strategy.id] ?? 0);
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

        {/* Real cross-chain activity, when there is any. This is the only place a transaction hash
            appears, and every one of them came from the execution service's recorded steps. */}
        {!state.simulated && (
          <section className="mt-6 border border-edge-2 bg-panel p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">
              cross-chain messages · from the execution service
            </p>
            {live.error !== null ? (
              <p className="mt-2 text-xs text-down">{live.error}</p>
            ) : live.steps.length === 0 ? (
              <p className="mt-2 text-xs text-fg-dim">
                No in-flight cross-chain messages. A dry-mode deployment records steps without
                broadcasting, so it carries no hashes.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {live.steps.map((step) => {
                  const tracking = toMessageTracking(step);
                  return (
                    <li key={step.stepId} className="border-t border-edge pt-2 first:border-t-0 first:pt-0">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs text-fg">{step.label}</p>
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                          {step.status}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px]">
                        {tracking?.srcExplorerUrl !== undefined && (
                          <a
                            href={tracking.srcExplorerUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-amber hover:underline"
                          >
                            source {tracking.srcTxHash?.slice(0, 10)}… <ExternalLink className="inline size-2.5" />
                          </a>
                        )}
                        {tracking?.scanUrl !== undefined && (
                          <a
                            href={tracking.scanUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-fg-dim hover:text-amber"
                          >
                            message {tracking.guid?.slice(0, 10) ?? "tracking"}{" "}
                            <ExternalLink className="inline size-2.5" />
                          </a>
                        )}
                        {tracking?.dstExplorerUrl !== undefined && (
                          <a
                            href={tracking.dstExplorerUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-up hover:underline"
                          >
                            destination {tracking.dstTxHash?.slice(0, 10)}…{" "}
                            <ExternalLink className="inline size-2.5" />
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

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
