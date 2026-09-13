/**
 * LangSmith tracing, structured to mirror the event stream.
 *
 * ## Why the trace is derived from `InferenceEvent`s
 *
 * The orchestrator is event-driven, not a nest of awaited function calls, so
 * `traceable()` cannot wrap it — the run's lifetime is not a single call. The
 * events are therefore the source: one LangSmith root run per turn, one child run
 * per `AgentStep`, one per external operation. That has a useful side effect —
 * **the dashboard and the UI cannot disagree**, because they are built from the
 * same stream.
 *
 * ## The two things that actually go wrong
 *
 * 1. **Cloud Run freezes and drops traces.** Tracing is backgrounded by default,
 *    so a throttled or frozen instance loses the batch. `blockOnRootRunFinalization`
 *    plus an explicit `flush()` at the end of every turn (and on SIGTERM) is the
 *    documented mitigation.
 * 2. **Wrong region.** An EU key against the US endpoint 403s on every call. This
 *    repo already learned that the hard way (`packages/langchain/docs/…walkthrough.md`),
 *    so `LANGSMITH_ENDPOINT` is honoured and a failure is a warning, never a crash.
 *
 * ## Metrics
 *
 * LangSmith aggregates count, latency, tokens, cost, feedback score and ratio —
 * **numeric metadata is not aggregatable.** So: latency comes from the run
 * itself, tokens/cost from `usage_metadata`, categorical facts from `tags`, and
 * per-operation numerics from **feedback scores**.
 *
 * Tracing is fail-open throughout: it must never be the reason a run fails.
 */
import type { Client as LangSmithClient } from "langsmith/client";
import type { RunTree } from "langsmith/run_trees";
import type { InferenceEnv } from "../env.js";
import { redactDeep } from "./redact.js";

export const TRACE_RUN_TYPES = [
  "chain",
  "llm",
  "tool",
  "retriever",
  "embedding",
  "prompt",
  "parser",
] as const;
export type TraceRunType = (typeof TRACE_RUN_TYPES)[number];

export interface TraceChildSpec {
  readonly name: string;
  readonly runType: TraceRunType;
  readonly inputs?: Record<string, unknown>;
  readonly tags?: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

export interface TraceEndSpec {
  readonly outputs?: Record<string, unknown>;
  readonly error?: string;
  readonly tags?: readonly string[];
}

export interface BeginTurnSpec {
  readonly name: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly inputs: Record<string, unknown>;
  readonly tags?: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

export interface FeedbackSpec {
  readonly key: string;
  readonly score?: number;
  readonly value?: string;
  readonly comment?: string;
}

/** One run in the trace tree. A no-op when tracing is disabled. */
export interface TraceRun {
  readonly id: string | null;
  child(spec: TraceChildSpec): Promise<TraceRun>;
  end(spec?: TraceEndSpec): Promise<void>;
  feedback(spec: FeedbackSpec): Promise<void>;
}

export interface Tracing {
  readonly enabled: boolean;
  beginTurn(spec: BeginTurnSpec): Promise<TraceRun>;
  /**
   * Attach feedback to a run **after** the fact, addressed by our own run id.
   *
   * Needed because an approval resolves outside the turn: the model work is long
   * finished by the time a human (or a policy) answers, and that answer is the
   * single most valuable metric on the dashboard.
   */
  recordFeedback(runId: string, spec: FeedbackSpec): Promise<void>;
  /** Drain pending batches. Call at the end of a turn and on SIGTERM. */
  flush(): Promise<void>;
}

const NOOP_RUN: TraceRun = {
  id: null,
  child: async () => NOOP_RUN,
  end: async () => undefined,
  feedback: async () => undefined,
};

/** The disabled implementation. Chosen when `LANGSMITH_TRACING` is off. */
export class NoopTracing implements Tracing {
  readonly enabled = false;
  async beginTurn(): Promise<TraceRun> {
    return NOOP_RUN;
  }
  async recordFeedback(): Promise<void> {
    return undefined;
  }
  async flush(): Promise<void> {
    return undefined;
  }
}

/** The real implementation. All failures are swallowed and logged. */
export class LangSmithTracing implements Tracing {
  readonly enabled = true;
  readonly #client: LangSmithClient;
  readonly #project: string;
  readonly #onWarn: (message: string) => void;
  /** Our run id → the LangSmith root run id, so feedback can be attached later. */
  readonly #traceByRun = new Map<string, string>();
  /**
   * The current turn's LangSmith root id, used as the feedback `session_id`.
   *
   * LangSmith requires that value to be a UUID and our own run ids are not (`run_1_2026-…`), which is
   * why feedback posted with one was rejected with a 422 and silently dropped — traces arrived, the
   * numbers did not. The root id is also the correct value semantically: it is what threads a turn's
   * feedback together.
   */
  #rootTraceId: string | undefined;

