/**
 * `InferenceEvent` → UI state.
 *
 * The inference service streams Server-Sent Events; this module turns those bytes
 * into the `AgentStep[]` and widget payloads the desk renders. It is the app's
 * counterpart to `apps/inferrence/src/events/contract.ts`, and it deliberately has
 * no React and no `fetch` in it so the reduction can be tested directly.
 *
 * ## On the wire contract being restated here
 *
 * `AgentStep` is imported from `@ethonline2026/ux-workflow` rather than redeclared —
 * that is the type that actually reaches the renderers, so drift there is a compile
 * error. The surrounding envelope (the event union and the widget set) is declared
 * locally instead, because the alternative is importing `@ethonline2026/inferrence`,
 * which is an application: depending on it would pull Fastify, the sandbox and the
 * whole agent graph into the Next.js bundle.
 *
 * That leaves a real drift risk, so it is contained rather than hidden:
 * `test/inference-stream.test.ts` reduces a **recorded stream from the live service**,
 * so a field the service renames fails here instead of rendering blank.
 *
 * ## Reconnection
 *
 * Every event carries a monotonic `seq`, and the service journals them, so a dropped
 * connection resumes with `?sinceSeq=` and neither duplicates nor skips a step. That
 * is why {@link InferenceRunState.lastSeq} is tracked here rather than recomputed.
 */
import type { AgentStep } from "@ethonline2026/ux-workflow";

/** The six widget kinds the desk knows how to render. */
export type InferenceWidget =
  | {
      kind: "forecast";
      protocol: string;
      metric: string;
      horizonDays: number;
      point: number[];
      q10: number[];
      q90: number[];
      model: string;
      provenance: string | null;
    }
  | {
      kind: "risk";
      verdict: string;
      factors: { sym: string; label: string; value: string; interp: string | null }[];
    }
  | {
      kind: "yields";
      pools: { poolId: string; protocol: string; apy: number; tvlUsd: number }[];
    }
  | { kind: "intent"; plan: { id: string; batchIntent: string; steps: unknown[] } }
  | { kind: "execution"; planId: string; steps: unknown[] }
  | { kind: "approvals"; intents: SigningIntent[] };

/**
 * A signable intent, as far as the desk needs it.
 *
 * Intentionally partial: the service owns this shape (`packages/custody`), and the
 * desk only reads the fields it displays. Anything it does not use is left off so
 * this file does not have to track custody's schema.
 */
export interface SigningIntent {
  intentId: string;
  requestId: string;
  chain: string;
  kind: string;
  digest: string;
  display: { title: string; sentence: string; fields: { label: string; value: string }[]; warnings: string[] };
  authorized: { legs: unknown[] };
}

export interface InferenceEvent {
  v: string;
  seq: number;
  ts: string;
  type: string;
  [key: string]: unknown;
}

export interface InferenceRunState {
  runId: string | null;
  sessionId: string | null;
  /** In order of first appearance; a re-sent step replaces its predecessor. */
  steps: AgentStep[];
  widgets: InferenceWidget[];
  intents: SigningIntent[];
  /** The agent's prose, accumulated from `message.delta` and settled by `message.completed`. */
  message: string;
  /** Terminal run state (`ranked`, `awaiting_user`, `failed`, …), or null while running. */
  state: string | null;
  summary: string | null;
  error: { code: string; message: string } | null;
  /** Highest `seq` seen — the resume cursor. */
  lastSeq: number;
}

export function emptyRunState(): InferenceRunState {
  return {
    runId: null,
    sessionId: null,
    steps: [],
    widgets: [],
    intents: [],
    message: "",
    state: null,
    summary: null,
    error: null,
    lastSeq: 0,
  };
}

/**
 * Incremental SSE frame decoder.
 *
 * Feed it whatever `ReadableStream` chunks arrive; it buffers across chunk
 * boundaries, so a frame split mid-JSON is not a parse error. Heartbeat comments
 * (`:hb`) and any non-`data:` field are ignored — the service sends heartbeats to
 * keep Cloud Run's connection alive, and they are not events.
 */
export class SseFrameDecoder {
  #buffer = "";

  /** @returns the complete `data:` payloads found in this chunk, in order. */
  push(chunk: string): string[] {
    this.#buffer += chunk;
    const payloads: string[] = [];

    for (;;) {
      const boundary = this.#buffer.indexOf("\n\n");
      if (boundary === -1) break;
      const frame = this.#buffer.slice(0, boundary);
      this.#buffer = this.#buffer.slice(boundary + 2);

      // A frame may carry several fields; only `data:` lines are payload, and a
      // multi-line data field is joined with newlines per the SSE spec.
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data.length > 0) payloads.push(data);
    }
    return payloads;
  }
}

