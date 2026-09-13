/**
 * Live subscriptions per run.
 *
 * A run's events are emitted by the orchestrator, consumed by zero or more SSE
 * clients (the Next.js proxy, a CLI), and written to the journal. The hub owns
 * the runId → emitter map so a second client attaching mid-run gets the
 * in-memory tail and the journal covers everything older.
 */
import type { InferenceEvent, InferenceEventInput } from "./contract.js";
import { RunEventEmitter } from "./emitter.js";

export interface RunEventHubOptions {
  readonly historyLimit?: number;
  readonly now?: () => Date;
}

export class RunEventHub {
  readonly #emitters = new Map<string, RunEventEmitter>();
  readonly #journalHook: ((runId: string, event: InferenceEvent) => void) | undefined;
  readonly #options: RunEventHubOptions;

  constructor(
    onEvent?: (runId: string, event: InferenceEvent) => void,
    options: RunEventHubOptions = {},
  ) {
    this.#journalHook = onEvent;
    this.#options = options;
  }

  /** Start (or restart) a run's emitter. */
  open(runId: string): RunEventEmitter {
    const existing = this.#emitters.get(runId);
    if (existing !== undefined && !existing.closed) return existing;

    const emitter = new RunEventEmitter({
      runId,
      ...(this.#journalHook === undefined
        ? {}
        : { onEvent: (event: InferenceEvent) => this.#journalHook?.(runId, event) }),
      ...(this.#options.now === undefined ? {} : { now: this.#options.now }),
      ...(this.#options.historyLimit === undefined
        ? {}
        : { historyLimit: this.#options.historyLimit }),
    });
    this.#emitters.set(runId, emitter);
    return emitter;
  }

  get(runId: string): RunEventEmitter | undefined {
    return this.#emitters.get(runId);
  }

  /** Emit onto an open run, or throw if the run is unknown/closed. */
  emit(runId: string, input: InferenceEventInput): InferenceEvent {
    const emitter = this.#emitters.get(runId);
    if (emitter === undefined) throw new Error(`no open event stream for run ${runId}`);
    return emitter.emit(input);
  }

  close(runId: string): void {
    this.#emitters.get(runId)?.close();
    this.#emitters.delete(runId);
  }

  get openRuns(): number {
    return this.#emitters.size;
  }
}
