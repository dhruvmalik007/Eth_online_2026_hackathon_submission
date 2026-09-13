"use client";

import { useEffect, useState } from "react";
import {
  useFastH3,
  useFastH3StateUpdate,
  type FastH3StateUpdateMessage,
} from "@reactor-models/fast-h3";
import {
  AGENTIC_EPISODE,
  DEFAULT_SCENES,
  DEFAULT_SCENE_SECONDS,
  EPISODE_IDEAS,
  MAX_SCENES,
  MAX_SCENE_SECONDS,
  type SceneSpec,
} from "../lib/prompts";
import { MAX_PROMPT_CHARS, validateEpisode } from "../lib/validate";
import { makeTag } from "../lib/tag";

// The episode composer — this example's signature flow.
//
// An episode is 1-6 scenes queued as ONE continuous video: each scene is
// enqueued with `continue_from_clip_id` naming the previous scene's clip
// and an explicit `seconds` (≤ 15 s hard cap for this demo), so its clip
// opens on that clip's final frame and autoplay hands the pair over with
// no cut to black.
//
// Scene text comes from either path:
//   - "Load the Agentic EMS demo": the hand-authored manifest in
//     lib/prompts.ts — five scenes, validated, ≤ 15 s each.
//   - "Write by hand": one editor per scene at the demo default length.
//
// Before anything is queued the manifest runs through lib/validate.ts —
// prompt length ≤ 800, seconds ≤ 15, hard cuts on continuations, speaker
// tags on every quoted line, positive-state phrasing, Agentic branding
// only, and every numeral traced to the scraped DeFiLlama snapshot or the
// single FICT anchor.
//
// Connection is deliberately lazy: nothing connects until you queue —
// compose and edit fully offline, then "Queue episode" connects on demand.

