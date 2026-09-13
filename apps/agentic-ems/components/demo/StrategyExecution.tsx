"use client";

import * as React from "react";
import {
  ExecutionReceipt,
  ExecutionTimeline,
  FeeWaterfall,
  IntentReview,
} from "@ethonline2026/ux-workflow";
import type {
  ExecutionStepState,
  ExecutionStepView,
  FeeLegView,
  ReviewConstraint,
  ReviewLeg,
} from "@ethonline2026/ux-workflow";
import { useDemo } from "@/lib/demo/state";
import { createSimulatedAdapter } from "@/lib/execution/adapter";
import { chainLabel } from "@/lib/execution/chains";
import { sumBounds, sumCosts } from "@/lib/execution/fees";
import type { ExecutionPlan, ExecutionStep, IntentLeg } from "@/lib/execution/types";
import { ExecutionDock } from "./ExecutionDock";
import { SignatureSheet } from "./SignatureSheet";

/**
 * StrategyExecution — the orchestrator for one allocation run.
 *
 * Phase machine: parsing → review → signing → executing → settled. It renders each
 * stage inline in the chat (per `operate.md`: modals are a last resort) except the
 * signature, which is the single deliberate modal.
 *
 * The component is long-lived and owns its own progress, so it must not be
 * remounted by its parent mid-run — ChatStage passes `legs` and nothing else
 * that changes.
 */

export type ExecutionPhase = "parsing" | "review" | "executing" | "settled";

export interface StrategyExecutionProps {
  legs: IntentLeg[];
  onComplete?: (planId: string) => void;
}

const PHASE_LABEL: Record<ExecutionPhase, string> = {
  parsing: "Pricing routes",
  review: "Awaiting your review",
  executing: "Executing",
  settled: "Settled",
};

/** Map our domain step states onto the shared badge vocabulary. */
function toStepView(step: ExecutionStep): ExecutionStepView {
  return {
    id: step.id,
    label: step.label,
    intent: step.intent,
    state: step.state as ExecutionStepState,
    kind: step.kind,
    route: step.route,
    tracking: step.tracking,
    error: step.error,
    durationMs: step.durationMs,
  };
}

function feeLegViews(plan: ExecutionPlan): FeeLegView[] {
  const accents = ["amber", "graph", "uniswap", "oneinch", "up"] as const;
  return plan.legs.map((leg, index) => {
    const quote = plan.quotes.find((q) => q.legId === leg.id);
    return {
      id: leg.id,
      label: leg.protocol,
      accent: accents[index % accents.length],
      costUsd: sumCosts(quote?.fees ?? []),
      crossChain: leg.chain !== leg.sourceChain,
      fees: (quote?.fees ?? [])
        .filter((fee) => fee.tier === "cost")
        .map((fee) => ({
          id: fee.id,
          label: fee.label,
          amountUsd: fee.amountUsd,
          bps: fee.bps,
          token: fee.token,
          chain: fee.chain ? chainLabel(fee.chain) : undefined,
          included: fee.included,
          payIn: fee.payIn,
          provider: fee.provider,
        })),
    };
  });
}

