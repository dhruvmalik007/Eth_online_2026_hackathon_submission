"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../primitives/card.js";
import { Button } from "../primitives/button.js";
import { Badge } from "../primitives/badge.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../primitives/select.js";
import { Separator } from "../primitives/separator.js";

/**
 * FineTuningPanel — black-box fine-tuning control panel.
 *
 * Follows the hf-llm-trainer skill pattern:
 * - Select base model, dataset, training method (SFT/DPO/GRPO), compute tier
 * - Dataset validation status
 * - Cost estimate + job submission
 * - Links to observability (LangSmith traces + TimescaleDB metrics)
 * - Recent jobs list
 */

export interface FineTuningJob {
  id: string;
  model: string;
  method: "SFT" | "DPO" | "GRPO";
  status: "queued" | "running" | "complete" | "failed";
  cost?: number;
  duration?: string;
}

export interface FineTuningPanelProps extends React.ComponentProps<typeof Card> {
  models?: string[];
  datasets?: string[];
  methods?: Array<{ value: string; label: string }>;
  computeTiers?: Array<{ value: string; label: string; costPerHour: number }>;
  recentJobs?: FineTuningJob[];
  onSubmitJob?: (config: { model: string; dataset: string; method: string; compute: string }) => void;
  onViewTraces?: () => void;
  onViewMetrics?: () => void;
}

export function FineTuningPanel({
  className,
  models = ["Gemini 2.5 Flash Lite", "Qwen3-0.6B", "Qwen3-1.7B", "Llama-3.1-8B"],
  datasets = ["desk-traces-2026-Q3", "desk-traces-2026-Q2", "compliance-pairs-v2"],
  methods = [
    { value: "sft", label: "SFT" },
    { value: "dpo", label: "DPO" },
    { value: "grpo", label: "GRPO" },
  ],
  computeTiers = [
    { value: "t4-small", label: "T4 Small", costPerHour: 0.6 },
    { value: "t4-medium", label: "T4 Medium", costPerHour: 1.2 },
    { value: "a10g-large", label: "A10G Large", costPerHour: 2.5 },
    { value: "a100-large", label: "A100 Large", costPerHour: 5.0 },
  ],
  recentJobs = [],
  onSubmitJob,
  onViewTraces,
  onViewMetrics,
  ...props
}: FineTuningPanelProps) {
  const [model, setModel] = React.useState(models[0]);
  const [dataset, setDataset] = React.useState(datasets[0]);
  const [method, setMethod] = React.useState(methods[0].value);
  const [compute, setCompute] = React.useState(computeTiers[0].value);

  const selectedCompute = computeTiers.find((c) => c.value === compute);
  const estimatedCost = selectedCompute ? `~$${(selectedCompute.costPerHour * 0.33).toFixed(2)}` : "—";

  return (
    <Card className={cn("", className)} {...props}>
      <CardHeader>
        <CardTitle>Fine-Tuning Control Panel</CardTitle>
        <CardDescription>
          Submit fine-tuning jobs via the hf-llm-trainer black-box service.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Configuration grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Base Model */}
          <div className="space-y-1.5">
            <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
              Base Model
            </label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dataset */}
          <div className="space-y-1.5">
            <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
              Dataset
            </label>
            <Select value={dataset} onValueChange={setDataset}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {datasets.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="up" className="mt-1">
              ✓ Validated (SFT)
            </Badge>
          </div>

          {/* Method */}
          <div className="space-y-1.5">
            <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
              Method
            </label>
            <div className="flex gap-2">
              {methods.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMethod(m.value)}
                  className={cn(
                    "flex-1 border px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] transition-colors",
                    method === m.value
                      ? "border-amber/50 bg-amber/10 text-amber"
                      : "border-edge-2 bg-panel-2 text-fg-dim hover:border-amber/30",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Compute */}
          <div className="space-y-1.5">
            <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
              Compute
            </label>
            <Select value={compute} onValueChange={setCompute}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {computeTiers.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label} (${c.costPerHour}/hr)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="font-mono text-[10px] text-fg-faint">
              Est. cost: {estimatedCost}
            </p>
          </div>
        </div>

        <Separator />

        {/* Observability links */}
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 border border-edge-2 bg-panel-2 px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
              LangSmith
            </span>
            <span className="font-mono text-xs text-fg">ethonline2026-desk</span>
            {onViewTraces && (
              <button
                onClick={onViewTraces}
                className="font-mono text-[10px] text-amber hover:underline"
              >
                View Traces
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 border border-edge-2 bg-panel-2 px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
              TimescaleDB
            </span>
            <span className="font-mono text-xs text-fg">desk_metrics</span>
            {onViewMetrics && (
              <button
                onClick={onViewMetrics}
                className="font-mono text-[10px] text-amber hover:underline"
              >
                View Series
              </button>
            )}
          </div>
        </div>

        {/* Recent jobs */}
        {recentJobs.length > 0 && (
          <div>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
              Recent Jobs
            </p>
            <div className="space-y-1.5">
              {recentJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between border border-edge-2 bg-panel-2 px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-fg">{job.id}</span>
                    <Badge
                      variant={
                        job.status === "complete"
                          ? "up"
                          : job.status === "running"
                            ? "amber"
                            : job.status === "failed"
                              ? "down"
                              : "default"
                      }
                    >
                      {job.method} · {job.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    {job.cost !== undefined && (
                      <span className="font-mono text-xs text-fg-dim">${job.cost.toFixed(2)}</span>
                    )}
                    {job.duration && (
                      <span className="font-mono text-xs text-fg-faint">{job.duration}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button
          onClick={() => onSubmitJob?.({ model, dataset, method, compute })}
          className="w-full"
        >
          Submit Fine-Tuning Job
        </Button>
      </CardFooter>
    </Card>
  );
}
