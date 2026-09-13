"use client";

import { useEffect, useRef, useState } from "react";
import {
  useFastH3,
  useFastH3ClipStarted,
} from "@reactor-models/fast-h3";
import { parseTag } from "../lib/tag";

// AutoCapture — per-clip capture, download, and session shutdown.
//
// Multi-clip safe: every `clip_started` whose clip_id has not been captured
// yet arms its own recording request, so a chained episode (autoplay handing
// clip to clip) captures ALL of its clips. The GPU session is closed only
// when the LAST download finishes AND both queues are drained — mid-run
// downloads leave the session alive for the remaining clips.
//
// Capture timing: the request is armed at `clip_started` for exactly that
// clip's length, so the recording window fills precisely as playback does —
// clicked-late requests would wait on a window that never fills.

const SHUTDOWN_AFTER_LAST_DOWNLOAD_S = 5;

type ClipPhase =
  | { state: "capturing" }
  | { state: "downloading" }
  | { state: "saved"; filename: string }
  | { state: "failed"; message: string };

interface CaptureEntry {
  scene: number | null;
  phase: ClipPhase;
}

export function AutoCapture() {
  const { status, disconnect, downloadClipAsFile, jwtToken } = useFastH3();
  const requestClipRef = useRef<((seconds: number) => Promise<unknown>) | null>(
    null,
  );

  const [captures, setCaptures] = useState<Record<string, CaptureEntry>>({});
  const capturedIds = useRef<Set<string>>(new Set());
  const sessionArmed = useRef(false);

  const storeRequestClip = useFastH3RequestClip();
  useEffect(() => {
    requestClipRef.current = storeRequestClip;
  }, [storeRequestClip]);

  // Re-arm on every new session (the id set is per-session).
  useEffect(() => {
    if (status !== "ready") {
      capturedIds.current = new Set();
      sessionArmed.current = false;
      setCaptures({});
    }
  }, [status]);

  useFastH3ClipStarted((msg) => {
    const clipId = msg.clip.clip_id;
    if (!clipId || capturedIds.current.has(clipId)) return;
    capturedIds.current.add(clipId);
    sessionArmed.current = true;

    const seconds = Number(msg.clip.seconds) || 10;
    const tag = parseTag(msg.clip.metadata ?? "");
    const scene = tag?.scene ?? null;
    const filename = `agentic-ems-scene${scene ? `-${String(scene).padStart(2, "0")}` : ""}-${clipId.slice(0, 8)}.mp4`;

    setCaptures((prev) => ({ ...prev, [clipId]: { scene, phase: { state: "capturing" } } }));

    (async () => {
      try {
        const requestClip = requestClipRef.current;
        if (!requestClip) throw new Error("Recorder not ready");
        const clip = (await requestClip(seconds)) as Parameters<
          typeof downloadClipAsFile
        >[0];
        setCaptures((prev) => ({
          ...prev,
          [clipId]: { scene, phase: { state: "downloading" } },
        }));
        // The manifest GET is auth-scoped: pass the session's own JWT —
        // the same token the session was created with.
        const jwt =
          typeof jwtToken === "function" ? await jwtToken() : jwtToken;
        if (!jwt) throw new Error("No JWT available for the manifest fetch");
        await downloadClipAsFile(clip, filename, { jwt });
        setCaptures((prev) => ({
          ...prev,
          [clipId]: { scene, phase: { state: "saved", filename } },
        }));
      } catch (e) {
        setCaptures((prev) => ({
          ...prev,
          [clipId]: {
            scene,
            phase: { state: "failed", message: e instanceof Error ? e.message : String(e) },
          },
        }));
      }
    })();
  });

  // Shutdown gate: when every armed capture is saved and the queues are
  // drained, close the GPU session after the 5-second countdown.
  const entries = Object.values(captures);
  const allSaved =
    sessionArmed.current &&
    entries.length > 0 &&
    entries.every((c) => c.phase.state === "saved" || c.phase.state === "failed");

  const [shutdownIn, setShutdownIn] = useState<number | null>(null);
  const shutdown = useRef(false);

  useEffect(() => {
    if (status !== "ready") {
      shutdown.current = false;
      setShutdownIn(null);
      return;
    }
    // A new clip appearing re-arms the shutdown gate for its own download.
    if (!allSaved) {
      shutdown.current = false;
      setShutdownIn(null);
      return;
    }
    if (shutdown.current) {
      setShutdownIn(null);
      return;
    }
    shutdown.current = true;
    setShutdownIn(SHUTDOWN_AFTER_LAST_DOWNLOAD_S);
    const interval = setInterval(() => {
      setShutdownIn((c) => {
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
  }, [status, allSaved, disconnect]);

  if (status !== "ready" || entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-cyan-700/60 bg-cyan-950/30 p-2.5">
      <span className="text-[10px] uppercase tracking-wider text-cyan-500">
        AutoCapture
      </span>
      <ul className="mt-1.5 space-y-1">
        {entries.map((entry, i) => (
          <li
            key={i}
            className={`text-[11px] leading-4 ${
              entry.phase.state === "failed"
                ? "text-red-300"
                : entry.phase.state === "saved"
                  ? "text-green-300"
                  : "text-cyan-300"
            }`}
          >
            {entry.scene !== null && `Scene ${String(entry.scene).padStart(2, "0")} · `}
            {entry.phase.state === "capturing" && "capturing…"}
            {entry.phase.state === "downloading" && "downloading MP4…"}
            {entry.phase.state === "saved" && `saved ${entry.phase.filename}`}
            {entry.phase.state === "failed" && `failed: ${entry.phase.message}`}
          </li>
        ))}
      </ul>
      {shutdownIn !== null && (
        <p className="mt-1.5 text-[11px] text-green-300">
          All clips saved — closing the GPU session in{" "}
          <span className="font-mono font-semibold">{shutdownIn}s</span>.
        </p>
      )}
    </div>
  );
}

// Narrow selector hook — keeps the component re-rendering only when the
// recording surface changes.
import { useReactor } from "@reactor-team/js-sdk";
function useFastH3RequestClip() {
  return useReactor((s) => s.requestClip);
}
