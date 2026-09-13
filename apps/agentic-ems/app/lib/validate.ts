// Prompt validation — runs at authoring time (the composer shows the
// result per scene) and again immediately before queueing. A scene that
// fails here never reaches the wire.
//
// v1.2 additions on top of the v1.1 rules:
//   - speaker tags reduce to S1 (the human trader) + S5 (the Copilot);
//     the four-actor cast is gone
//   - copilot-grammar: any scene naming the dock must contain an agent
//     action (spawn/build/mount/write/tick/light/assemble/file/key)
//   - mount-discipline: scenes 2–5 each name a dashboard mounting — the
//     five sub-agent desks each mount exactly once

import { MAX_SCENE_SECONDS } from "./prompts";
import { ALLOWED_NUMBERS } from "./defillama";

export const MAX_PROMPT_CHARS = 800; // hard wire cap; enqueue refuses more
export const TARGET_PROMPT_CHARS = 700; // headroom guidance from the prompt guide

// Speaker tags registered for this episode: S1 = the trader, S2 = Marcus
// (head of derivatives, Label 7 post-mortem), S5 = the deep agent.
// S3/S4 are retired from the v1.1 cast.
const SPEAKER_TAGS = ["S1", "S2", "S5"] as const;
const FORBIDDEN_SPEAKER_TAGS = ["S3", "S4"] as const;

// Legacy exchange vendor names that must never appear in a prompt.
const FORBIDDEN_WORDS = [
  "bloomberg",
  "refinitiv",
  "tradx",
  "marketaxess",
  "trading technologies",
] as const;

// Agent actions that make the Copilot Dock legible (grammar from the
// DeepAgents recording: spawn → build → tick → mount → write).
const AGENT_ACTIONS = [
  "spawn",
  "spins",
  "build",
  "building",
  "mounted",
  "mounts",
  "mounting",
  "assembling",
  "assembles",
  "ticks",
  "ticked",
  "lights",
  "lighting",
  "lit",
  "flipping",
  "writes",
  "filed",
  "files",
  "keyed",
] as const;

// Scenes 2–5 are the mounting beats (1-based scene numbers). Scenes 2–4
// mount exactly one desk each; scene 5 is the sanctioned two-desk beat
// (prediction + governance) per the approved arc.
const MOUNTING_SCENES = new Set([2, 3, 4, 5]);
const TWO_DESK_SCENES = new Set([5]);

export interface SceneInput {
  label: string;
  prompt: string;
  seconds: number;
}

export interface ValidationIssue {
  scene: number; // 1-based
  rule: string;
  message: string;
}

function extractNumbers(text: string): string[] {
  // Strip registered speaker tags first — "S1 (Morgan, …)" would otherwise
  // surface the tag's digit as an on-screen number.
  let withoutTags = text.replace(/\bS[1-9]\b/g, " ");
  // Strip "DV01" — fixed-income metric vocabulary, not an on-screen number.
  withoutTags = withoutTags.replace(/\bDV0?1?\b/gi, " ");
  // Strip "4K" — a resolution format, not an on-screen number.
  withoutTags = withoutTags.replace(/\b4K\b/gi, " ");
  // Match integers and decimals, including comma-grouped thousands.
  return withoutTags.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
}

