"use client";

import * as React from "react";
import { Check, X } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Citation } from "../ai/citation.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../primitives/collapsible.js";
import { Separator } from "../primitives/separator.js";
import { SeriesPreview, type SeriesPreviewProps } from "./series-preview.js";
import { StepGlyph, type AgentStepState } from "./step-glyph.js";

/**
 * AgentStepDetail — the evidence behind one agent step.
 *
 * The rule this component enforces, and the reason the panel stays legible:
 * a field earns its place here only if it is **checkable**, **actionable**, or
 * **attributable** (source / block / time). Everything else — token ids, raw
 * payloads, internal field names — lives behind the nested disclosure, closed by
 * default. That keeps one contract for the demo and for the productionised traces.
 */

export interface AgentStepEvidenceRow {
  label: string;
  value: string;
}

export interface AgentStepMetric {
  label: string;
  value: string;
  tone?: "default" | "up" | "down" | "amber";
}

export interface AgentStepCheck {
  label: string;
  pass: boolean;
  detail?: string;
}

export interface AgentStepResult {
  /** The one-line assertion shown collapsed. */
  summary: string;
  metrics?: AgentStepMetric[];
  series?: Omit<SeriesPreviewProps, "className">;
  checks?: AgentStepCheck[];
}

export interface AgentStep {
  id: string;
  agent: string;
  /** e.g. "task(subagent=graph-indexer)" */
  call: string;
  /** Compact argument echo, e.g. "positions+liquidity" — never raw JSON. */
  argsSummary?: string;
  state: AgentStepState;
  durationMs?: number;
  /** Rendered in the fan row rather than the sequential column. */
  parallel?: boolean;
  /** WHY: the legible reasoning, one line each. */
  reasoning: string[];
  evidence?: AgentStepEvidenceRow[];
  result?: AgentStepResult;
  provenance?: { source: string; block?: string; timestamp?: string; confidence?: number };
  /** Everything else. Nested, closed by default. */
  raw?: string;
  error?: string;
}

const TONE: Record<NonNullable<AgentStepMetric["tone"]>, string> = {
  default: "text-fg",
  up: "text-up",
  down: "text-down",
  amber: "text-amber",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-faint">{title}</h4>
      {children}
    </section>
  );
}

export function AgentStepDetail({
  step,
  className,
  streaming = false,
}: {
  step: AgentStep;
  className?: string;
  /** While running, reveal reasoning lines as they arrive. */
  streaming?: boolean;
}) {
  return (
    <div className={cn("space-y-3 border-l-2 border-amber/30 pl-3", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StepGlyph state={step.state} withLabel />
        <span className="font-mono text-[10px] text-fg-dim">{step.call}</span>
        {step.argsSummary ? (
          <span className="font-mono text-[10px] text-fg-faint">{step.argsSummary}</span>
        ) : null}
        {step.durationMs !== undefined ? (
          <span className="font-mono text-[10px] tabular-nums text-fg-faint">
            {(step.durationMs / 1000).toFixed(1)}s
          </span>
        ) : null}
        {streaming && step.state === "running" ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-amber">
            streaming
          </span>
        ) : null}
      </div>

      {step.reasoning.length > 0 ? (
        <Section title="Why">
          <ul className="space-y-1">
            {step.reasoning.map((line, i) => (
              <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-fg-dim">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-fg-faint" aria-hidden />
                <span className="font-mono">{line}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {step.evidence?.length ? (
        <Section title="Evidence">
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {step.evidence.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-2 border-b border-edge/60 py-0.5">
                <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-faint">
                  {row.label}
                </dt>
                <dd className="truncate font-mono text-[10px] tabular-nums text-fg-dim" title={row.value}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      {step.result ? (
        <Section title="Result">
          <p className="text-[11px] leading-relaxed text-fg">{step.result.summary}</p>

          {step.result.metrics?.length ? (
            <div className="mt-1.5 grid gap-px bg-edge sm:grid-cols-3">
              {step.result.metrics.map((metric) => (
                <div key={metric.label} className="bg-panel-2 px-2 py-1.5">
                  {/* No `uppercase` here: it turns Greek α/β/γ into Latin lookalikes. */}
                  <p className="font-mono text-[9px] tracking-[0.12em] text-fg-faint">
                    {metric.label}
                  </p>
                  <p
                    className={cn(
                      "font-mono text-xs tabular-nums",
                      TONE[metric.tone ?? "default"],
                    )}
                  >
                    {metric.value}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          {step.result.checks?.length ? (
            <ul className="mt-1.5 space-y-1">
              {step.result.checks.map((check) => (
                <li key={check.label} className="flex items-center gap-2">
                  {check.pass ? (
                    <Check className="size-3 shrink-0 text-up" aria-hidden />
                  ) : (
                    <X className="size-3 shrink-0 text-down" aria-hidden />
                  )}
                  <span className="font-mono text-[10px] text-fg-dim">{check.label}</span>
                  {check.detail ? (
                    <span className="font-mono text-[10px] text-fg-faint">{check.detail}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {step.result.series ? (
            <div className="mt-2">
              <SeriesPreview {...step.result.series} />
            </div>
          ) : null}
        </Section>
      ) : null}

      {step.provenance ? (
        <Section title="Provenance">
          <Citation {...step.provenance} />
        </Section>
      ) : null}

      {step.error ? (
        <p className="border border-down/40 bg-down/5 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-down">
          {step.error}
        </p>
      ) : null}

      {step.raw ? (
        <>
          <Separator />
          <Collapsible>
            <CollapsibleTrigger className="font-mono text-[9px] uppercase tracking-[0.16em] text-fg-faint hover:text-amber">
              Raw payload
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 max-h-56 overflow-auto border border-edge bg-ink p-2 font-mono text-[10px] leading-relaxed text-fg-dim">
                {step.raw}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        </>
      ) : null}
    </div>
  );
}
