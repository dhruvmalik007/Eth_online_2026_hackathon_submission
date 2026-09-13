"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IntentReview,
} from "@ethonline2026/ux-workflow";
import type { ReviewConstraint, ReviewLeg } from "@ethonline2026/ux-workflow";

/**
 * The signing boundary.
 *
 * `operate.md` treats a modal as a last resort, and everything else in this flow
 * is inline for that reason. This is the deliberate exception: authorising an
 * irreversible batch is the one moment that deserves a single, unambiguous,
 * focused decision — so it gets a real dialog with a focus trap and escape-to-cancel
 * (Radix Dialog), rather than a panel the user can scroll past.
 */

export interface SignatureSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  legs: ReviewLeg[];
  batchIntent: string;
  batchDigest: string;
  constraints?: ReviewConstraint[];
  mode: "batch" | "per-leg";
  onModeChange: (mode: "batch" | "per-leg") => void;
  onSign: () => void;
  simulated?: boolean;
  busy?: boolean;
}

export function SignatureSheet({
  open,
  onOpenChange,
  legs,
  batchIntent,
  batchDigest,
  constraints,
  mode,
  onModeChange,
  onSign,
  simulated = true,
  busy = false,
}: SignatureSheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogTitle className="font-mono text-sm uppercase tracking-[0.16em] text-fg">
          Authorise execution
        </DialogTitle>
        <DialogDescription className="text-xs text-fg-dim">
          {simulated
            ? "Simulated run — nothing is broadcast. The payload below is the real shape that would be signed."
            : "Review the payload, then sign to execute the batch."}
        </DialogDescription>

        <IntentReview
          className="border-0 bg-transparent"
          legs={legs}
          batchIntent={batchIntent}
          batchDigest={batchDigest}
          constraints={constraints}
          mode={mode}
          onModeChange={onModeChange}
          simulated={simulated}
        />

        <div className="flex flex-col-reverse gap-2 border-t border-edge pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[10px] leading-relaxed text-fg-faint">
            {mode === "batch"
              ? `One signature authorises all ${legs.length} legs (MultiSend).`
              : `You will sign ${legs.length} times — one per leg.`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="border border-edge-2 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim hover:border-amber/60 hover:text-amber"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSign}
              disabled={busy}
              className="bg-amber px-5 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-on-amber hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "Executing…" : mode === "batch" ? "Sign & execute" : "Sign first leg"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
