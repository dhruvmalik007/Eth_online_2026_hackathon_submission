/**
 * The event journal — durability for a stream.
 *
 * `RunEventHub` keeps a bounded in-memory tail; the journal is the append-only
 * record a reconnecting client replays from (`GET /v1/runs/:id/events?sinceSeq=`).
 * In production this is the `exec_events` hypertable (180-day retention) written
 * through `ExecutionRepository` — ROADMAP T1.3. The in-memory implementation
 * here is what the scaffold and tests use, and it is deliberately synchronous on
 * the hot path so emission never awaits disk in the middle of a run.
 */
import type { InferenceEvent } from "../events/contract.js";

export interface EventJournal {
  /** Hot path: must not throw and must not await. */
  append(runId: string, event: InferenceEvent): void;
  read(runId: string, sinceSeq: number): Promise<InferenceEvent[]>;
  lastSeq(runId: string): Promise<number>;
}

export class InMemoryEventJournal implements EventJournal {
  readonly #byRun = new Map<string, InferenceEvent[]>();
  readonly #limit: number;

  constructor(limit = 10_000) {
    this.#limit = limit;
  }

  append(runId: string, event: InferenceEvent): void {
    const events = this.#byRun.get(runId) ?? [];
    events.push(event);
    if (events.length > this.#limit) events.splice(0, events.length - this.#limit);
    this.#byRun.set(runId, events);
  }

  async read(runId: string, sinceSeq: number): Promise<InferenceEvent[]> {
    return (this.#byRun.get(runId) ?? []).filter((event) => event.seq > sinceSeq);
  }

  async lastSeq(runId: string): Promise<number> {
    const events = this.#byRun.get(runId) ?? [];
    return events.at(-1)?.seq ?? 0;
  }
}
