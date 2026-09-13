"use client";

/**
 * The 1inch Aqua/SwapVM panel — shown at the simulation stage and again at approval.
 *
 * ## Why one component for two stages
 *
 * The brief's requirement is that the efficiency is *mentioned* when a run is simulated and again
 * when it is approved. Two components would be two chances to format the same number differently,
 * and the number is the whole argument. So this takes `assessment` as a prop rather than deriving
 * anything: whoever computed it once owns it, and both stages render the same figure.
 *
 * ## What it must never do
 *
 * **Imply rather than state that the venue is on.** A run executing through 1inch while the panel
 * merely omits a "disabled" affordance is a run nobody can account for afterwards, so the enabled
 * state is an explicit badge and the live state is an explicit rail.
 *
 * **Hide a negative delta.** An efficiency below zero means Aqua is *worse*. Rendering it as `0` or
 * as `—` would turn a measured loss into an absence, which is the one reading nobody would question.
 *
 * **Offer consent the caller is not entitled to give.** When the mandate keeps consent with the
 * user, the control says so rather than being a switch that silently does nothing.
 */

import * as React from "react";
import { cn } from "../lib/utils.js";
import { Badge } from "../primitives/badge.js";
import { Button } from "../primitives/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../primitives/card.js";
import { Separator } from "../primitives/separator.js";
import { Switch } from "../primitives/switch.js";
import { StepPill, isTerminal, type ExecutionStepState } from "./step-pill.js";

/**
 * Mirrors `EnablementAssessment` in `@ethonline2026/oneinch-aqua`.
 *
 * Restated rather than imported so this package keeps its single React peer dependency and stays
 * buildable without the execution stack. The cost is that the two must be changed together, so the
 * closed sets below are deliberately exhaustive — a new recommendation upstream fails
 * `RECOMMENDATION_META`'s `Record` check rather than rendering as a blank chip.
 */
export type AquaRecommendation = "unavailable" | "enabled" | "not_worthwhile" | "recommend";

export interface AquaEnablementAssessment {
  readonly chain: string;
  readonly recommendation: AquaRecommendation;
  /** Measured, and may be negative. */
  readonly efficiencyBps: number;
  readonly consentRequired: boolean;
  readonly consentGranter: "user" | "user-or-agent";
  readonly detail: string;
}

export interface AquaFlightStep {
  readonly id: string;
  readonly label: string;
  readonly state: ExecutionStepState;
}

export interface AquaFlightPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly assessment: AquaEnablementAssessment;
  /** Which stage is rendering. Changes the emphasis, never the numbers. */
  readonly stage: "simulation" | "approval";
  /** Whether the venue is on for this run right now. */
  readonly enabled: boolean;
  /** Absent when the viewer may not decide — the control renders disabled with the reason. */
  readonly onConsent?: (enabled: boolean) => void;
  /** Live steps, once a run is under way. */
  readonly steps?: readonly AquaFlightStep[];
  /** True while the agent, rather than a person, is expected to act. */
  readonly agentMayAct?: boolean;
}

const RECOMMENDATION_META: Record<AquaRecommendation, { label: string; variant: "oneinch" | "up" | "secondary" | "outline" }> = {
  unavailable: { label: "not available", variant: "outline" },
  enabled: { label: "enabled", variant: "up" },
  not_worthwhile: { label: "not worth it", variant: "secondary" },
  recommend: { label: "recommended", variant: "oneinch" },
};

/** Basis points as a percentage, always signed so a loss cannot read as a tie. */
export function formatEfficiency(efficiencyBps: number): string {
  const sign = efficiencyBps > 0 ? "+" : "";
  return `${sign}${(efficiencyBps / 100).toFixed(2)}%`;
}

export function AquaFlightPanel({
  assessment,
  stage,
  enabled,
  onConsent,
  steps,
  agentMayAct = false,
  className,
  ...props
}: AquaFlightPanelProps) {
  const meta = RECOMMENDATION_META[assessment.recommendation];
  const live = (steps ?? []).some((step) => !isTerminal(step.state));
  const bound = (steps ?? []).some((step) => step.state === "confirmed");
  const canDecide = assessment.consentRequired && onConsent !== undefined && !enabled;

  return (
    <Card
      className={cn("border-oneinch/40", live && "ring-1 ring-oneinch/30", className)}
      data-stage={stage}
      data-enabled={enabled}
      {...props}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {/* Stated, not implied. An executing run must be attributable at a glance. */}
          <Badge variant="oneinch">1inch Aqua</Badge>
          <span className="font-mono text-sm text-fg-dim">{assessment.chain}</span>
          {live ? (
            <Badge variant="amber">executing</Badge>
          ) : bound ? (
            <Badge variant="up">settled</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {stage === "simulation"
            ? "What routing through the SwapVM venue would buy, compared with the standard route."
            : "The same measurement, for approval. Approving enables it for this run only."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-3">
          <span
            className={cn(
              "font-mono text-2xl tabular-nums",
              assessment.efficiencyBps > 0 && "text-up",
              assessment.efficiencyBps < 0 && "text-down",
              assessment.efficiencyBps === 0 && "text-fg-dim",
            )}
          >
            {formatEfficiency(assessment.efficiencyBps)}
          </span>
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </div>

        <p className="text-sm text-fg-dim">{assessment.detail}</p>

        <Separator />

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {enabled ? "Routing through Aqua" : "Routing through the standard path"}
            </p>
            <p className="text-xs text-fg-faint">
              {!assessment.consentRequired
                ? "Nothing to decide."
                : assessment.consentGranter === "user-or-agent"
                  ? "The delta clears the mandate's bar, so the agent may enable this on its own."
                  : "The mandate keeps this decision with an operator."}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {agentMayAct && assessment.consentGranter === "user-or-agent" && !enabled ? (
              <span className="text-xs text-oneinch">agent may proceed</span>
            ) : null}
            <Switch
              checked={enabled}
              disabled={!canDecide}
              aria-label={`Route through 1inch Aqua on ${assessment.chain}`}
              onCheckedChange={(next) => onConsent?.(next === true)}
            />
          </div>
        </div>

        {!canDecide && assessment.consentRequired && !enabled ? (
          // A disabled control with no reason is indistinguishable from a bug.
          <Button variant="outline" size="sm" disabled>
            {onConsent === undefined ? "An operator must enable this" : "Awaiting approval"}
          </Button>
        ) : null}

        {steps !== undefined && steps.length > 0 ? (
          <>
            <Separator />
            <ol className="space-y-2" aria-label="1inch Aqua execution steps">
              {steps.map((step) => (
                <li key={step.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{step.label}</span>
                  <StepPill state={step.state} />
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