export function validateScene(scene: SceneInput, index: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const n = index + 1;
  const prompt = scene.prompt;

  if (prompt.length > MAX_PROMPT_CHARS) {
    issues.push({
      scene: n,
      rule: "length",
      message: `Prompt is ${prompt.length} chars; the wire cap is ${MAX_PROMPT_CHARS}.`,
    });
  }

  if (!Number.isFinite(scene.seconds) || scene.seconds <= 0) {
    issues.push({
      scene: n,
      rule: "seconds",
      message: `Seconds must be a positive number (got ${scene.seconds}).`,
    });
  } else if (scene.seconds % 10 !== 0) {
    issues.push({
      scene: n,
      rule: "timeline",
      message: `Seconds is ${scene.seconds}; every video must be a multiple of 10s (within the model's 5.167–14.375s window that means exactly 10s).`,
    });
  } else if (scene.seconds > MAX_SCENE_SECONDS) {
    issues.push({
      scene: n,
      rule: "seconds",
      message: `Seconds is ${scene.seconds}; the demo hard cap is ${MAX_SCENE_SECONDS}s.`,
    });
  }

  if (index > 0 && !/^Hard cut to /i.test(prompt.trim())) {
    issues.push({
      scene: n,
      rule: "hard-cut",
      message: 'Every scene after the first must open with "Hard cut to …".',
    });
  }

  // Positive-state rule: "no X" summons X. Describe the positive state.
  const negative = prompt.match(/\b(no|not|don't|dont|never|without)\b/i);
  if (negative) {
    issues.push({
      scene: n,
      rule: "positive-state",
      message: `Found "${negative[0]}" — describe the positive state instead of a ban.`,
    });
  }

  // Brand rule: no legacy vendor names.
  for (const word of FORBIDDEN_WORDS) {
    if (prompt.toLowerCase().includes(word)) {
      issues.push({
        scene: n,
        rule: "brand",
        message: `Prompt mentions "${word}" — Agentic branding only.`,
      });
    }
  }

  // Speaker-tag rule: every quoted line is attributed to a registered tag,
  // and the retired four-actor tags must not reappear.
  for (const retired of FORBIDDEN_SPEAKER_TAGS) {
    if (new RegExp(`\\b${retired}\\s*\\(`).test(prompt)) {
      issues.push({
        scene: n,
        rule: "cast",
        message: `${retired} is retired in v1.2 — the cast is S1 plus the Copilot (S5).`,
      });
    }
  }
  const quotes = prompt.match(/"[^"]+"/g) ?? [];
  for (const q of quotes) {
    const before = prompt.slice(0, prompt.indexOf(q));
    const attribution = before.match(/\b(S[1-9])\s*\(/g);
    const last = attribution?.at(-1)?.charAt(1);
    if (!last || !(SPEAKER_TAGS as readonly string[]).includes(`S${last}`)) {
      issues.push({
        scene: n,
        rule: "speaker-tag",
        message: `Quoted line ${q.slice(0, 40)}… has no registered speaker tag (S1 or S5).`,
      });
      break;
    }
  }

  // Copilot-grammar rule: naming the dock requires an agent action, so the
  // agentic surface never appears as passive set dressing.
  const namesDock = /\b(copilot|dock)\b/i.test(prompt);
  if (namesDock) {
    const hasAction = AGENT_ACTIONS.some((a) => new RegExp(`\\b${a}\\b`, "i").test(prompt));
    if (!hasAction) {
      issues.push({
        scene: n,
        rule: "copilot-grammar",
        message:
          "Scene names the Copilot Dock without an agent action (spawn/build/mount/tick/write/file).",
      });
    }
  }

  // Mount discipline: each mounting beat names its sanctioned desks —
  // exactly one for scenes 2–4, exactly the two-desk beat for scene 5.
  if (MOUNTING_SCENES.has(n)) {
    const mounts = prompt.match(/\b(lending|risk|perps|prediction|governance)\s+desk\b/gi) ?? [];
    const unique = new Set(mounts.map((m) => m.toLowerCase()));
    const expected = TWO_DESK_SCENES.has(n) ? 2 : 1;
    if (unique.size !== expected) {
      issues.push({
        scene: n,
        rule: "mount-discipline",
        message: `Mounting scene ${n} should name exactly ${expected} desk${expected === 1 ? "" : "s"} mounting (found ${unique.size || "none"}).`,
      });
    }
  }

  // Number rule: every numeral is from the scrape, the dashboard, an
  // illustrative anchor group, or the FICT anchor.
  for (const raw of extractNumbers(prompt)) {
    const num = raw.replace(/,/g, "");
    const allowed = [...ALLOWED_NUMBERS].some(
      (a) => a.replace(/,/g, "") === num,
    );
    if (!allowed) {
      issues.push({
        scene: n,
        rule: "number",
        message: `"${raw}" is not in the DeFiLlama scrape, the dashboard, an illustrative anchor group, or the FICT anchor.`,
      });
      break; // one number issue per scene is enough to act on
    }
  }

  return issues;
}

export function validateEpisode(scenes: SceneInput[]): ValidationIssue[] {
  return scenes.flatMap((scene, i) => validateScene(scene, i));
}
