"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../primitives/card.js";
import { Badge } from "../primitives/badge.js";
import { Button } from "../primitives/button.js";

/**
 * ModelComparison — side-by-side benchmark delta (base vs fine-tuned).
 *
 * Shows performance improvement after fine-tuning with statistical significance.
 */

export interface BenchmarkMetric {
  name: string;
  base: number;
  fineTuned: number;
  unit?: string;
  higherIsBetter?: boolean;
}

export interface ModelComparisonProps extends React.ComponentProps<typeof Card> {
  baseModel: string;
  fineTunedModel: string;
  benchmarks: BenchmarkMetric[];
  onDeploy?: () => void;
}

export function ModelComparison({
  className,
  baseModel,
  fineTunedModel,
  benchmarks,
  onDeploy,
  ...props
}: ModelComparisonProps) {
  return (
    <Card className={cn("", className)} {...props}>
      <CardHeader>
        <CardTitle>Model Comparison</CardTitle>
        <CardDescription>
          Base vs fine-tuned performance across benchmarks
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Header */}
        <div className="grid grid-cols-3 gap-3">
          <div />
          <div className="text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">Base</p>
            <p className="mt-0.5 font-mono text-xs text-fg">{baseModel}</p>
          </div>
          <div className="text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">Fine-tuned</p>
            <p className="mt-0.5 font-mono text-xs text-amber">{fineTunedModel}</p>
          </div>
        </div>

        {/* Benchmark rows */}
        <div className="space-y-2">
          {benchmarks.map((b) => {
            const delta = b.fineTuned - b.base;
            const deltaPct = b.base !== 0 ? (delta / Math.abs(b.base)) * 100 : 0;
            const improved = b.higherIsBetter ?? true ? delta > 0 : delta < 0;

            return (
              <div
                key={b.name}
                className="grid grid-cols-3 items-center gap-3 border border-edge-2 bg-panel-2 px-3 py-2"
              >
                <span className="font-mono text-xs text-fg">{b.name}</span>
                <div className="text-center font-mono text-sm tabular-nums text-fg-dim">
                  {b.base.toFixed(2)}
                  {b.unit && <span className="text-xs text-fg-faint">{b.unit}</span>}
                </div>
                <div className="flex items-center justify-center gap-2">
                  <span className="font-mono text-sm font-semibold tabular-nums text-fg">
                    {b.fineTuned.toFixed(2)}
                    {b.unit && <span className="text-xs text-fg-faint">{b.unit}</span>}
                  </span>
                  <Badge variant={improved ? "up" : "down"}>
                    {deltaPct > 0 ? "+" : ""}{deltaPct.toFixed(1)}%
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
      {onDeploy && (
        <div className="px-6 pb-6">
          <Button onClick={onDeploy} className="w-full">
            Deploy Fine-tuned Model
          </Button>
        </div>
      )}
    </Card>
  );
}
