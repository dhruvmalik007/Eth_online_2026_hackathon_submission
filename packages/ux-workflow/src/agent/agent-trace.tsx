"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../primitives/accordion.js";
import { AgentStepDetail, type AgentStep } from "./agent-step-detail.js";
import { StepGlyph } from "./step-glyph.js";

/**
 * AgentTraceGroup — what the agents did, laid out as a workflow rather than a log.
 *
 * The shape encodes the structure: sequential steps are full-width rows, the
 * parallel subagents sit side by side, and whichever step is opened reveals one
 * **full-width drawer** beneath the rail. That is what makes a four-across
 * fan-out legible inside the narrow chat column — the nodes stay compact, the
 * evidence gets the whole width.
 *
 * Radix Accordion provides the semantics (`aria-expanded`, `aria-controls`,
 * arrow-key navigation, single-open) instead of a hand-rolled div+useState.
 */

export interface AgentTraceGroupProps {
  title?: string;
  subtitle?: string;
  steps: AgentStep[];
  /** `fanout` puts parallel steps side by side; `list` stacks everything. */
  layout?: "fanout" | "list";
  activeId?: string;
  onActiveChange?: (id: string) => void;
  /** Reveal reasoning lines as they arrive while a step is running. */
  streaming?: boolean;
  className?: string;
}

function Duration({ ms }: { ms?: number }) {
  if (ms === undefined) return null;
  return (
    <span className="shrink-0 font-mono text-[10px] tabular-nums text-fg-faint">
      {(ms / 1000).toFixed(1)}s
    </span>
  );
}

/** Sequential step — full-width row. */
function StepRow({ step }: { step: AgentStep }) {
  return (
    <div className="col-span-full">
      <AccordionTrigger>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
          <StepGlyph state={step.state} />
          <span className="font-mono text-[11px] text-fg">{step.call}</span>
          {step.argsSummary ? (
            <span className="truncate font-mono text-[10px] text-fg-faint" title={step.argsSummary}>
              {step.argsSummary}
            </span>
          ) : null}
          {step.result?.summary ? (
            <span className="truncate text-[11px] text-fg-dim" title={step.result.summary}>
              {step.result.summary}
            </span>
          ) : null}
          {step.state === "running" ? (
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-amber">
              running…
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-2">
            <Duration ms={step.durationMs} />
          </span>
        </span>
      </AccordionTrigger>
    </div>
  );
}

/** Parallel step — compact cell in the fan row. */
function StepCell({ step }: { step: AgentStep }) {
  return (
    // `min-w-0` + truncation on the name is enough to stop the bleed; an
    // `overflow-hidden` here also clips the trigger's chevron on longer names.
    <div className="col-span-1 min-w-0 border-t border-edge pb-2 pt-2">
      <AccordionTrigger className="items-center py-1.5">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <StepGlyph state={step.state} />
          {/* Name only: at four-across in the chat column there is roughly 160px
              per cell, so the outcome would overlap. It lives in the drawer. */}
          <span
            className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-fg-dim"
            title={step.agent}
          >
            {step.agent}
          </span>
          <Duration ms={step.durationMs} />
        </span>
      </AccordionTrigger>
    </div>
  );
}

export function AgentTraceGroup({
  title = "Agent tasks",
  subtitle,
  steps,
  layout = "fanout",
  activeId,
  onActiveChange,
  streaming = false,
  className,
}: AgentTraceGroupProps) {
  const [internalActive, setInternalActive] = React.useState<string>("");
  const isControlled = activeId !== undefined;
  const active = isControlled ? activeId : internalActive;

  const setActive = React.useCallback(
    (value: string) => {
      if (!isControlled) setInternalActive(value);
      onActiveChange?.(value);
    },
    [isControlled, onActiveChange],
  );

  React.useEffect(() => {
    if (layout === "list") setInternalActive((cur) => cur || steps[0]?.id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, steps.length]);

  // Parallel steps fan out; everything else stays sequential, in order.
  const parallel = layout === "fanout" ? steps.filter((s) => s.parallel) : [];
  const sequential = layout === "fanout" ? steps.filter((s) => !s.parallel) : steps;
  const firstParallelIndex = steps.findIndex((s) => s.parallel);
  const before = parallel.length
    ? sequential.filter((s) => steps.indexOf(s) < firstParallelIndex)
    : sequential;
  const after = parallel.length ? sequential.filter((s) => steps.indexOf(s) > firstParallelIndex) : [];

  const done = steps.filter((s) => s.state === "done").length;

  return (
    <div className={cn("border border-edge-2 bg-panel px-3 py-2.5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge pb-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-dim">{title}</p>
          {subtitle ? (
            <p className="mt-0.5 truncate text-[10px] text-fg-faint">{subtitle}</p>
          ) : null}
        </div>
        <span className="font-mono text-[10px] tabular-nums text-fg-faint">
          {done}/{steps.length} done
        </span>
      </div>

      <Accordion
        type="single"
        collapsible
        value={active}
        onValueChange={setActive}
        className={cn(
          "grid pt-1",
          // `gap-x` only. A row gap here would also apply to the empty implicit
          // rows between the fan cells and the drawer below, opening a large
          // phantom vertical gap. Vertical rhythm comes from cell padding.
          parallel.length > 1 ? "grid-cols-2 gap-x-3 sm:grid-cols-4" : "grid-cols-1",
        )}
      >
        {before.map((step) => (
          <AccordionItem key={step.id} value={step.id} className="contents">
            <StepRow step={step} />
            <AccordionContent className="col-span-full">
              <AgentStepDetail step={step} streaming={streaming} />
            </AccordionContent>
          </AccordionItem>
        ))}

        {parallel.length > 1 ? (
          <p className="col-span-full mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-fg-faint">
            parallel · {parallel.length} subagents
          </p>
        ) : null}

        {parallel.map((step) => (
          <AccordionItem key={step.id} value={step.id} className="contents">
            <StepCell step={step} />
            {/* Pinned to a late row so the drawer always opens BELOW the whole fan
                row. Left to auto-placement it consumed the next grid row and pushed
                the remaining cells under it, destroying the fan the moment you
                opened one. */}
            <AccordionContent className="col-span-full" style={{ gridRowStart: 90 }}>
              <AgentStepDetail step={step} streaming={streaming} />
            </AccordionContent>
          </AccordionItem>
        ))}

        {after.map((step) => (
          <AccordionItem key={step.id} value={step.id} className="contents">
            <StepRow step={step} />
            <AccordionContent className="col-span-full">
              <AgentStepDetail step={step} streaming={streaming} />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
