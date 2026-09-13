"use client";

import * as React from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Badge } from "../primitives/badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "../primitives/card.js";
import { Separator } from "../primitives/separator.js";
import type { LiquidityFlowAccent } from "../desk/liquidity-flow.js";

/**
 * IntentReview — the read=sign surface.
 *
 * The product's whole trust claim is that what the user reads and what the
 * wallet signs are the same thing. That is not a slogan: ERC-7730 defines
 * structured-data clear signing with an `interpolatedIntent`, and for batches it
 * specifies concatenating each operation's intent with "and". So this component
 * renders, as a *pair*:
 *
 *   - the aggregated human sentence (the ERC-7730 concatenation), and
 *   - the exact digest the signature will commit to.
 *
 * Each leg is three-level progressive disclosure — sentence → structured detail
 * → the raw typed data — so the claim is checkable at whatever depth the user
 * wants, down to the bytes.
 */

const ACCENT_BAR: Record<LiquidityFlowAccent, string> = {
  amber: "bg-amber",
  up: "bg-up",
  down: "bg-down",
  graph: "bg-graph",
  oneinch: "bg-oneinch",
  uniswap: "bg-uniswap",
  faint: "bg-fg-faint",
};

export interface ReviewLeg {
  id: string;
  label: string;
  accent: LiquidityFlowAccent;
  /** Level 1: the clear-signed sentence. */
  intent: string;
  /** Level 2: structured fields (protocol, chain, amount, bound, route…). */
  detail?: { label: string; value: string }[];
  /** Level 3: the raw payload that will actually be signed. */
  payload?: { label: string; json: string };
  warnings?: string[];
  illustrative?: boolean;
}

export interface ReviewConstraint {
  label: string;
  stated: string;
  quoted: string;
  pass: boolean;
}

export interface IntentReviewProps extends React.ComponentProps<typeof Card> {
  legs: ReviewLeg[];
  /** ERC-7730 batch sentence: "A and B and C". */
  batchIntent: string;
  /** safeTxHash / EIP-5792 digest the signature commits to. */
  batchDigest: string;
  constraints?: ReviewConstraint[];
  mode: "batch" | "per-leg";
  onModeChange: (mode: "batch" | "per-leg") => void;
  simulated?: boolean;
}

function Disclosure({
  summary,
  children,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint hover:text-amber">
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" aria-hidden />
        {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

export function IntentReview({
  className,
  legs,
  batchIntent,
  batchDigest,
  constraints = [],
  mode,
  onModeChange,
  simulated = false,
  ...props
}: IntentReviewProps) {
  return (
    <Card className={cn("", className)} {...props}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span>Review before signing</span>
          {simulated ? <Badge variant="amber">simulated</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Level 0 — the whole batch, as the wallet will show it. */}
        <div className="border border-amber/40 bg-amber/5 px-3 py-2.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber">
            You are signing
          </p>
          <p className="mt-1 text-xs leading-relaxed text-fg">{batchIntent}</p>
          <p className="mt-2 break-all font-mono text-[10px] tabular-nums text-fg-dim">
            <span className="text-fg-faint">digest </span>
            {batchDigest}
          </p>
        </div>

        {constraints.length > 0 ? (
          <div className="space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
              Your constraints
            </p>
            {constraints.map((constraint) => (
              <div
                key={constraint.label}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 border px-3 py-1.5",
                  constraint.pass ? "border-up/40 bg-up/5" : "border-down/50 bg-down/5",
                )}
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
                  {constraint.label}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-fg-faint">
                  you said <span className="text-fg-dim">{constraint.stated}</span> · quoted{" "}
                  <span className={constraint.pass ? "text-up" : "text-down"}>
                    {constraint.quoted}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {/* Per-leg: sentence → detail → raw payload */}
        <div className="space-y-2">
          {legs.map((leg, index) => (
            <div key={leg.id} className="border border-edge-2 bg-panel-2">
              <div className="flex items-start gap-2.5 px-3 py-2.5">
                <span className={cn("mt-1 h-8 w-[3px] shrink-0", ACCENT_BAR[leg.accent])} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] tabular-nums text-fg-faint">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
                      {leg.label}
                    </span>
                    {leg.illustrative ? <Badge variant="outline">illustrative</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-fg">{leg.intent}</p>

                  {leg.warnings?.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {leg.warnings.map((warning) => (
                        <span
                          key={warning}
                          className="inline-flex items-center gap-1 border border-down/50 bg-down/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-down"
                        >
                          <AlertTriangle className="size-3" aria-hidden />
                          {warning}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-2 space-y-2">
                    {leg.detail?.length ? (
                      <Disclosure summary="Detail">
                        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                          {leg.detail.map((row) => (
                            <div key={row.label} className="flex items-center justify-between gap-2">
                              <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-faint">
                                {row.label}
                              </dt>
                              <dd className="font-mono text-[10px] tabular-nums text-fg-dim">
                                {row.value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </Disclosure>
                    ) : null}

                    {leg.payload ? (
                      <Disclosure summary={leg.payload.label}>
                        <pre className="max-h-56 overflow-auto border border-edge bg-ink p-2 font-mono text-[10px] leading-relaxed text-fg-dim">
                          {leg.payload.json}
                        </pre>
                      </Disclosure>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <Separator />

        {/* Signature granularity — batch by default, with a real opt-out. */}
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
            Signature mode
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                {
                  value: "batch" as const,
                  title: "One batch",
                  note: `All ${legs.length} legs in a single MultiSend — one signature, atomic.`,
                },
                {
                  value: "per-leg" as const,
                  title: `Split into ${legs.length}`,
                  note: "Sign each leg separately. Slower, and legs can fail independently.",
                },
              ] as const
            ).map((option) => {
              const active = mode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onModeChange(option.value)}
                  className={cn(
                    "border px-3 py-2.5 text-left transition-colors",
                    active
                      ? "border-amber bg-amber/5"
                      : "border-edge-2 hover:border-amber/60",
                  )}
                >
                  <span
                    className={cn(
                      "block font-mono text-[10px] uppercase tracking-[0.14em]",
                      active ? "text-amber" : "text-fg-dim",
                    )}
                  >
                    {option.title}
                  </span>
                  <span className="mt-1 block text-[10px] leading-snug text-fg-faint">
                    {option.note}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <p className="font-mono text-[10px] leading-relaxed text-fg-faint">
          Clear-signing is rendered per ERC-7730 (structured-data intents); batch calls follow
          EIP-5792. The digest above is what your signature commits to.
        </p>
      </CardContent>
    </Card>
  );
}
