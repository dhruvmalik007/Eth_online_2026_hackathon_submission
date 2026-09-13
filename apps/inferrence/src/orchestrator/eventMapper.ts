/**
 * Translation from agent internals to the UI contract.
 *
 * The one rule this module enforces, inherited from the mock it replaces: every
 * field on an `AgentStep` must trace to something the run actually produced. Where
 * a value does not exist it is omitted, never synthesised — a fabricated
 * rationale on a trading trace is worse than a blank one.
 */
import type { AgentStep } from "../events/agentStep.js";

export interface AgentStepSpec {
  readonly id: string;
  readonly agent: string;
  readonly call: string;
  readonly state?: AgentStep["state"];
  readonly argsSummary?: string;
  readonly parallel?: boolean;
  readonly durationMs?: number;
  readonly reasoning?: readonly string[];
  readonly evidence?: readonly { label: string; value: string }[];
  readonly result?: AgentStep["result"];
  readonly provenance?: AgentStep["provenance"];
  readonly raw?: string;
  readonly error?: string;
}

/** Build a complete `AgentStep`, omitting absent fields rather than faking them. */
export function buildAgentStep(spec: AgentStepSpec): AgentStep {
  return {
    id: spec.id,
    agent: spec.agent,
    call: spec.call,
    state: spec.state ?? "running",
    reasoning: [...(spec.reasoning ?? [])],
    ...(spec.argsSummary === undefined ? {} : { argsSummary: spec.argsSummary }),
    ...(spec.parallel === undefined ? {} : { parallel: spec.parallel }),
    ...(spec.durationMs === undefined ? {} : { durationMs: spec.durationMs }),
    ...(spec.evidence === undefined ? {} : { evidence: [...spec.evidence] }),
    ...(spec.result === undefined ? {} : { result: spec.result }),
    ...(spec.provenance === undefined ? {} : { provenance: spec.provenance }),
    ...(spec.raw === undefined ? {} : { raw: spec.raw }),
    ...(spec.error === undefined ? {} : { error: spec.error }),
  };
}

/** Compact one-line echo of tool args — never the raw JSON blob. */
export function compactArgs(args: Readonly<Record<string, unknown>>): string {
  return Object.entries(args)
    .map(([key, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? `${key}=${value}`
        : `${key}=${Array.isArray(value) ? value.join(",") : "…"}`,
    )
    .join(" · ");
}
