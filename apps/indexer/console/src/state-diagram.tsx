"use client";

import * as React from "react";
import {
  Badge,
  FlowDiagram,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  motion,
  type FlowEdge,
  type FlowNode,
} from "@ethonline2026/ux-workflow";

import {
  RUN_STATES,
  forwardTransitions,
  specOf,
  transitionsFrom,
  transitionsInto,
  type RunState,
} from "./machine.js";

/**
 * The run lifecycle, drawn from the transition table.
 *
 * Not a diagram of the machine — the machine. Nodes come from `RUN_STATES`, edges from
 * `TRANSITIONS`, and the highlighted node is the state the console is actually in, so the picture
 * cannot describe a lifecycle the code does not implement.
 *
 * One honest limitation: the canvas lays columns out left to right and draws each ribbon from a
 * node's right edge to the next node's left, so an edge pointing backwards collapses to a
 * one-pixel sliver. `invalid → composing` and every `settled → composing` are real, so they are
 * listed under the selected state instead of being drawn as something they are not. Selecting a
 * state is how you read them.
 */

/** A uniform magnitude: the canvas sizes nodes by value, and every state is equally large. */
const UNIT = 1;

function buildNodes(): FlowNode[] {
  return RUN_STATES.map((spec) => ({
    id: spec.id,
    label: spec.label,
    value: UNIT,
    accent: spec.accent,
    column: spec.column,
    subLabel: spec.terminal ? "terminal" : "in flight",
    description: spec.description,
  }));
}

function buildEdges(): FlowEdge[] {
  return forwardTransitions().map((transition) => ({
    from: transition.from,
    to: transition.to,
    value: UNIT,
    label: transition.on,
    description: transition.description,
  }));
}

export interface RunStateDiagramProps {
  /** The state the console is in right now. Highlighted on the canvas. */
  readonly state: RunState;
  /** The state whose transitions are listed below the canvas. Defaults to the current state. */
  readonly selected?: RunState;
  readonly onSelect?: (state: RunState) => void;
  readonly height?: number;
}

export function RunStateDiagram({
  state,
  selected,
  onSelect,
  height = 220,
}: RunStateDiagramProps): React.JSX.Element {
  const focused = selected ?? state;
  const spec = specOf(focused);
  const nodes = React.useMemo(buildNodes, []);
  const edges = React.useMemo(buildEdges, []);

  const outbound = transitionsFrom(focused);
  const inbound = transitionsInto(focused);

  // The current state pulses; every other node is still. One authored movement rather than several,
  // so the eye lands on the only thing that is happening.
  const isLive = state === "submitting" || state === "running";

  return (
    <section aria-label="Run lifecycle" className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-faint">
          run lifecycle
        </span>
        <Separator orientation="vertical" className="h-3" />
        <Badge
          variant={spec.accent === "up" ? "default" : "secondary"}
          className={`font-mono text-[10px] uppercase tracking-[0.14em] ${
            isLive ? motion.pulseSubtle : ""
          }`}
        >
          {spec.label}
        </Badge>
        <span className="text-[12px] leading-relaxed text-fg-dim">
          {spec.description}
        </span>
      </div>

      <div className="border border-edge bg-panel/40">
        <FlowDiagram
          nodes={nodes}
          edges={edges}
          height={height}
          columnWidth={150}
          nodeHeight={56}
          activeNodeId={focused}
          ariaLabel="Run lifecycle states and the transitions between them"
          {...(onSelect === undefined
            ? {}
            : {
                onNodeSelect: (id: string) => {
                  onSelect(id as RunState);
                },
              })}
        />
      </div>

      <TransitionsPanel
        state={focused}
        outbound={outbound}
        inbound={inbound}
        current={state}
      />
    </section>
  );
}

interface TransitionsPanelProps {
  readonly state: RunState;
  readonly outbound: ReturnType<typeof transitionsFrom>;
  readonly inbound: ReturnType<typeof transitionsInto>;
  readonly current: RunState;
}

/**
 * The edges the canvas cannot draw, plus the ones it can.
 *
 * This is what keeps the omission honest. Every transition is listed on the state it leaves and on
 * the state it returns to, so a reader who notices `ok` has no line back to `composing` on the canvas
 * finds it here rather than assuming the machine is a straight line.
 */
function TransitionsPanel({
  state,
  outbound,
  inbound,
  current,
}: TransitionsPanelProps): React.JSX.Element {
  return (
    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
          leads out of {specOf(state).label}
        </p>
        <ul className="mt-2 space-y-1.5">
          {outbound.map((transition) => (
            <li
              key={`${transition.from}-${transition.on}`}
              className="flex gap-3 text-[12px]"
            >
              <span className="w-[92px] shrink-0 font-mono text-[11px] text-amber">
                {transition.on}
              </span>
              <span className="w-[84px] shrink-0 font-mono text-[11px] text-fg-dim">
                {specOf(transition.to).label}
              </span>
              <span className="min-w-0 text-fg-faint">
                {transition.description}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
          leads back into {specOf(state).label}
        </p>
        {inbound.length === 0 ? (
          <p className="mt-2 text-[12px] text-fg-faint">
            Nothing returns here. This is where a run begins.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {inbound.map((transition) => (
              <li
                key={`${transition.from}-${transition.on}`}
                className="flex gap-3 text-[12px]"
              >
                <span className="w-[92px] shrink-0 font-mono text-[11px] text-fg-dim">
                  {specOf(transition.from).label}
                </span>
                <span className="w-[84px] shrink-0 font-mono text-[11px] text-amber">
                  {transition.on}
                </span>
                <span className="min-w-0 text-fg-faint">
                  {transition.description}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {current !== state ? (
        <p className="text-[11px] text-fg-faint sm:col-span-2">
          Showing{" "}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  /* selection is owned by the caller */
                }}
                className="font-mono text-[11px] text-fg-dim underline decoration-edge-2 underline-offset-2"
              >
                {specOf(state).label}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              Select the highlighted node to return here.
            </TooltipContent>
          </Tooltip>
          , not the state this run is in.
        </p>
      ) : null}
    </div>
  );
}
