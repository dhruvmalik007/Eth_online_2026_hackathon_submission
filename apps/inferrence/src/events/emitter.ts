/**
 * Ordered, replayable event emission for one run.
 *
 * The emitter is the only thing that assigns `seq`, so ordering is a property of
 * one object rather than a convention spread across the orchestrator. It keeps a
 * bounded in-memory tail for live subscribers and hands every event to an
 * optional journal hook (ROADMAP T1.3) so a reconnecting client can replay.
 */
import {
  INFERENCE_EVENT_VERSION,
  InferenceEventSchema,
  type EventSink,
  type InferenceEvent,
  type InferenceEventInput,
} from "./contract.js";

export interface RunEventEmitterOptions {
  readonly runId: string;
  /** Journal hook — persisted off-process in the real deployment. */
  readonly onEvent?: EventSink;
  readonly now?: () => Date;
  /** Bound on the in-memory replay tail. */
  readonly historyLimit?: number;
}

export class RunEventEmitter {
  readonly runId: string;
  #seq = 0;
  #closed = false;
  #now: () => Date;
  #onEvent: EventSink | undefined;
  #historyLimit: number;
  #history: InferenceEvent[] = [];
  #sinks = new Set<EventSink>();

  constructor(options: RunEventEmitterOptions) {
    this.runId = options.runId;
    this.#onEvent = options.onEvent;
    this.#now = options.now ?? (() => new Date());
    this.#historyLimit = options.historyLimit ?? 2_000;
  }

  /** Stamp and publish. Throws after {@link close} so a late tool cannot emit into a finished run. */
  emit(input: InferenceEventInput): InferenceEvent {
    if (this.#closed) {
      throw new Error(`run ${this.runId} is closed; refusing to emit ${input.type}`);
    }
    this.#seq += 1;
    const event = InferenceEventSchema.parse({
      ...input,
      v: INFERENCE_EVENT_VERSION,
      seq: this.#seq,
      ts: this.#now().toISOString(),
    });
    this.#history.push(event);
    if (this.#history.length > this.#historyLimit) {
      this.#history.splice(0, this.#history.length - this.#historyLimit);
    }
    this.#onEvent?.(event);
    for (const sink of this.#sinks) sink(event);
    return event;
  }

  /** Live subscription. Returns the unsubscribe function. */
  subscribe(sink: EventSink): () => void {
    this.#sinks.add(sink);
    return () => {
      this.#sinks.delete(sink);
    };
  }

  /** Events newer than `seq`, for a reconnecting client. */
  since(seq: number): InferenceEvent[] {
    return this.#history.filter((event) => event.seq > seq);
  }

  get lastSeq(): number {
    return this.#seq;
  }

  get closed(): boolean {
    return this.#closed;
  }

  close(): void {
    this.#closed = true;
    this.#sinks.clear();
  }
}
