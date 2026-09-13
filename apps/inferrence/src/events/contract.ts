/**
 * The `InferenceEvent` wire contract.
 *
 * This single union is the seam between the service and its consumers: the
 * Next.js `agentic-ems` app (primary — parsed by `lib/inference/stream.ts` and
 * rendered by `AgentTraceGroup`) and the `scripts/smoke-sse.ts` CLI (secondary).
 *
 * Two properties matter and are enforced here:
 *   1. `step.*` payloads ARE `AgentStep` from `@ethonline2026/ux-workflow` — the
 *      UI components need no change to render a live run.
 *   2. Every event carries a monotonic `seq`, so a dropped SSE connection can
 *      resume from the journal (`?sinceSeq=`) with no gaps and no duplicates.
 */
import { z } from "zod";
import { ExecutionPlanSchema, ExecutionStepSchema } from "@ethonline2026/execution-domain";
import { SigningIntentSchema } from "@ethonline2026/custody";
import type { AgentStep } from "./agentStep.js";

export const INFERENCE_EVENT_VERSION = "0.1" as const;

export const AGENT_MODES = ["v01", "deep", "dry"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

/**
 * `AgentStep` is validated structurally rather than re-declared: the type is
 * owned by the UI package and asserting it here (a compile-time check in
 * `test/contract.test.ts` proves `AgentStepSchema`'s type IS `AgentStep`) keeps
 * the service from inventing a parallel shape that drifts.
 */
const AgentStepSchema = z.custom<AgentStep>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { agent?: unknown }).agent === "string" &&
    typeof (value as { call?: unknown }).call === "string" &&
    typeof (value as { state?: unknown }).state === "string" &&
    Array.isArray((value as { reasoning?: unknown }).reasoning),
  { error: "not an AgentStep" },
);

/** A partial step, sent by `step.update`. Validated structurally, like `AgentStep`. */
const AgentStepPatchSchema = z.custom<Partial<AgentStep>>(
  (value) => typeof value === "object" && value !== null,
  { error: "not an AgentStep patch" },
);

/** Widget payloads mirror the mock's inline widgets, so the renderers are reused. */
export const WidgetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("forecast"),
    protocol: z.string(),
    metric: z.string(),
    horizonDays: z.number().int().positive(),
    point: z.array(z.number()),
    q10: z.array(z.number()),
    q90: z.array(z.number()),
    model: z.string(),
    provenance: z.string().nullable().default(null),
  }),
  z.object({
    kind: z.literal("risk"),
    verdict: z.string(),
    factors: z.array(
      z.object({
        sym: z.string(),
        label: z.string(),
        value: z.string(),
        interp: z.string().nullable().default(null),
      }),
    ),
  }),
  z.object({
    kind: z.literal("yields"),
    pools: z.array(
      z.object({
        poolId: z.string(),
        protocol: z.string(),
        apy: z.number(),
        tvlUsd: z.number(),
      }),
    ),
  }),
  z.object({ kind: z.literal("intent"), plan: ExecutionPlanSchema }),
  z.object({
    kind: z.literal("execution"),
    planId: z.string(),
    steps: z.array(ExecutionStepSchema),
  }),
  z.object({
    kind: z.literal("approvals"),
    intents: z.array(SigningIntentSchema),
  }),
]);

export type Widget = z.infer<typeof WidgetSchema>;

const meta = {
  v: z.literal(INFERENCE_EVENT_VERSION),
  seq: z.number().int().positive(),
  ts: z.string().min(1),
};

export const InferenceEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...meta,
    type: z.literal("session.started"),
    sessionId: z.string().min(1),
    runId: z.string().min(1),
    agent: z.enum(AGENT_MODES),
    dry: z.boolean(),
  }),
  z.object({
    ...meta,
    type: z.literal("message.delta"),
    messageId: z.string().min(1),
    text: z.string(),
  }),
  z.object({
    ...meta,
    type: z.literal("message.completed"),
    messageId: z.string().min(1),
    text: z.string(),
  }),
  z.object({ ...meta, type: z.literal("step.start"), step: AgentStepSchema }),
  z.object({
    ...meta,
    type: z.literal("step.update"),
    stepId: z.string().min(1),
    patch: AgentStepPatchSchema,
  }),
  z.object({ ...meta, type: z.literal("step.completed"), step: AgentStepSchema }),
  z.object({ ...meta, type: z.literal("widget"), widget: WidgetSchema }),
  z.object({
    ...meta,
    type: z.literal("approval.requested"),
    intent: SigningIntentSchema,
  }),
  z.object({
    ...meta,
    type: z.literal("approval.resolved"),
    intentId: z.string().min(1),
    outcome: z.enum(["approved", "rejected", "expired"]),
    txHash: z.string().nullable().default(null),
  }),
  z.object({
    ...meta,
    type: z.literal("run.completed"),
    runId: z.string().min(1),
    state: z.string().min(1),
    summary: z.string(),
  }),
  z.object({
    ...meta,
    type: z.literal("error"),
    code: z.string().min(1),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).nullable().default(null),
  }),
]);

export type InferenceEvent = z.infer<typeof InferenceEventSchema>;

/** An event before the emitter stamps version/seq/ts onto it. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type InferenceEventInput = DistributiveOmit<InferenceEvent, "v" | "seq" | "ts">;

export type EventSink = (event: InferenceEvent) => void;

/** SSE framing: `id:` gives `Last-Event-ID` resume, `data:` carries the JSON. */
export function serializeSse(event: InferenceEvent): string {
  return `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
}
