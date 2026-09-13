/**
 * Turn → trace bridge.
 *
 * Maps one `InferenceEvent` stream onto one LangSmith trace tree:
 *
 *   inference.turn                (chain, root — latency is the turn's latency)
 *   ├── <LangGraph node>          (chain, per step.start/step.completed)
 *   ├── sandbox.exec              (tool)
 *   ├── forecast.predict          (tool)
 *   └── custody.proposeIntent     (tool)
 *
 * Events are processed through a **serialized promise chain** rather than
 * concurrently: `RunTree.postRun()` is asynchronous, so two steps completing at
 * once could otherwise be posted out of order and a child could be attached to a
 * parent that has not been sent yet.
 *
 * Nothing here can fail a run — every tracer error is swallowed by the tracer.
 */
import type { InferenceEvent } from "../events/contract.js";
import type { RunEventEmitter } from "../events/emitter.js";
import type { FeedbackSpec, TraceRun, Tracing } from "./tracing.js";

export interface TurnTraceSpec {
  readonly runId: string;
  readonly sessionId: string;
  readonly query: string;
  readonly mode: string;
  readonly dry: boolean;
  readonly pools: readonly string[];
  readonly protocols: readonly string[];
  readonly horizonDays: number;
}

/** Operation name → the run type it should appear as. */
function runTypeFor(call: string): "tool" | "chain" {
  return call.startsWith("task(") || call.includes(".") ? "tool" : "chain";
}

/**
 * A step id → tags. Tags are how categorical facts become filterable and
 * groupable on the dashboard, which numeric metadata cannot be.
 */
function stepTags(step: { state?: string; parallel?: boolean }): string[] {
  return [
    ...(step.state === undefined ? [] : [`step_state=${step.state}`]),
    ...(step.parallel === true ? ["parallel=true"] : []),
  ];
}

export class TurnTrace {
  readonly #tracing: Tracing;
  readonly #spec: TurnTraceSpec;
  readonly #steps = new Map<string, TraceRun>();
  #root: TraceRun | null = null;
  #chain: Promise<void> = Promise.resolve();
  #unsubscribe: (() => void) | null = null;
  #settled: Promise<void> = Promise.resolve();

  constructor(tracing: Tracing, spec: TurnTraceSpec) {
    this.#tracing = tracing;
    this.#spec = spec;
  }

