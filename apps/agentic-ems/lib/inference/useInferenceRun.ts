"use client";

/**
 * Drive a component from a live inference run.
 *
 * This is the bridge D3 needs: it replaces the scripted choreography (a `runScript`
 * that walked a hard-coded sequence with `sleep()`s, feeding fixture steps to the
 * UI) with the service's own event stream. Two consequences worth knowing:
 *
 *   - **Timing comes from the service.** The `sleep()`-based pacing disappears; a
 *     step appears when the agent actually starts it. Progress is real, not staged.
 *   - **The session is sticky.** The first turn creates a session and the route
 *     reports its id; later turns reuse it, so "rebalance the rest" is a follow-up
 *     in the same conversation rather than a fresh one.
 *
 * Partial output is kept on failure. A half-finished trace is far more useful for
 * debugging than a trace that vanishes the moment the stream errors, so `failure` is
 * set *alongside* whatever was reduced rather than resetting it.
 */
import { useCallback, useRef, useState } from "react";
import {
  SseFrameDecoder,
  emptyRunState,
  parseInferenceEvent,
  reduceEvent,
  type InferenceRunState,
} from "./stream";

export interface StartTurnOptions {
  query: string;
  mode?: "v01" | "deep";
  dry?: boolean;
}

export interface InferenceRun {
  state: InferenceRunState;
  running: boolean;
  /** A human-readable failure, kept separate from `state.error`, which is the *agent's* error. */
  failure: string | null;
  start: (options: StartTurnOptions) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

export function useInferenceRun(): InferenceRun {
  const [state, setState] = useState<InferenceRunState>(emptyRunState);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    sessionIdRef.current = null;
    setState(emptyRunState());
    setFailure(null);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }, []);

  const start = useCallback(async ({ query, mode = "v01", dry = true }: StartTurnOptions) => {
    if (query.trim().length === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setFailure(null);
    // Keep the session across turns, but start this turn's trace clean.
    setState({ ...emptyRunState(), sessionId: sessionIdRef.current });

    try {
      const response = await fetch("/api/inference", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query,
          mode,
          dry,
          ...(sessionIdRef.current === null ? {} : { sessionId: sessionIdRef.current }),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // The route distinguishes "not configured" from "service failed"; show that
        // distinction rather than collapsing both into "something went wrong".
        const detail = await response
          .json()
          .then((body: { error?: string; detail?: string }) =>
            [body.error, body.detail].filter(Boolean).join(" — "),
          )
          .catch(() => `HTTP ${response.status}`);
        setFailure(detail.length > 0 ? detail : `HTTP ${response.status}`);
        return;
      }

      const sessionId = response.headers.get("x-inference-session-id");
      if (sessionId !== null && sessionId.length > 0) sessionIdRef.current = sessionId;

      const runId = response.headers.get("x-inference-run-id");
      if (runId !== null) {
        setState((previous) => ({ ...previous, runId }));
      }

      if (response.body === null) {
        setFailure("the service returned an empty stream");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const frames = new SseFrameDecoder();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const payload of frames.push(decoder.decode(value, { stream: true }))) {
          const event = parseInferenceEvent(payload);
          // Dropping an unparseable frame is deliberate: one malformed event should
          // not discard a turn's worth of real ones.
          if (event !== null) setState((previous) => reduceEvent(previous, event));
        }
      }
    } catch (error) {
      // An abort is a user action, not a failure to report.
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setFailure(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
    }
  }, []);

  return { state, running, failure, start, cancel, reset };
}
