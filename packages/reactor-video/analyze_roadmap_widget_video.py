#!/usr/bin/env python3
"""Analyze the first 12 seconds of a UI-workflow screen recording (Vertex AI).

Purpose-built for ``example-ui-workflow-roadmap-widget.mov``: a liquidity-flow
roadmap widget where hovering a stage creates a detail card.

Method, mirroring ``analyze_deepagents_video.py`` but tuned for this component:

1. **Hard 12 s window.** The source recording runs ~19 s; 13-19 s is the
   presentation wrap-up and is out of scope. Both the clip and the extracted
   frames are bounded at ``--end`` (default 12.0), so the tail can never leak
   into the analysis.
2. **Frame-by-frame + motion.** ffmpeg produces a 12 s clip *and* a still every
   0.5 s (``--fps 2`` -> 24 frames); the model receives the clip plus every
   frame as separate image parts. This is what makes the hover interaction
   legible: the clip carries motion, the frames carry per-instant detail.
3. **Fast-model-first.** ``gemini-2.5-flash`` -> ``2.5-pro`` -> ``1.5-pro``; the
   cheap tier usually answers and is cheap for long-context video.
4. **Inline bytes.** The clip is a few MB, under Gemini's inline cap, so it is
   passed with ``types.Part.from_bytes`` (no GCS bucket needed).

Outputs (into ``--out-dir``, default ``vanguard_video/``):

* ``roadmap_widget_video_analysis.md`` - the 8-section flow/hover analysis.
* ``roadmap_widget_manifest.json``     - structured extraction (+ ``_raw.txt``).

Usage:
    python3 analyze_roadmap_widget_video.py --dry-run
    python3 analyze_roadmap_widget_video.py
    python3 analyze_roadmap_widget_video.py --fps 4 --end 12 --keep-frames
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
_PKG_SRC = _ROOT / "src"
if str(_PKG_SRC) not in sys.path:
    # Reuse the packaged engine helpers without requiring `pip install -e`.
    sys.path.insert(0, str(_PKG_SRC))

from reactor_video.engine import (  # noqa: E402
    generate_with_fallback,
    parse_json_block,
    salvage_json,
)

DEFAULT_VIDEO = _ROOT / "example-ui-workflow-roadmap-widget.mov"
DEFAULT_OUT_DIR = _ROOT / "vanguard_video"
OUT_MD = "roadmap_widget_video_analysis.md"
OUT_MANIFEST = "roadmap_widget_manifest.json"

MODELS_TO_TRY = ("gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-pro")

DEFAULT_START = 0.0
DEFAULT_END = 12.0
DEFAULT_FPS = 2.0
DEFAULT_FRAME_WIDTH = 1280
_SKIP_IF_EXISTS_MIN_BYTES = 1_000


FLOW_PROMPT = """You are an expert product-UI and on-chain liquidity-flow analyst. \
You are given (a) the FIRST 12 SECONDS ONLY of a screen recording of an investment \
"liquidity flow roadmap" widget, and (b) still frames sampled every 0.5 s over that \
same window. Analyze ONLY what is visible in these first 12 seconds; ignore anything \
that might follow.

Produce an in-depth video-to-specification analysis with exactly these sections:

1. EXECUTIVE SUMMARY & OVERVIEW - what the roadmap widget is showing, and the \
investment / liquidity arc it narrates from left to right.
2. SECOND-BY-SECOND TIMELINE (00:00 -> 00:12) - every visual beat: what appears, \
what animates, what is hovered, what changes. Use MM:SS timestamps.
3. LIQUIDITY-FLOW GRAPH - the ordered stages/nodes of the flow, the directed edges \
(source -> destination), amounts and units, which leg is inflow vs outflow, and what \
the horizontal axis represents (time? pipeline order? both?).
4. NODE ANATOMY - for every stage: its label, icon/marker, value, sub-label, and \
state (upcoming / active / complete / blocked).
5. HOVER INTERACTION - what triggers the popup, the delay before it appears, WHERE \
the new card is created (above/below/offset from the node), how it is dismissed, and \
whether it is interactive or read-only.
6. HOVER-CARD ANATOMY - every field shown in the created card, how fields are grouped, \
and whether it contains a sparkline, bar, table, or badge.
7. COLOR + VISUAL GRAMMAR - the palette actually used and what each color means; the \
base rail/track style; how completed vs projected segments are distinguished; and any \
motion or animation cues (pulses, travelling highlights, counters).
8. TRANSLATION NOTES - which of these patterns would survive a translation into a \
sharp-cornered, amber-accented dark trading terminal ("Terminal Noir"), and which \
must be re-expressed differently.

