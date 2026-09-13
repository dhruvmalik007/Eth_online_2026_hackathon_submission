/**
 * The orchestrator — one turn, start to rest.
 *
 * It owns the run lifecycle, and it is the only place that:
 *   - moves a run through the shared `execution-domain` state machine,
 *   - decides the emitter's lifetime,
 *   - converts an agent's outcome (or its failure) into events.
 *
 * `beginTurn` returns as soon as the run exists and its emitter is open, so the
 * HTTP layer can hand a streaming response back to the client immediately while
 * the agent works. The run's completion is the returned `done` promise — awaited
 * by tests, ignored by the SSE route.
 */
import { canTransition, isRunTerminal, type RunState } from "@ethonline2026/execution-domain";
import type { ApprovalQueue } from "../approvals/ApprovalQueue.js";
import type { AgentMode } from "../events/contract.js";
import type { RunEventEmitter } from "../events/emitter.js";
import type { RunEventHub } from "../events/hub.js";
import { HttpError } from "../http.js";
import type { Tracing } from "../observability/tracing.js";
import { TurnTrace } from "../observability/turnTrace.js";
import type { SandboxProvider } from "../sandbox/SandboxProvider.js";
import type { SessionManager } from "../session/SessionManager.js";
import type { RunRegistry } from "../session/SessionManager.js";
import type { CustodySigningPort } from "../web3/CustodySigningPort.js";
import { redactSecrets, RunLimiter, RunTimeoutError, withTimeout } from "./guardrails.js";
import type { AgentPort } from "./AgentPort.js";

/** Bound on retained turn traces, so an instance cannot grow without limit. */
const MAX_RETAINED_TRACES = 500;

export interface OrchestratorOptions {
  readonly sessions: SessionManager;
  readonly runs: RunRegistry;
  readonly hub: RunEventHub;
  readonly agents: ReadonlyMap<AgentMode, AgentPort>;
  readonly approvals: ApprovalQueue;
  readonly sandbox: SandboxProvider;
  readonly custody: CustodySigningPort;
  readonly tracing: Tracing;
  readonly maxConcurrentRuns: number;
  readonly runTimeoutMs: number;
}

export interface TurnRequest {
  readonly userId: string;
  readonly sessionId: string;
  readonly query: string;
  readonly mode: AgentMode;
  readonly pools: readonly string[];
  readonly protocols: readonly string[];
  readonly horizonDays: number;
  readonly dry: boolean;
}

export interface TurnResult {
  readonly runId: string;
  readonly state: RunState;
  readonly summary: string;
}

export interface TurnHandle {
  readonly runId: string;
  readonly emitter: RunEventEmitter;
  readonly done: Promise<TurnResult>;
}

export class Orchestrator {
  readonly #options: OrchestratorOptions;
  readonly #limiter: RunLimiter;
  /** Turn traces, retained so an approval can attach its outcome after the fact. */
  readonly #traces = new Map<string, TurnTrace>();

  constructor(options: OrchestratorOptions) {
    this.#options = options;
    this.#limiter = new RunLimiter(options.maxConcurrentRuns);
  }

  get activeRuns(): number {
    return this.#limiter.active;
  }

  get capacity(): number {
    return this.#limiter.capacity;
  }

