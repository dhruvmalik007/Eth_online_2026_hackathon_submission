"use client";

import * as React from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Card, CardContent, CardHeader, CardTitle } from "../primitives/card.js";
import { Separator } from "../primitives/separator.js";
import { STATE_DOT, StepPill, type ExecutionStepState } from "./step-pill.js";

/**
 * ExecutionTimeline — granular, per-step progress.
 *
 * The Web3-literate part: a cross-chain step is **not one hash**. Value leaves
 * on a source transaction, sits in flight under a message GUID (a LayerZero GUID,
 * a bridge message id), and lands on a destination transaction. Those are three
 * independently-failing stages and each gets its own line and its own link. A
 * single spinner on a bridge is the thing this component exists to refuse.
 */

export interface ExecutionTracking {
  srcTxHash?: string;
  srcExplorerUrl?: string;
  /** LayerZero GUID or bridge message id. */
  guid?: string;
  /** Cross-chain tracker (LayerZero Scan) — separate from the source explorer. */
  scanUrl?: string;
  dstTxHash?: string;
  dstExplorerUrl?: string;
}

export interface ExecutionStepView {
  id: string;
  label: string;
  /** The clear-signed sentence for this step. */
  intent: string;
  state: ExecutionStepState;
  kind?: string;
  /** e.g. "Base → Optimism" for a bridged step. */
  route?: string;
  tracking?: ExecutionTracking;
  error?: string;
  durationMs?: number;
}

export interface ExecutionTimelineProps extends React.ComponentProps<typeof Card> {
  steps: ExecutionStepView[];
  title?: string;
  /** Announce progress changes to assistive tech. */
  live?: boolean;
}

function shorten(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

function TxLink({ href, hash, label }: { href?: string; hash: string; label: string }) {
  const text = (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] tabular-nums text-fg-dim">
      <span className="text-fg-faint">{label}</span>
      {shorten(hash)}
    </span>
  );
  if (!href) return text;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 font-mono text-[10px] tabular-nums text-fg-dim hover:text-amber"
    >
      <span className="text-fg-faint">{label}</span>
      {shorten(hash)}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

export function ExecutionTimeline({
  className,
  steps,
  title = "Execution",
  live = true,
  ...props
}: ExecutionTimelineProps) {
  const confirmed = steps.filter((step) => step.state === "confirmed").length;

  return (
    <Card className={cn("", className)} {...props}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span>{title}</span>
          <span className="font-mono text-[10px] tabular-nums text-fg-faint">
            {confirmed}/{steps.length} confirmed
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol
          className="space-y-3"
          aria-live={live ? "polite" : undefined}
          aria-relevant="additions text"
        >
          {steps.map((step, index) => {
            const terminal = step.state === "confirmed" || step.state === "failed" || step.state === "skipped";
            const tracking = step.tracking;
            const hasTracking =
              Boolean(tracking) &&
              Boolean(tracking?.srcTxHash || tracking?.guid || tracking?.dstTxHash);

            return (
              <li key={step.id}>
                <div className="flex gap-3">
                  {/* Rail */}
                  <div className="flex flex-col items-center pt-1">
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        STATE_DOT[step.state],
                        step.state === "signing" && "animate-pulse-subtle",
                      )}
                      aria-hidden
                    />
                    {index < steps.length - 1 && <span className="mt-1 w-px flex-1 bg-edge" />}
                  </div>

                  <div className="min-w-0 flex-1 pb-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-fg">{step.label}</span>
                      <StepPill state={step.state} />
                      {step.route ? (
                        <span className="font-mono text-[10px] text-fg-faint">{step.route}</span>
                      ) : null}
                      {terminal && step.durationMs !== undefined ? (
                        <span className="font-mono text-[10px] tabular-nums text-fg-faint">
                          {(step.durationMs / 1000).toFixed(1)}s
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-1 text-[10px] leading-snug text-fg-dim">{step.intent}</p>

                    {hasTracking ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {tracking?.srcTxHash ? (
                          <TxLink href={tracking.srcExplorerUrl} hash={tracking.srcTxHash} label="src" />
                        ) : null}
                        {tracking?.srcTxHash && (tracking?.guid || tracking?.dstTxHash) ? (
                          <ArrowRight className="size-3 text-fg-faint" aria-hidden />
                        ) : null}
                        {tracking?.guid ? (
                          <TxLink href={tracking.scanUrl} hash={tracking.guid} label="msg" />
                        ) : null}
                        {tracking?.guid && tracking?.dstTxHash ? (
                          <ArrowRight className="size-3 text-fg-faint" aria-hidden />
                        ) : null}
                        {tracking?.dstTxHash ? (
                          <TxLink href={tracking.dstExplorerUrl} hash={tracking.dstTxHash} label="dst" />
                        ) : null}
                      </div>
                    ) : null}

                    {step.error ? (
                      <p className="mt-1.5 border border-down/40 bg-down/5 px-2 py-1 text-[10px] leading-snug text-down">
                        {step.error}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {steps.some((step) => step.state === "failed") ? (
          <>
            <Separator className="my-3" />
            <p className="font-mono text-[10px] leading-relaxed text-fg-faint">
              A failed step stops the legs that depend on it. Independent legs continue; the summary
              reports the run as partial rather than complete.
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