  constructor(options: {
    readonly client: LangSmithClient;
    readonly project: string;
    readonly onWarn?: (message: string) => void;
  }) {
    this.#client = options.client;
    this.#project = options.project;
    this.#onWarn = options.onWarn ?? ((): void => undefined);
  }

  async beginTurn(spec: BeginTurnSpec): Promise<TraceRun> {
    try {
      const { RunTree } = await import("langsmith/run_trees");
      const root = new RunTree({
        name: spec.name,
        run_type: "chain",
        inputs: redactDeep(spec.inputs) as Record<string, unknown>,
        tags: [...(spec.tags ?? [])],
        ...(spec.metadata === undefined
          ? {}
          : { metadata: redactDeep(spec.metadata) as Record<string, unknown> }),
        client: this.#client,
        project_name: this.#project,
      });
      await root.postRun();
      if (root.id !== undefined) {
        this.#traceByRun.set(spec.runId, root.id);
        this.#rootTraceId = root.id;
      }
      return new LangSmithRun(root, this.#onWarn, redactDeep);
    } catch (error) {
      this.#onWarn(`tracing: could not start run (${describe(error)})`);
      return NOOP_RUN;
    }
  }

  async recordFeedback(runId: string, spec: FeedbackSpec): Promise<void> {
    const traceId = this.#traceByRun.get(runId);
    if (traceId === undefined) return;
    try {
      await this.#client.createFeedback({
        runId: traceId,
        // The turn root's LangSmith id, not `runId` — see `#rootTraceId`. Omitted rather than guessed
        // when unknown: LangSmith accepts feedback without a session, and attaching it to a wrong one
        // would file a turn's numbers under another turn's thread.
        ...(this.#rootTraceId === undefined ? {} : { sessionId: this.#rootTraceId }),
        key: spec.key,
        ...(spec.score === undefined ? {} : { score: spec.score }),
        ...(spec.value === undefined ? {} : { value: spec.value }),
        ...(spec.comment === undefined ? {} : { comment: spec.comment }),
      });
    } catch (error) {
      this.#onWarn(`tracing: feedback ${spec.key} not recorded (${describe(error)})`);
    }
  }

  async flush(): Promise<void> {
    try {
      await this.#client.flush();
      await this.#client.awaitPendingTraceBatches();
    } catch (error) {
      this.#onWarn(`tracing: flush failed (${describe(error)})`);
    }
  }
}

class LangSmithRun implements TraceRun {
  readonly #root: RunTree;
  readonly #onWarn: (message: string) => void;
  readonly #redact: (value: unknown) => unknown;

  constructor(root: RunTree, onWarn: (message: string) => void, redact: (value: unknown) => unknown) {
    this.#root = root;
    this.#onWarn = onWarn;
    this.#redact = redact;
  }

  get id(): string | null {
    return this.#root.id ?? null;
  }

