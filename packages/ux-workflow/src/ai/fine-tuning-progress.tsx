"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import { Card, CardHeader, CardTitle, CardContent } from "../primitives/card.js";
import { Progress } from "../primitives/progress.js";
import { Badge } from "../primitives/badge.js";

/**
 * FineTuningProgress — real-time training job monitoring.
 *
 * Mirrors the Trackio dashboard pattern from hf-llm-trainer:
 * - Training loss curve (progress bar per step)
 * - ETA, cost so far, current step
 * - Learning rate, validation metrics
 */

export interface FineTuningProgressProps extends React.ComponentProps<typeof Card> {
  jobId: string;
  status: "queued" | "running" | "complete" | "failed";
  currentStep: number;
  totalSteps: number;
  loss?: number;
  initialLoss?: number;
  learningRate?: number;
  costSoFar?: number;
  eta?: string;
  errorMessage?: string;
}

export function FineTuningProgress({
  className,
  jobId,
  status,
  currentStep,
  totalSteps,
  loss,
  initialLoss,
  learningRate,
  costSoFar,
  eta,
  errorMessage,
  ...props
}: FineTuningProgressProps) {
  const progress = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;
  const lossImprovement =
    loss !== undefined && initialLoss !== undefined
      ? ((initialLoss - loss) / initialLoss) * 100
      : undefined;

  return (
    <Card className={cn("", className)} {...props}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>Training Progress</CardTitle>
          <Badge
            variant={
              status === "complete"
                ? "up"
                : status === "running"
                  ? "amber"
                  : status === "failed"
                    ? "down"
                    : "default"
            }
          >
            {status}
          </Badge>
        </div>
        <p className="font-mono text-xs text-fg-faint">Job {jobId}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Step progress */}
        <div className="space-y-1.5">
          <div className="flex justify-between font-mono text-[10px] text-fg-dim">
            <span>Step {currentStep} / {totalSteps}</span>
            <span>{progress.toFixed(0)}%</span>
          </div>
          <Progress value={progress} />
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {loss !== undefined && (
            <MetricTile label="Loss" value={loss.toFixed(3)} delta={lossImprovement} />
          )}
          {learningRate !== undefined && (
            <MetricTile label="Learning Rate" value={learningRate.toExponential(1)} />
          )}
          {costSoFar !== undefined && (
            <MetricTile label="Cost" value={`$${costSoFar.toFixed(2)}`} />
          )}
          {eta && <MetricTile label="ETA" value={eta} />}
        </div>

        {/* Error */}
        {status === "failed" && errorMessage && (
          <div className="border border-down/40 bg-down/10 p-3">
            <p className="font-mono text-xs text-down">{errorMessage}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricTile({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: number;
}) {
  return (
    <div className="border border-edge-2 bg-panel-2 px-3 py-2">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-fg-faint">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-fg">{value}</p>
      {delta !== undefined && delta > 0 && (
        <p className="font-mono text-[9px] text-up">↓ {delta.toFixed(1)}%</p>
      )}
    </div>
  );
}