Be concrete and literal. If something is not visible in the first 12 seconds, say so \
rather than inventing it."""


MANIFEST_PROMPT = """You are producing a precise structured manifest from the FIRST 12 \
SECONDS ONLY of a screen recording of an investment liquidity-flow roadmap widget, plus \
its sampled still frames.

Return ONLY valid JSON with exactly this shape:

{
  "flow_stages": [
    {
      "id": "short-slug",
      "label": "stage label exactly as shown",
      "kind": "commit | route | pool | yield | settle | exit | other",
      "status": "upcoming | active | complete | blocked | unknown",
      "value": "the numeric/amount value shown, as a string",
      "unit": "USD | % | bps | token | empty",
      "venue": "venue or protocol shown, if any",
      "sub_label": "secondary text under the label, if any"
    }
  ],
  "edges": [
    { "from": "stage id", "to": "stage id", "amount": "value if shown", "meaning": "what flows" }
  ],
  "hover_cards": [
    {
      "stage_id": "stage id this card belongs to",
      "fields": [
        { "label": "field label shown", "value": "field value shown", "kind": "value | metric | chip" }
      ]
    }
  ],
  "ui_grammar": {
    "rail": "how the base track/rail is drawn",
    "node_styles": "how nodes/stages are drawn",
    "states": "how each stage state is distinguished",
    "animation": "how motion is used, if at all"
  },
  "color_system": [ { "hex_or_name": "color as seen", "meaning": "what it encodes" } ],
  "motion_cues": [ "ordered list of motion/animation cues" ],
  "data_fields": [ "fields this widget would bind to" ],
  "model": null,
  "source": null
}