export function EpisodeComposer() {
  const { status, connect, enqueue, setAutoplay, getState } = useFastH3();
  const [snapshot, setSnapshot] = useState<FastH3StateUpdateMessage | null>(
    null,
  );
  useFastH3StateUpdate((msg) => setSnapshot(msg));
  useEffect(() => {
    if (status !== "ready") setSnapshot(null);
  }, [status]);

  const [idea, setIdea] = useState("");
  const [sceneCount, setSceneCount] = useState(DEFAULT_SCENES);
  const [title, setTitle] = useState("");
  const [scenes, setScenes] = useState<SceneSpec[]>([]);
  const [busy, setBusy] = useState<"queueing" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function writeByHand() {
    setError(null);
    setTitle(idea.slice(0, 60) || "Untitled episode");
    setScenes(
      Array.from({ length: sceneCount }, (_, i) => ({
        label: `Scene ${i + 1}`,
        prompt: "",
        seconds: DEFAULT_SCENE_SECONDS,
      })),
    );
  }

  function loadAgenticDemo() {
    setError(null);
    setIdea("");
    setTitle(AGENTIC_EPISODE.title);
    setSceneCount(AGENTIC_EPISODE.scenes.length);
    setScenes(AGENTIC_EPISODE.scenes.map((s) => ({ ...s })));
  }

  // Single-inference mode: pick any of the six 10-second scenes from the
  // dropdown, load it, queue it. Same validated manifest, one scene each.
  const [selectedScene, setSelectedScene] = useState(1);

  function loadSelectedScene() {
    loadScene(selectedScene as 1 | 2 | 3 | 4 | 5 | 6);
  }

  function loadScene(n: 1 | 2 | 3 | 4 | 5 | 6) {
    setError(null);
    setIdea("");
    const scene = AGENTIC_EPISODE.scenes[n - 1];
    setTitle(`Agentic EMS v1.2 — ${scene.label.replace(/^\d+\s+·\s+/, "")}`);
    setSceneCount(1);
    setScenes([{ ...scene }]);
  }

  async function queueEpisode() {
    setBusy("queueing");
    setError(null);
    try {
      // Validate BEFORE connecting — a failing scene must never touch the
      // wire. Issues are the same ones the editors show inline.
      const issues = validateEpisode(scenes);
      if (issues.length > 0) {
        throw new Error(
          `${issues.length} validation issue(s): ` +
            issues
              .slice(0, 3)
              .map((i) => `scene ${i.scene} [${i.rule}] ${i.message}`)
              .join(" · "),
        );
      }

      // Lazy connect: the episode was composed offline; the session starts
      // only now that there is something to build.
      if (status !== "ready") await connect();

      // Capacity gate, against a FRESH snapshot: the generation queue
      // refuses `enqueue` when full, and a partly queued episode is worse
      // than a clear refusal up front.
      const state = await getState();
      if (state) {
        // Single-inference guarantee: one 10-second clip in the system at a
        // time. Any live activity — building or ready to play — blocks a new
        // enqueue until it finishes or is popped.
        if (state.generation_queued > 0 || state.playout_queued > 0) {
          throw new Error(
            `One inference at a time: ${state.generation_queued} building, ` +
              `${state.playout_queued} ready. Let the current clip finish (or pop it), ` +
              `then queue the next.`,
          );
        }
        const free = state.generation_capacity - state.generation_queued;
        if (free < scenes.length) {
          throw new Error(
            `The generation queue has ${free} free slot(s) but the episode ` +
              `needs ${scenes.length}. Wait for builds to finish, pop queued ` +
              `clips, or queue a shorter episode.`,
          );
        }
        // Autoplay makes the playout queue self-starting, and it is what
        // performs the seamless chained handover between an episode's scenes.
        if (!state.autoplay) await setAutoplay({ enabled: true });
      }

      const episode = crypto.randomUUID().slice(0, 12);
      let previousClipId: string | undefined;
      for (const [index, scene] of scenes.entries()) {
        // Scene number from the manifest label ("01 · …"), not the array
        // position — single-scene loads must keep their real label number.
        const sceneNo = Number(scene.label.match(/^(\d+)/)?.[1] ?? index + 1);
        const reply = await enqueue({
          prompt: scene.prompt,
          seconds: scene.seconds,
          metadata: makeTag({
            episode,
            title,
            scene: sceneNo,
            scenes: scenes.length,
          }),
          // Scene 1 opens from text; every later scene opens on the
          // previous scene's final frame. The scene prompts open on hard
          // cuts, which is what keeps the chain from degrading.
          ...(previousClipId ? { continue_from_clip_id: previousClipId } : {}),
        });
        if (!reply) {
          // Refused — command_error above carries the model's reason.
          throw new Error(
            `Scene ${index + 1} was refused; the episode stops here. ` +
              `Scenes already queued will still play.`,
          );
        }
        previousClipId = reply.clip.clip_id;
      }
      setIdea("");
      setTitle("");
      setScenes([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const composed = scenes.length > 0;
  const allScenesWritten =
    composed && scenes.every((scene) => scene.prompt.trim().length > 0);
  const issues = composed ? validateEpisode(scenes) : [];
  const issuesByScene = new Map<number, string[]>();
  for (const issue of issues) {
    const list = issuesByScene.get(issue.scene) ?? [];
    list.push(`[${issue.rule}] ${issue.message}`);
    issuesByScene.set(issue.scene, list);
  }
  const totalSeconds = scenes.reduce((sum, s) => sum + (s.seconds || 0), 0);
  // Single-inference UI gate: block queueing while the wire shows a clip
  // building or ready — mirrors the hard getState() check in queueEpisode.
  const inferenceLive =
    snapshot !== null &&
    (snapshot.generation_queued > 0 || snapshot.playout_queued > 0);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Compose an episode
      </h2>

      {!composed && (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EPISODE_IDEAS.map((preset) => (
              <button
                key={preset.title}
                onClick={() => setIdea(preset.idea)}
                className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              >
                {preset.title}
              </button>
            ))}
          </div>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="One rough idea — e.g. a night shift on the Agentic floor…"
            rows={2}
            className="mt-2 w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 p-2 text-sm outline-none focus:border-zinc-600"
          />
          <div className="mt-2 flex items-center gap-2">
            <label className="text-xs text-zinc-500">Scenes</label>
            <select
              value={sceneCount}
              onChange={(e) => setSceneCount(Number(e.target.value))}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs"
            >
              {Array.from({ length: MAX_SCENES }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button
              onClick={writeByHand}
              disabled={busy !== null}
              className="whitespace-nowrap rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 disabled:opacity-40"
            >
              Write by hand
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <label className="text-xs text-zinc-500">Scene</label>
            <select
              value={selectedScene}
              onChange={(e) => setSelectedScene(Number(e.target.value))}
              className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs"
            >
              {AGENTIC_EPISODE.scenes.map((s, i) => (
                <option key={i + 1} value={i + 1}>
                  {s.label} · {s.seconds}s
                </option>
              ))}
            </select>
            <button
              onClick={loadSelectedScene}
              disabled={busy !== null}
              className="whitespace-nowrap rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-fg disabled:opacity-40"
            >
              Load scene
            </button>
          </div>
          <button
            onClick={loadAgenticDemo}
            disabled={busy !== null}
            className="mt-2 text-[11px] text-zinc-600 underline hover:text-zinc-400"
          >
            or load the full 6-scene arc ({AGENTIC_EPISODE.scenes.reduce((a, s) => a + s.seconds, 0)}s)
          </button>
          <p className="mt-2 text-[11px] leading-4 text-zinc-600">
            Single-inference mode for the Phase 1 + 2 capture: load one
            10-second scene at a time, queue it, let it play, snap it, then
            load the next. The queue button blocks while any clip is building
            or ready, so one inference runs in Reactor at any moment.
          </p>
        </>
      )}

      {composed && (
        <>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Episode title"
            className="mt-2 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm outline-none focus:border-zinc-600"
          />
          <p className="mt-2 text-[11px] leading-4 text-zinc-500">
            Scenes play as <b>one continuous video</b>: each clip opens on the
            previous clip&apos;s last frame. Keep every scene self-contained, and
            open every scene after the first on a <b>hard cut</b> to a new,
            fully described shot (&quot;Hard cut to a wide shot of …&quot;) — extending
            one take across scenes degrades the picture.
          </p>
          {scenes.map((scene, index) => (
            <div key={index} className="mt-2">
              <div className="flex items-baseline justify-between gap-2">
                <label className="text-[11px] text-zinc-500">
                  Scene {index + 1}
                  {index > 0 && " — opens on a hard cut"}
                  {scene.label && ` · ${scene.label}`}
                </label>
                <span className="flex items-center gap-2">
                  <span
                    className={`font-mono text-[10px] ${
                      scene.seconds > MAX_SCENE_SECONDS
                        ? "text-red-400"
                        : "text-zinc-600"
                    }`}
                  >
                    {scene.seconds}s
                  </span>
                  <span
                    className={`font-mono text-[10px] ${
                      scene.prompt.length > MAX_PROMPT_CHARS
                        ? "text-red-400"
                        : "text-zinc-600"
                    }`}
                  >
                    {scene.prompt.length}/{MAX_PROMPT_CHARS}
                  </span>
                </span>
              </div>
              <textarea
                value={scene.prompt}
                onChange={(e) =>
                  setScenes(
                    scenes.map((s, i) =>
                      i === index ? { ...s, prompt: e.target.value } : s,
                    ),
                  )
                }
                rows={4}
                placeholder={
                  index === 0
                    ? "Establish everything: style, place, subjects, light, and the sound…"
                    : "Hard cut to a new shot — re-describe the whole scene from the fresh angle…"
                }
                className="mt-0.5 w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 p-2 text-xs leading-5 outline-none focus:border-zinc-600"
              />
              <div className="mt-0.5 flex items-center gap-2">
                <label className="text-[10px] text-zinc-600">Seconds</label>
                <input
                  type="number"
                  min={1}
                  max={MAX_SCENE_SECONDS}
                  step={0.5}
                  value={scene.seconds}
                  onChange={(e) =>
                    setScenes(
                      scenes.map((s, i) =>
                        i === index
                          ? { ...s, seconds: Number(e.target.value) || 0 }
                          : s,
                      ),
                    )
                  }
                  className="w-16 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300 outline-none focus:border-zinc-600"
                />
                <span className="text-[10px] text-zinc-700">
                  cap {MAX_SCENE_SECONDS}s
                </span>
              </div>
              {issuesByScene.get(index + 1)?.map((msg) => (
                <p key={msg} className="mt-0.5 text-[10px] text-red-400">
                  {msg}
                </p>
              ))}
            </div>
          ))}
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => void queueEpisode()}
              disabled={
                !allScenesWritten ||
                busy !== null ||
                issues.length > 0 ||
                inferenceLive
              }
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-fg disabled:opacity-40"
            >
              {busy === "queueing"
                ? "Queueing…"
                : inferenceLive
                  ? "Inference running — one at a time"
                  : `Queue episode (${scenes.length} scene${scenes.length === 1 ? "" : "s"}, ${totalSeconds}s)`}
            </button>
            <button
              onClick={() => {
                setScenes([]);
                setTitle("");
              }}
              disabled={busy !== null}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-40"
            >
              Discard
            </button>
          </div>
          {issues.length > 0 && (
            <p className="mt-1.5 text-[11px] text-red-400">
              {issues.length} validation issue{issues.length === 1 ? "" : "s"} —
              fix them to enable queueing.
            </p>
          )}
          {snapshot && (
            <p className="mt-1.5 text-[11px] text-zinc-600">
              Queue: {snapshot.generation_queued}/{snapshot.generation_capacity}{" "}
              building · {snapshot.playout_queued}/{snapshot.playout_capacity}{" "}
              ready
            </p>
          )}
        </>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