  async child(spec: TraceChildSpec): Promise<TraceRun> {
    try {
      const child = this.#root.createChild({
        name: spec.name,
        run_type: spec.runType,
        ...(spec.inputs === undefined
          ? {}
          : { inputs: this.#redact(spec.inputs) as Record<string, unknown> }),
        tags: [...(spec.tags ?? [])],
        ...(spec.metadata === undefined
          ? {}
          : { metadata: this.#redact(spec.metadata) as Record<string, unknown> }),
      });
      await child.postRun();
      return new LangSmithRun(child, this.#onWarn, this.#redact);
    } catch (error) {
      this.#onWarn(`tracing: could not start child run ${spec.name} (${describe(error)})`);
      return NOOP_RUN;
    }
  }

  async end(spec: TraceEndSpec = {}): Promise<void> {
    try {
      // `RunTree` exposes `tags` as a mutable field rather than an `addTags()`
      // method; appending before `end()` means `patchRun()` carries them up.
      if (spec.tags !== undefined && spec.tags.length > 0) {
        this.#root.tags = [...(this.#root.tags ?? []), ...spec.tags];
      }
      await this.#root.end(
        spec.outputs === undefined
          ? undefined
          : (this.#redact(spec.outputs) as Record<string, unknown>),
        spec.error,
      );
      await this.#root.patchRun();
    } catch (error) {
      this.#onWarn(`tracing: could not end run (${describe(error)})`);
    }
  }

  async feedback(spec: FeedbackSpec): Promise<void> {
    try {
      await this.#root.client.createFeedback({
        runId: this.#root.id,
        sessionId: this.#root.id,
        key: spec.key,
        ...(spec.score === undefined ? {} : { score: spec.score }),
        ...(spec.value === undefined ? {} : { value: spec.value }),
        ...(spec.comment === undefined ? {} : { comment: spec.comment }),
      });
    } catch (error) {
      this.#onWarn(`tracing: feedback ${spec.key} not recorded (${describe(error)})`);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Defer construction of the LangSmith client until a turn actually traces.
 *
 * The composition root is synchronous and is built on every cold start, so
 * importing the SDK there would put its cost on every boot — including boots
 * that never trace. `enabled` is still known synchronously, so callers can skip
 * the whole bridge cheaply when tracing is off.
 */
export class LazyTracing implements Tracing {
  readonly enabled = true;
  #inner: Tracing | null = null;
  #building: Promise<Tracing> | null = null;

  constructor(
    private readonly build: () => Promise<Tracing>,
    private readonly onWarn: (message: string) => void,
  ) {}

  async #resolve(): Promise<Tracing> {
    if (this.#inner !== null) return this.#inner;
    this.#building ??= this.build().catch((error: unknown) => {
      this.onWarn(`tracing: init failed, continuing untraced (${describe(error)})`);
      return new NoopTracing();
    });
    this.#inner = await this.#building;
    return this.#inner;
  }

  async beginTurn(spec: BeginTurnSpec): Promise<TraceRun> {
    return (await this.#resolve()).beginTurn(spec);
  }

  async recordFeedback(runId: string, spec: FeedbackSpec): Promise<void> {
    const inner = this.#inner;
    // Feedback arrives after the turn, so if tracing never initialised there is
    // nothing to attach to — and initialising now would create an empty trace.
    if (inner === null) return;
    await inner.recordFeedback(runId, spec);
  }

  async flush(): Promise<void> {
    const inner = this.#inner;
    if (inner === null) return;
    await inner.flush();
  }
}

/**
 * Build the tracer from config, without touching the SDK yet.
 *
 * Tracing is on only when it is explicitly enabled **and** a key is present, so a
 * deployment cannot accidentally emit traces it did not intend to, and a missing
 * key degrades to "off" rather than to a crash.
 *
 * The two "off" cases are **not** the same thing, and are now reported differently:
 *
 * - `LANGSMITH_TRACING` unset or false — a choice. Nothing is said.
 * - `LANGSMITH_TRACING` on with no key — a *misconfiguration*, and worse than a crash in one respect:
 *   it is indistinguishable from working until someone notices an empty dashboard, and by then they are
 *   debugging the instrumentation rather than the telemetry. The degradation is still to off, because a
 *   service must not refuse to boot over telemetry, but it now says so.
 */
export function createTracing(
  env: InferenceEnv,
  onWarn: (message: string) => void = (): void => undefined,
): Tracing {
  const apiKey = env.LANGSMITH_API_KEY;
  if (!env.LANGSMITH_TRACING) return new NoopTracing();

  if (apiKey === undefined || apiKey.length === 0) {
    onWarn(
      "LANGSMITH_TRACING is on but LANGSMITH_API_KEY is unset, so tracing is off and no traces will " +
        "appear. Set LANGSMITH_API_KEY, or set LANGSMITH_TRACING=false to silence this.",
    );
    return new NoopTracing();
  }

  const endpoint = env.LANGSMITH_ENDPOINT;
  const workspaceId = env.LANGSMITH_WORKSPACE_ID;
  const project = env.LANGSMITH_PROJECT;

  return new LazyTracing(async () => {
    const { Client } = await import("langsmith/client");
    const client = new Client({
      apiKey,
      ...(endpoint === undefined ? {} : { apiUrl: endpoint }),
      // Cloud Run throttles and freezes: wait for root-run finalization rather
      // than letting a backgrounded batch be dropped.
      blockOnRootRunFinalization: true,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    });
    return new LangSmithTracing({ client, project, onWarn });
  }, onWarn);
}