Every field must be grounded in what is actually visible at some timestamp within the \
first 12 seconds. Do not extrapolate capabilities the video does not show. If the hover \
card is never opened on screen, return an empty "hover_cards" array. Set "model" and \
"source" to null; the caller fills them."""


def _require(binary: str) -> None:
    """Fail loudly when an external binary is missing."""
    if shutil.which(binary) is None:
        raise SystemExit(
            f"ERROR: '{binary}' not found on PATH. This analysis clips the source "
            "video and extracts frames client-side, so ffmpeg is required. "
            "Install it (macOS: `brew install ffmpeg`) and re-run."
        )


def probe_duration(video: Path) -> float:
    """Return the source duration in seconds via ffprobe."""
    out = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(video),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(out.stdout.strip())


def extract_clip(video: Path, dest: Path, start: float, end: float) -> Path:
    """Cut [start, end) into an H.264 MP4 suitable for inline upload."""
    print(f"  -> clipping {start:g}s-{end:g}s -> {dest.name}")
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", f"{start:g}", "-t", f"{end - start:g}", "-i", str(video),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
            "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart",
            str(dest),
        ],
        check=True,
    )
    return dest


def extract_frames(
    video: Path, frames_dir: Path, start: float, end: float, fps: float, width: int
) -> list[Path]:
    """Extract, downscale, and return one still every ``1/fps`` seconds."""
    frames_dir.mkdir(parents=True, exist_ok=True)
    print(f"  -> extracting frames at {fps:g} fps -> {frames_dir}")
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", f"{start:g}", "-t", f"{end - start:g}", "-i", str(video),
            "-vf", f"fps={fps:g},scale='min({width},iw)':-2",
            str(frames_dir / "frame_%04d.png"),
        ],
        check=True,
    )
    return sorted(frames_dir.glob("frame_*.png"))


def _summarize(label: str, path: Path) -> None:
    """Print a top-level-key digest for a JSON artifact."""
    data = json.loads(path.read_text())
    stages = data.get("flow_stages", [])
    cards = data.get("hover_cards", [])
    colors = data.get("color_system", [])
    print(f"\n{label}: {len(stages)} stages · {len(cards)} hover cards · "
          f"{len(colors)} colors")
    for stage in stages:
        print(f"  - {stage.get('id')}: {stage.get('label')} "
              f"[{stage.get('status')}] {stage.get('value')}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, default=DEFAULT_VIDEO,
                        help="Source recording (default: the packaged .mov).")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR,
                        help="Directory for the analysis artifacts.")
    parser.add_argument("--start", type=float, default=DEFAULT_START,
                        help="Clip start in seconds (default: 0).")
    parser.add_argument("--end", type=float, default=DEFAULT_END,
                        help="Clip end in seconds (default: 12).")
    parser.add_argument("--fps", type=float, default=DEFAULT_FPS,
                        help="Frame sampling rate (default: 2).")
    parser.add_argument("--frame-width", type=int, default=DEFAULT_FRAME_WIDTH,
                        help="Downscale frames to this max width (default: 1280).")
    parser.add_argument("--keep-frames", action="store_true",
                        help="Keep the extracted frames under <out-dir>/frames.")
    parser.add_argument("--project", default=None, help="GCP project id override.")
    parser.add_argument("--location", default=None, help="GCP location override.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print the plan + video metadata; make no GCP call.")
    args = parser.parse_args(argv)

    video = args.video.resolve()
    out_dir = args.out_dir.resolve()
    if not video.exists():
        raise SystemExit(f"ERROR: video not found: {video}")

    md_path = out_dir / OUT_MD
    manifest_path = out_dir / OUT_MANIFEST

    if args.dry_run:
        _require("ffprobe")
        duration = probe_duration(video)
        plan = {
            "video": str(video),
            "duration_s": duration,
            "window_s": [args.start, args.end],
            "models": list(MODELS_TO_TRY),
            "planned_outputs": [str(md_path), str(manifest_path)],
        }
        print(json.dumps(plan, indent=2))
        return 0

    _require("ffmpeg")
    _require("ffprobe")

    # Import lazily so --dry-run never needs the dependency or credentials.
    from google import genai
    from google.genai import types

    from reactor_video.engine import default_location, default_project_id

    project = args.project or default_project_id()
    location = args.location or default_location()
    out_dir.mkdir(parents=True, exist_ok=True)

    duration = probe_duration(video)
    end = min(args.end, duration)
    print(f"Source: {video} ({duration:.2f}s) | analyzing {args.start:g}s-{end:g}s")

    if args.keep_frames:
        frames_dir = out_dir / "frames"
        clip_path = out_dir / "_roadmap_clip.mp4"
        clip = extract_clip(video, clip_path, args.start, end)
        frames = extract_frames(video, frames_dir, args.start, end, args.fps, args.frame_width)
    else:
        tmp = tempfile.TemporaryDirectory(prefix="roadmap_widget_")
        clip = extract_clip(video, Path(tmp.name) / "clip.mp4", args.start, end)
        frames = extract_frames(
            video, Path(tmp.name) / "frames", args.start, end, args.fps, args.frame_width
        )
    print(f"  -> {len(frames)} frames ready")

    client = genai.Client(vertexai=True, project=project, location=location)
    print(f"Initialized Gemini client (project={project}, location={location})")

    clip_part = types.Part.from_bytes(data=clip.read_bytes(), mime_type="video/mp4")
    frame_parts = [
        types.Part.from_bytes(data=f.read_bytes(), mime_type="image/png") for f in frames
    ]
    video_note = f"{video.name} (first {end - args.start:g}s)"
    base = [clip_part, *frame_parts]

    # 1) Narrative analysis
    if md_path.exists() and md_path.stat().st_size > _SKIP_IF_EXISTS_MIN_BYTES:
        print(f"Skipping summarization (already present: {md_path})")
    else:
        print("Running flow/hover summarization ...")
        model_used, resp = generate_with_fallback(
            client, types, [*base, FLOW_PROMPT], MODELS_TO_TRY,
            types.GenerateContentConfig(temperature=0.2, max_output_tokens=8192),
        )
        md = (
            f"# Roadmap Widget UI Workflow - Video Analysis\n\n"
            f"_Model: {model_used} | Video: {video_note} | "
            f"Frames: {len(frames)} @ {args.fps:g} fps_\n\n---\n\n{resp.text}"
        )
        md_path.write_text(md)
        print(f"Saved summarization to {md_path}")

    # 2) Structured manifest
    print("Extracting structured flow manifest ...")
    model_used2, resp2 = generate_with_fallback(
        client, types, [*base, MANIFEST_PROMPT], MODELS_TO_TRY,
        types.GenerateContentConfig(
            temperature=0.0,
            max_output_tokens=32768,
            response_mime_type="application/json",
        ),
    )
    raw = resp2.text
    (out_dir / (Path(OUT_MANIFEST).stem + "_raw.txt")).write_text(raw)
    try:
        data = parse_json_block(raw)
    except Exception:
        print("WARNING: raw JSON parse failed; salvaging the un-truncated prefix...")
        data = salvage_json(raw)
    data["model"] = model_used2
    data["source"] = video_note
    manifest_path.write_text(json.dumps(data, indent=2))
    print(f"Saved flow manifest to {manifest_path}")

    _summarize("Digest", manifest_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