  /**
   * Admit a turn: validate the session, reserve capacity, create the run, open the
   * event stream, and start the agent in the background.
   */
  async beginTurn(request: TurnRequest): Promise<TurnHandle> {
    await this.#options.sessions.requireOpen(request.userId, request.sessionId);

    if (!this.#limiter.acquire()) {
      throw new HttpError(
        "CONFLICT",
        `Instance is at capacity (${this.#limiter.capacity} concurrent runs). Retry shortly.`,
      );
    }

    let runId: string;
    try {
      const record = await this.#options.runs.create({
        userId: request.userId,
        sessionId: request.sessionId,
      });
      runId = record.runId;
    } catch (error) {
      this.#limiter.release();
      throw error;
    }

    const emitter = this.#options.hub.open(runId);
    // Every proposed intent lands in the HITL queue the moment it is emitted, so
    // an approval can never be resolved without a recorded request behind it.
    emitter.subscribe((event) => {
      if (event.type === "approval.requested") {
        this.#options.approvals.request(event.intent, runId);
      }
    });

    emitter.emit({
      type: "session.started",
      sessionId: request.sessionId,
      runId,
      agent: request.mode,
      dry: request.dry,
    });

    // The trace is built from the same event stream the UI renders, so the
    // dashboard and the screen cannot disagree about what happened. Attached but
    // not awaited: the turn runs in the background.
    if (this.#options.tracing.enabled) {
      const trace = new TurnTrace(this.#options.tracing, {
        runId,
        sessionId: request.sessionId,
        query: request.query,
        mode: request.mode,
        dry: request.dry,
        pools: request.pools,
        protocols: request.protocols,
        horizonDays: request.horizonDays,
      });
      this.#traces.set(runId, trace);
      if (this.#traces.size > MAX_RETAINED_TRACES) {
        const oldest = this.#traces.keys().next();
        if (!oldest.done) this.#traces.delete(oldest.value);
      }
      void trace.attach(emitter);
    }

    await this.#options.sessions.touch(request.userId, request.sessionId);

    const done = this.#execute(request, runId, emitter).finally(() => {
      this.#limiter.release();
    });

    return { runId, emitter, done };
  }

  /**
   * Attach a resolved approval to its run's trace.
   *
   * The approval lands long after the model work finished, and it is the single
   * most useful metric on the dashboard — so it is recorded as a feedback score
   * on the run rather than lost.
   */
  async recordApproval(runId: string, intentId: string, outcome: string): Promise<void> {
    await this.#traces.get(runId)?.recordApproval({ intentId, outcome });
  }

  /**
   * Finish a run's trace: wait for its queued runs to be posted and ended.
   *
   * Called while the SSE response is still open, because Cloud Run throttles CPU
   * the moment it closes — a batch still in flight would be dropped.
   */
  async drainTrace(runId: string): Promise<void> {
    await this.#traces.get(runId)?.drain();
  }

  async #execute(
    request: TurnRequest,
    runId: string,
    emitter: RunEventEmitter,
  ): Promise<TurnResult> {
    const { sessions, runs, agents, sandbox } = this.#options;
    const controller = new AbortController();

    let record = await runs.advance(request.userId, runId, "simulating");

    try {
      const agent = agents.get(request.mode);
      if (agent === undefined) {
        throw new HttpError("MODEL_UNAVAILABLE", `No agent registered for mode \`${request.mode}\`.`);
      }

      const outcome = await withTimeout(
        agent.run(
          {
            query: request.query,
            mode: request.mode,
            pools: request.pools,
            protocols: request.protocols,
            horizonDays: request.horizonDays,
            dry: request.dry,
          },
          {
            emit: (event) => emitter.emit(event),
            signal: controller.signal,
            sandbox,
            custody: this.#options.custody,
            userId: request.userId,
            sessionId: request.sessionId,
            runId,
          },
        ),
        this.#options.runTimeoutMs,
        controller.signal,
      );

      // The agent has produced its ranking; `awaiting_user` is then reachable.
      if (canTransition(record.state, "ranked")) {
        record = await runs.advance(request.userId, runId, "ranked");
      }
      if (outcome.state !== record.state) {
        if (!canTransition(record.state, outcome.state)) {
          throw new HttpError(
            "ILLEGAL_TRANSITION",
            `A run in \`${record.state}\` cannot move to \`${outcome.state}\`.`,
          );
        }
        record = await runs.advance(request.userId, runId, outcome.state);
      }

      emitter.emit({
        type: "run.completed",
        runId,
        state: record.state,
        summary: redactSecrets(outcome.summary),
      });
      return { runId, state: record.state, summary: outcome.summary };
    } catch (error) {
      const code =
        error instanceof HttpError
          ? error.code
          : error instanceof RunTimeoutError
            ? "MODEL_UNAVAILABLE"
            : "INTERNAL";
      const message = redactSecrets(error instanceof Error ? error.message : String(error));

      emitter.emit({ type: "error", code, message, details: null });
      if (canTransition(record.state, "failed")) {
        record = await runs.advance(request.userId, runId, "failed");
      }
      emitter.emit({
        type: "run.completed",
        runId,
        state: record.state,
        summary: `Run failed: ${message}`,
      });
      return { runId, state: record.state, summary: message };
    } finally {
      await sessions.touch(request.userId, request.sessionId);
      // A terminal run will never emit again: release the stream. A run resting in
      // `awaiting_user` stays open, because the approval is still to come.
      if (isRunTerminal(record.state)) {
        this.#options.hub.close(runId);
      }
    }
  }
}
