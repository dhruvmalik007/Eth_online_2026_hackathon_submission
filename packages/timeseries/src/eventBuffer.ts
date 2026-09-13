/**
 * The write buffer — T1.3.
 *
 * The lifecycle emits an event per state change, so one execution produces
 * hundreds of rows. Writing each as it happens would be hundreds of round trips
 * against a five-connection pool, which on a capped free tier is the difference
 * between a handful of queries and a connection storm. This buffers events in
 * memory and flushes the whole batch as **one** multi-row statement.
 *
 * ## Why a buffer rather than a bigger pool
 *
 * The instinct is to widen `TIMESERIES_DB_MAX_CONNECTIONS`. That is exactly the
 * wrong lever: the pool cap is what keeps the instance inside the free tier's
 * limit, so widening it trades a bill for latency. Batching keeps the connection
 * count where it is and removes the round trips instead.
 *
 * ## The two failure properties that matter
 *
 * - **A failed flush must not lose events.** The batch is put back on the queue
 *   when the insert throws, so a transient database blip is retried by the next
 *   flush rather than silently dropping a trace. The caller still sees the
 *   error — swallowing it would make a broken store look healthy.
 * - **A replay must not double-publish.** `recordEvents` is idempotent
 *   (`ON CONFLICT DO NOTHING`), so re-flushing after a crash inserts nothing;
 *   {@link FlushResult.inserted} carries the real count so a caller only fan-outs
 *   what was actually written.
 *
 * The buffer is deliberately I/O-free apart from the repository it is handed: it
 * takes a `Pick<ExecutionRepository, "recordEvents">`, so a test can supply a
 * plain fake and never touch a database.
 */
import type {
  ExecutionEventRow,
  ExecutionRepository,
} from "./executionHistory.js";

/** What the repository needs to expose for the buffer to work. */
export type EventSinkRepository = Pick<ExecutionRepository, "recordEvents">;

/** The outcome of one flush, delivered to the optional observer. */
export interface FlushResult {
  /** The events that were flush attempts. */
  readonly events: readonly ExecutionEventRow[];
  /** How many rows the statement actually inserted — zero on a replay. */
  readonly inserted: number;
}

export interface EventBufferOptions {
  /**
   * Flush as soon as this many events are queued. Bounds memory in one instance,
   * so a slow database cannot turn the buffer into an unbounded array.
   */
  readonly maxEvents: number;
  /**
   * Observes each flush **after** it commits. This is where the WebSocket hub
   * fans out — called with the events that were written, so a saturated socket
   * is a delivery concern rather than a durability one.
   */
  readonly onFlush?: (result: FlushResult) => void | Promise<void>;
}

export class ExecutionEventBuffer {
  private pending: ExecutionEventRow[] = [];
  /** Serializes flushes so two overlapping calls cannot reorder a batch. */
  private inFlight: Promise<number> | null = null;

  constructor(
    private readonly repository: EventSinkRepository,
    private readonly options: EventBufferOptions,
  ) {
    if (!Number.isInteger(options.maxEvents) || options.maxEvents < 1) {
      throw new Error(`maxEvents must be a positive integer (got ${options.maxEvents})`);
    }
  }

  /** How many events are waiting to be written. */
  get size(): number {
    return this.pending.length;
  }

  get isEmpty(): boolean {
    return this.pending.length === 0;
  }

  /**
   * Queue one event, flushing when the bound is reached.
   *
   * The returned promise resolves when the event has been queued — and when it
   * has been **written**, if this call is the one that tripped the threshold.
   * Callers that do not await lose the backpressure signal but not the event;
   * an unhandled rejection is possible, so a long-lived caller should await.
   */
  async add(event: ExecutionEventRow): Promise<void> {
    this.pending.push(event);
    if (this.pending.length >= this.options.maxEvents) await this.flush();
  }

  /**
   * Write every queued event as one statement.
   *
   * A flush already in flight is awaited first, so the batches never interleave
   * and the event order in the log matches the order they were queued.
   *
   * @returns The number of rows inserted (zero on a replay).
   */
  async flush(): Promise<number> {
    if (this.inFlight !== null) await this.inFlight;
    if (this.pending.length === 0) return 0;

    const batch = this.pending;
    this.pending = [];
    this.inFlight = this.write(batch);

    try {
      const inserted = await this.inFlight;
      await this.options.onFlush?.({ events: batch, inserted });
      return inserted;
    } catch (err) {
      // Put the events back at the front so the next flush retries them, and
      // re-throw so the failure is not silently absorbed.
      this.pending = [...batch, ...this.pending];
      throw err;
    } finally {
      this.inFlight = null;
    }
  }

  /** The repository call, separated so the in-flight bookkeeping stays readable. */
  private async write(batch: readonly ExecutionEventRow[]): Promise<number> {
    return this.repository.recordEvents(batch);
  }
}