  /** Serialize work so runs are posted in the order the events arrived. */
  #enqueue(task: () => Promise<void>): void {
    this.#chain = this.#chain.then(task).catch(() => undefined);
  }

  /** Begin the trace and bridge an emitter's events onto it. */
  attach(emitter: RunEventEmitter): Promise<void> {
    if (!this.#tracing.enabled) return Promise.resolve();

    this.#enqueue(async () => {
      this.#root = await this.#tracing.beginTurn({
        name: "inference.turn",
        runId: this.#spec.runId,
        sessionId: this.#spec.sessionId,
        inputs: {
          query: this.#spec.query,
          mode: this.#spec.mode,
          dry: this.#spec.dry,
          pools: this.#spec.pools,
          protocols: this.#spec.protocols,
          horizonDays: this.#spec.horizonDays,
        },
        tags: [`mode=${this.#spec.mode}`, `dry=${String(this.#spec.dry)}`],
        metadata: { sessionId: this.#spec.sessionId, agentRunId: this.#spec.runId },
      });
    });

    let resolveSettled: () => void = () => undefined;
    this.#settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });

    // Unsubscribe as soon as the run settles, so a long-lived emitter does not
    // accumulate dead subscribers across turns.
    this.#unsubscribe = emitter.subscribe((event) => {
      this.#handle(event, () => {
        this.#unsubscribe?.();
        resolveSettled();
      });
    });
    return this.#settled;
  }

  #handle(event: InferenceEvent, settle: () => void): void {
    switch (event.type) {
      case "step.start": {
        const step = event.step;
        this.#enqueue(async () => {
          const run = await this.#root?.child({
            name: `${step.call}`,
            runType: runTypeFor(step.call),
            inputs: {
              agent: step.agent,
              argsSummary: step.argsSummary ?? null,
              reasoning: step.reasoning,
            },
            tags: stepTags(step),
            metadata: {
              stepId: step.id,
              ...(step.parallel === true ? { parallel: true } : {}),
            },
          });
          if (run !== undefined) this.#steps.set(step.id, run);
        });
        break;
      }
      case "step.completed": {
        const step = event.step;
        this.#enqueue(async () => {
          const run = this.#steps.get(step.id) ?? (await this.#root?.child({
            name: `${step.call}`,
            runType: runTypeFor(step.call),
            inputs: { agent: step.agent, argsSummary: step.argsSummary ?? null },
            tags: stepTags(step),
          }));
          if (run === undefined) return;
          // A failing step is recorded as an error on its own run, so the
          // dashboard's error rate reflects the operation that actually failed.
          await run.end({
            outputs: {
              summary: step.result?.summary ?? null,
              metrics: step.result?.metrics ?? null,
              checks: step.result?.checks ?? null,
              evidence: step.evidence ?? null,
            },
            ...(step.error === undefined ? {} : { error: step.error }),
            tags: stepTags(step),
          });
          // Duration as a first-class metric: the run's own latency charts, a
          // numeric metadata field would not.
          if (step.durationMs !== undefined) {
            await run.feedback({
              key: "duration_ms",
              score: step.durationMs,
              comment: step.call,
            });
          }
        });
        break;
      }
      case "widget": {
        const kind = event.widget.kind;
        this.#enqueue(async () => {
          const run = await this.#root?.child({
            name: `widget.${kind}`,
            runType: "tool",
            inputs: { kind },
            tags: [`widget=${kind}`],
          });
          const summary =
            kind === "forecast"
              ? { protocol: event.widget.protocol, metric: event.widget.metric, model: event.widget.model }
              : kind === "yields"
                ? { pools: event.widget.pools.length }
                : kind === "intent" || kind === "execution"
                  ? { planId: (event.widget as { plan?: { id?: string }; planId?: string }).planId ?? (event.widget as { plan?: { id?: string } }).plan?.id }
                  : { intents: (event.widget as { intents?: unknown[] }).intents?.length ?? 0 };
          await run?.end({ outputs: summary as Record<string, unknown> });
        });
        break;
      }
      case "approval.requested": {
        const intent = event.intent;
        this.#enqueue(async () => {
          const run = await this.#root?.child({
            name: "custody.proposeIntent",
            runType: "tool",
            inputs: {
              intentId: intent.intentId,
              kind: intent.kind,
              legs: intent.authorized.legs.length,
              sentence: intent.display.sentence,
            },
            tags: [`intent_kind=${intent.kind}`, `chain=${intent.chain}`],
            metadata: { intentDigest: intent.digest },
          });
          await run?.end({ outputs: { digest: intent.digest, safeTxHash: safeTxHashOf(intent) } });
          // Numeric metrics as feedback, because metadata does not aggregate.
          await run?.feedback({ key: "intent_legs", score: intent.authorized.legs.length });
          await run?.feedback({ key: "intent_policy_allowed", score: intent.policy.allowlistOk ? 1 : 0 });
        });
        break;
      }
      case "error": {
        const message = event.message;
        this.#enqueue(async () => {
          await this.#root?.end({
            outputs: { errorCode: event.code },
            error: message,
            tags: [`error_code=${event.code}`],
          });
        });
        settle();
        break;
      }
      case "run.completed": {
        const state = event.state;
        const summary = event.summary;
        this.#enqueue(async () => {
          await this.#root?.end({
            outputs: { state, summary },
            tags: [`state=${state}`],
          });
          await this.#root?.feedback({
            key: "run_state",
            score: state === "failed" ? 0 : 1,
            value: state,
          });
          await this.#tracing.flush();
        });
        settle();
        break;
      }
      default:
        break;
    }
  }

  /** Wait for the bridge to drain — every queued run posted and ended. */
  async settle(): Promise<void> {
    await this.#settled;
    await this.#chain;
  }

  /**
   * Await only the queued work, without waiting for the turn to complete.
   *
   * Used when a stream ends for a reason other than `run.completed` (a client
   * disconnect): `settle()` would then block forever, while the in-flight runs
   * still need to finish before a flush.
   */
  async drain(): Promise<void> {
    await this.#chain;
  }

  /** Record the outcome of an approval, which lands after the turn has ended. */
  async recordApproval(spec: { intentId: string; outcome: string }): Promise<void> {
    await this.#tracing.recordFeedback(this.#spec.runId, {
      key: "approval_outcome",
      score: spec.outcome === "approved" ? 1 : 0,
      value: spec.outcome,
      comment: spec.intentId,
    });
    await this.#tracing.flush();
  }
}

function safeTxHashOf(intent: { signing: { scheme: string } }): string | null {
  const signing = intent.signing as { scheme: string; safeTxHash?: string };
  return signing.scheme === "safe-typed-data" ? (signing.safeTxHash ?? null) : null;
}

/** Feedback keys this module emits, so tests and dashboards agree on the names. */
export const TRACE_FEEDBACK_KEYS = [
  "duration_ms",
  "intent_legs",
  "intent_policy_allowed",
  "run_state",
  "approval_outcome",
] as const satisfies readonly FeedbackSpec["key"][];
