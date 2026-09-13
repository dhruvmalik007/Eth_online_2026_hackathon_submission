/**
 * SSE framing for a run's event stream.
 *
 * Returns a Node `Readable`, which is what Fastify pipes to the socket — and,
 * importantly, what `app.inject` can collect in a test, so the streaming surface
 * is covered by the offline suite rather than only by hand.
 *
 * Two behaviours are deliberate:
 *   - Replay first. Everything the emitter already produced (`sinceSeq`) is written
 *     before subscribing, so a client that attaches late — or reconnects with
 *     `Last-Event-ID` — sees a complete, gap-free history. Ordering and de-dup
 *     come from the emitter's monotonic `seq`.
 *   - Heartbeats. An idle run (say, `awaiting_user` for a hardware approval) would
 *     otherwise look like a dead connection to a proxy, so a comment frame is
 *     written every `heartbeatMs`.
 */
import { Readable } from "node:stream";
import { serializeSse, type InferenceEvent } from "../events/contract.js";
import type { RunEventEmitter } from "../events/emitter.js";

export interface CreateEventStreamOptions {
  readonly heartbeatMs: number;
  readonly signal: AbortSignal;
  readonly sinceSeq?: number;
  /**
   * Event types that end the stream once observed. A one-shot consumer (the CLI,
   * a test) closes on `run.completed`; a UI that wants the approval too leaves
   * this empty and keeps following.
   */
  readonly closeOn?: readonly InferenceEvent["type"][];
  /**
   * Awaited **before the stream ends**, so the response stays open while it runs.
   *
   * This exists for tracing: on Cloud Run, CPU is throttled as soon as the
   * response closes, so a trace batch still in flight is dropped. Flushing after
   * the stream finishes is too late; flushing here is not.
   */
  readonly beforeEnd?: () => Promise<void>;
}

export function createEventStream(
  emitter: RunEventEmitter,
  options: CreateEventStreamOptions,
): Readable {
  const closeOn = new Set<InferenceEvent["type"]>(options.closeOn ?? []);

  async function* generate(): AsyncGenerator<string> {
    for (const event of emitter.since(options.sinceSeq ?? 0)) {
      yield serializeSse(event);
    }

    const queue: InferenceEvent[] = [];
    let notify: (() => void) | undefined;
    const unsubscribe = emitter.subscribe((event) => {
      queue.push(event);
      notify?.();
      notify = undefined;
    });
    const onAbort = (): void => {
      notify?.();
      notify = undefined;
    };
    options.signal.addEventListener("abort", onAbort, { once: true });

    try {
      while (!options.signal.aborted) {
        const next = queue.shift();
        if (next !== undefined) {
          yield serializeSse(next);
          if (closeOn.has(next.type)) break;
          continue;
        }
        // Nothing buffered and the run can never emit again: end the stream.
        if (emitter.closed) break;

        let timer: NodeJS.Timeout | undefined;
        const heartbeat = new Promise<void>((resolve) => {
          const handle = setTimeout(resolve, options.heartbeatMs);
          handle.unref();
          timer = handle;
        });
        const signalled = new Promise<void>((resolve) => {
          notify = resolve;
        });

        await Promise.race([signalled, heartbeat]);
        if (timer !== undefined) clearTimeout(timer);
        if (options.signal.aborted) break;
        if (queue.length === 0 && !emitter.closed) yield ": heartbeat\n\n";
      }
    } finally {
      options.signal.removeEventListener("abort", onAbort);
      unsubscribe();
      // Run while the response is still open. Swallowed deliberately: this hook
      // must never turn a completed run into a failed response.
      try {
        await options.beforeEnd?.();
      } catch {
        // The hook's own implementation is fail-open; nothing to add here.
      }
    }
  }

  return Readable.from(generate());
}