/** Parse one SSE payload into an event, or `null` if it is not one we understand. */
export function parseInferenceEvent(payload: string): InferenceEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const event = parsed as Record<string, unknown>;
  // `type` and `seq` are the two fields every reduction branches on, so an event
  // missing either is not usable — better to drop it than to corrupt the state.
  if (typeof event["type"] !== "string" || typeof event["seq"] !== "number") return null;
  return event as InferenceEvent;
}

/**
 * Apply one event.
 *
 * Pure and total: an unrecognised `type` returns the state unchanged, so a newer
 * service emitting a new event cannot break an older client. That is deliberate —
 * forward compatibility is cheaper than lockstep deploys here.
 */
export function reduceEvent(state: InferenceRunState, event: InferenceEvent): InferenceRunState {
  const next: InferenceRunState = { ...state, lastSeq: Math.max(state.lastSeq, event.seq) };

  switch (event.type) {
    case "session.started":
      next.sessionId = asString(event["sessionId"]) ?? state.sessionId;
      next.runId = asString(event["runId"]) ?? state.runId;
      return next;

    case "message.delta":
      return { ...next, message: state.message + (asString(event["text"]) ?? "") };

    case "message.completed":
      // The completed text is authoritative: it replaces any drift from a dropped
      // delta rather than appending to it.
      return { ...next, message: asString(event["text"]) ?? state.message };

    case "step.start":
    case "step.completed": {
      const step = event["step"] as AgentStep | undefined;
      if (step === undefined || typeof step.id !== "string") return next;
      return { ...next, steps: upsertStep(state.steps, step) };
    }

    case "step.update": {
      const stepId = asString(event["stepId"]);
      const patch = event["patch"] as Partial<AgentStep> | undefined;
      if (stepId === undefined || patch === undefined) return next;
      return {
        ...next,
        steps: state.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
      };
    }

    case "widget": {
      const widget = event["widget"] as InferenceWidget | undefined;
      if (widget === undefined || typeof widget.kind !== "string") return next;
      return { ...next, widgets: replaceWidget(state.widgets, widget) };
    }

    case "approval.requested": {
      const intent = event["intent"] as SigningIntent | undefined;
      if (intent === undefined) return next;
      return { ...next, intents: [...state.intents.filter((i) => i.intentId !== intent.intentId), intent] };
    }

    case "run.completed":
      return {
        ...next,
        runId: asString(event["runId"]) ?? state.runId,
        state: asString(event["state"]) ?? state.state,
        summary: asString(event["summary"]) ?? state.summary,
      };

    case "error":
      return {
        ...next,
        state: "failed",
        error: {
          code: asString(event["code"]) ?? "UNKNOWN",
          message: asString(event["message"]) ?? "The run failed.",
        },
      };

    default:
      return next;
  }
}

/** Reduce a whole stream. Convenience for tests and for non-streaming callers. */
export function reduceAll(events: readonly InferenceEvent[]): InferenceRunState {
  return events.reduce(reduceEvent, emptyRunState());
}

/**
 * A step arriving twice replaces its earlier copy.
 *
 * The service sends `step.start` then `step.completed` for the same id, and a
 * reconnecting client may legitimately receive the start again — so this must be an
 * upsert keyed by id rather than an append, or the trace would show every step twice.
 */
export function upsertStep(steps: readonly AgentStep[], step: AgentStep): AgentStep[] {
  const index = steps.findIndex((existing) => existing.id === step.id);
  if (index === -1) return [...steps, step];
  const next = [...steps];
  next[index] = step;
  return next;
}

/** Widgets are keyed by kind — a newer forecast replaces the older one. */
export function replaceWidget(
  widgets: readonly InferenceWidget[],
  widget: InferenceWidget,
): InferenceWidget[] {
  // `execution` is additionally keyed by plan, so two plans can coexist on screen.
  const sameSlot = (existing: InferenceWidget): boolean =>
    existing.kind === widget.kind &&
    (widget.kind !== "execution" ||
      (existing as { planId?: string }).planId === (widget as { planId?: string }).planId);
  return [...widgets.filter((existing) => !sameSlot(existing)), widget];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
