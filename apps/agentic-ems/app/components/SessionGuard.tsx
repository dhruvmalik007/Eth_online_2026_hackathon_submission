"use client";

import { useEffect, useRef, useState } from "react";
import {
  useFastH3,
  useFastH3ClipFinished,
  useFastH3StateUpdate,
  type FastH3StateUpdateMessage,
} from "@reactor-models/fast-h3";

// SessionGuard — the hard billing guard.
//
// Reactor FastH3 bills session wall-clock, not generated seconds. A session
// left connected after a clip finishes burns credits while idle. This guard
// makes that state impossible to sustain:
//
//   - it latches the first sign of activity (a clip building or playing),
//   - and when the wire returns to fully idle — nothing building, nothing
//     ready to play, nothing playing — it starts a visible countdown and
//     disconnects the session when it expires.
//
// Any resumed activity (a new enqueue, another play) cancels the countdown.
// The grace window exists so a human can click "Snap last 10s" while the
// session is still live — the recording request needs a live session.

const IDLE_GRACE_SECONDS = 15;

export function SessionGuard() {
  const { status, disconnect } = useFastH3();
  const [snapshot, setSnapshot] = useState<FastH3StateUpdateMessage | null>(
    null,
  );
  useFastH3StateUpdate((msg) => setSnapshot(msg));

  const hadActivity = useRef(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  useFastH3ClipFinished(() => {
    // A clip just finished; mark the tick so the effect below re-evaluates.
    setSnapshot((prev) => (prev ? { ...prev } : prev));
  });

  const idle =
    snapshot !== null &&
    snapshot.generation_queued === 0 &&
    snapshot.playout_queued === 0 &&
    !snapshot.playing;

  useEffect(() => {
    if (status !== "ready") {
      hadActivity.current = false;
      setCountdown(null);
      return;
    }
    if (!snapshot) return;
    if (snapshot.generation_queued > 0 || snapshot.playing) {
      hadActivity.current = true;
      setCountdown(null);
      return;
    }
    if (!hadActivity.current || !idle) return;

    // Activity happened and the wire is fully idle — start the countdown.
    setCountdown(IDLE_GRACE_SECONDS);
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c === null) return null;
        if (c <= 1) {
          clearInterval(interval);
          void disconnect();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [status, snapshot, idle, disconnect]);

  if (status !== "ready" || countdown === null) return null;

  return (
    <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-2.5">
      <p className="text-[11px] leading-4 text-amber-300">
        Session idle — auto-disconnect in{" "}
        <span className="font-mono font-semibold">{countdown}s</span>. Click
        <span className="font-medium"> Snap last 10s</span> now to keep the
        recording; queueing another clip cancels this.
      </p>
    </div>
  );
}