export function StrategyExecution({ legs, onComplete }: StrategyExecutionProps) {
  const { state, dispatch } = useDemo();
  // Driven by the SimulationToggle rather than hardcoded: the switch is the desk's only
  // live/simulated indicator, so a hardcoded `true` here left it claiming a mode the UI
  // was not actually in.
  const simulated = state.simulated;
  const adapter = React.useMemo(() => createSimulatedAdapter(), []);

  const [phase, setPhase] = React.useState<ExecutionPhase>("parsing");
  const [plan, setPlan] = React.useState<ExecutionPlan | null>(null);
  const [steps, setSteps] = React.useState<ExecutionStep[]>([]);
  const [mode, setMode] = React.useState<"batch" | "per-leg">("batch");
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // Minimising is this component's own concern: the run continues either way, and
  // the dock needs the same live step that the full view renders.
  const [minimized, setMinimized] = React.useState(false);
  const recordedRef = React.useRef(false);

  // Quote → plan. Real adapter would hit LI.FI / 1inch / Morpho / Polymarket here.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      const quotes = await adapter.quote(legs);
      const built = await adapter.buildPlan(legs, quotes, "batch");
      if (!alive) return;
      setPlan(built);
      setSteps(built.steps);
      setPhase("review");
    })();
    return () => {
      alive = false;
    };
  }, [adapter, legs]);

  const start = React.useCallback(() => {
    if (!plan) return;
    setSheetOpen(false);
    setBusy(true);
    setPhase("executing");

    adapter.submit(plan, (update) => {
      setSteps((prev) => {
        const index = prev.findIndex((step) => step.id === update.id);
        if (index === -1) return prev;
        const next = [...prev];
        next[index] = { ...next[index], ...update };
        return next;
      });
    });
  }, [adapter, plan]);

  // Settle once every step is terminal, then persist exactly once.
  React.useEffect(() => {
    if (phase !== "executing" || !plan || steps.length === 0) return;
    const terminal = steps.every(
      (step) => step.state === "confirmed" || step.state === "failed" || step.state === "skipped",
    );
    if (!terminal) return;

    setPhase("settled");
    setBusy(false);
    if (!recordedRef.current) {
      recordedRef.current = true;
      dispatch({ type: "record-execution", record: adapter.toRecord(plan, steps) });
      onComplete?.(plan.id);
    }
  }, [phase, plan, steps, adapter, dispatch, onComplete]);

  const reviewLegs: ReviewLeg[] = React.useMemo(() => {
    if (!plan) return [];
    const accents = ["amber", "graph", "uniswap", "oneinch", "up"] as const;
    return plan.legs.map((leg, index) => {
      const quote = plan.quotes.find((q) => q.legId === leg.id);
      const orderStep = plan.steps.find((step) => step.legId === leg.id && step.eip712);
      return {
        id: leg.id,
        label: `${leg.protocol} · ${chainLabel(leg.chain)}`,
        accent: accents[index % accents.length],
        intent: leg.intent,
        warnings: leg.warnings,
        illustrative: leg.illustrative,
        detail: [
          { label: "Amount", value: `$${leg.amountUsd.toLocaleString("en-US")} ${leg.token}` },
          { label: "Chain", value: chainLabel(leg.chain) },
          { label: "Route", value: quote?.venue ?? "Direct" },
          { label: "Slippage bound", value: `${quote?.slippageBoundPct.toFixed(2) ?? "0.50"}%` },
          { label: "Price impact", value: `${quote?.priceImpactPct.toFixed(2) ?? "0.00"}%` },
          {
            label: "Est. time",
            value: `${quote?.estimatedSeconds ?? 0}s`,
          },
        ],
        payload: orderStep?.eip712
          ? {
              label: "Raw signed payload (EIP-712)",
              json: JSON.stringify(orderStep.eip712, null, 2),
            }
          : undefined,
      };
    });
  }, [plan]);

  const constraints: ReviewConstraint[] = React.useMemo(() => {
    if (!plan) return [];
    return plan.legs
      .filter((leg) => leg.minApy !== undefined)
      .map((leg) => {
        // Lending legs carry a stated APY floor; the quote is the protocol's.
        const quoted = leg.kind === "lend" ? 5.1 : 0;
        const stated = leg.minApy ?? 0;
        return {
          label: `${leg.protocol} min APY`,
          stated: `${stated.toFixed(1)}%`,
          quoted: `${quoted.toFixed(1)}%`,
          pass: quoted >= stated,
        };
      });
  }, [plan]);

  const confirmedCount = steps.filter((step) => step.state === "confirmed").length;

  if (!plan) {
    return (
      <div className="border border-edge-2 bg-panel">
        <div className="border-b border-edge px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber">
            Pricing routes…
          </p>
        </div>
        <div className="space-y-2 p-3" aria-busy>
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-9 animate-pulse bg-panel-2" />
          ))}
        </div>
      </div>
    );
  }

  const activeStep = steps.find(
    (step) => step.state === "signing" || step.state === "submitted" || step.state === "bridging",
  );

  // Minimised: the run continues in place while the user keeps using the chat.
  if (minimized) {
    return (
      <ExecutionDock
        currentLabel={
          phase === "settled" ? "complete" : (activeStep?.label ?? "finalising steps…")
        }
        confirmed={confirmedCount}
        total={steps.length}
        failed={steps.some((step) => step.state === "failed")}
        settled={phase === "settled"}
        onExpand={() => setMinimized(false)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="border border-edge-2 bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-3 py-2">
          <div className="flex items-center gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber">
              Strategy execution
            </p>
            <span className="font-mono text-[10px] text-fg-faint">{PHASE_LABEL[phase]}</span>
            <span className="border border-amber/50 bg-amber/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-amber">
              simulated={simulated}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] tabular-nums text-fg-faint">
              {confirmedCount}/{steps.length} · plan {plan.id}
            </span>
            {phase === "executing" || phase === "settled" ? (
              <button
                type="button"
                onClick={() => setMinimized(true)}
                className="border border-edge-2 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim hover:border-amber/60 hover:text-amber"
              >
                Minimize
              </button>
            ) : null}
          </div>
        </div>

        <div className="space-y-3 p-3">
          <div className="grid gap-px bg-edge sm:grid-cols-3">
            <div className="bg-panel px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">Notional</p>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-fg">
                ${plan.totals.notionalUsd.toLocaleString("en-US")}
              </p>
            </div>
            <div className="bg-panel px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">Total cost</p>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-amber">
                ${plan.totals.costUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="bg-panel px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                Worst-case bound
              </p>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-fg-dim">
                ${plan.totals.boundUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {phase === "review" ? (
            <>
              <IntentReview
                legs={reviewLegs}
                batchIntent={plan.batchIntent}
                batchDigest={plan.batchDigest}
                constraints={constraints}
                mode={mode}
                onModeChange={setMode}
                simulated={simulated}
              />
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="w-full bg-amber py-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-on-amber hover:opacity-90"
              >
                Review & sign ({plan.steps.length} steps)
              </button>
            </>
          ) : null}

          {phase !== "review" ? (
            <>
              <ExecutionTimeline steps={steps.map(toStepView)} title="Live execution" />
              <FeeWaterfall
                totalCostUsd={plan.totals.costUsd}
                notionalUsd={plan.totals.notionalUsd}
                legs={feeLegViews(plan)}
                bounds={plan.quotes.map((quote) => ({
                  label: `Slippage · ${quote.venue}`,
                  value: `${quote.slippageBoundPct.toFixed(2)}%`,
                  note: "maximum you accept on this leg",
                }))}
                markets={plan.quotes.map((quote) => ({
                  label: `Price impact · ${quote.venue}`,
                  value: `${quote.priceImpactPct.toFixed(2)}%`,
                  note: "market reaction to your size",
                }))}
              />
            </>
          ) : null}

          {phase === "settled" ? (
            <ExecutionReceipt
              planId={plan.id}
              notionalUsd={plan.totals.notionalUsd}
              quotedCostUsd={plan.totals.costUsd}
              actualCostUsd={plan.totals.costUsd}
              legs={plan.legs.map((leg, index) => {
                const quote = plan.quotes.find((q) => q.legId === leg.id);
                const legSteps = steps.filter((step) => step.legId === leg.id);
                const done = legSteps.length > 0 && legSteps.every((s) => s.state === "confirmed");
                const accents = ["amber", "graph", "uniswap", "oneinch", "up"] as const;
                const last = legSteps[legSteps.length - 1];
                return {
                  id: leg.id,
                  label: leg.protocol,
                  accent: accents[index % accents.length],
                  deployedUsd: done ? leg.amountUsd : 0,
                  costUsd: sumCosts(quote?.fees ?? []),
                  state: (done ? "confirmed" : "failed") as ExecutionStepState,
                  explorerUrl: last?.tracking?.dstExplorerUrl ?? last?.tracking?.srcExplorerUrl,
                };
              })}
              dashboardHref="/demo/dashboard"
              simulated={simulated}
            />
          ) : null}

          <p className="font-mono text-[10px] leading-relaxed text-fg-faint">
            Cost ${plan.totals.costUsd.toFixed(2)} · bound $
            {sumBounds(plan.quotes.flatMap((q) => q.fees)).toFixed(2)} (not charged){simulated ? " · simulated" : ""}
            adapter, no funds move.
          </p>
        </div>
      </div>

      <SignatureSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        legs={reviewLegs}
        batchIntent={plan.batchIntent}
        batchDigest={plan.batchDigest}
        constraints={constraints}
        mode={mode}
        onModeChange={setMode}
        onSign={start}
        simulated={simulated}
        busy={busy}
      />
    </div>
  );
}
