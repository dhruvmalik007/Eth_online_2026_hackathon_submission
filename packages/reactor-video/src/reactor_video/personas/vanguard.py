"""Vanguard persona: fixed income trading floor video with POV frame manifests.

Key requirement carried over from analyze_vanguard_video.py: the POV
timestamping must come from the CURRENT frame at each beat, NOT from
interpretation of "the view of the past". Each entry anchors on what is
actually visible at that instant.
"""

from __future__ import annotations

from reactor_video.spec import Persona, Task, TaskKind

GCS_URI = "gs://meghdoot-artifacts/video_analysis/vanguard_fixed_income_trading_floor.mp4"

SUMMARIZATION_PROMPT = """You are an expert financial technology analyst and quantitative trading systems architect. Analyze the attached video, which is a Vanguard/Vanguard-style social media video about the fixed income trading floor. Perform an in-depth video-to-summarization analysis.

Structure your output clearly into the following detailed sections:

1. EXECUTIVE SUMMARY & OVERVIEW
   - Primary objective and context of the video (marketing, educational, documentary).
   - High-level overview of the fixed income trading floor workflow shown.

2. STEP-BY-STEP TIMELINE & ACTION BREAKDOWN
   - Chronological breakdown of events/actions with APPROXIMATE timestamps (MM:SS).
   - Key user interactions, camera/angle changes, and trader activities.

3. KEY TRADING DESK FEATURES & WORKFLOWS DEMONSTRATED
   - Trader profiles / roles shown (e.g. sales trader, execution trader, portfolio manager, risk).
   - Order management, inventory, pricing, and execution workflows visible.

4. USER INTERFACE & DATA COMPONENT ANALYSIS (TRADER WORKBENCHES / POVs)
   - For EVERY distinct trader workbench / point-of-view (POV) shown: which trader profile it belongs to, the exact timestamp when that POV is first visible, the on-screen components (order ticket, blotter, market data grid, chart), and its visual styling (dark/light theme, color accents).
   - Note the different ANGLE / camera framing used for each POV (e.g. over-the-shoulder, side, eye-level, close-up on screen).

5. TECHNICAL & STRATEGIC OBSERVATIONS
   - Assessment of the desk layout efficiency and how different trader roles use their screens.
   - Key takeaways about fixed income trading workflows as presented in the video.
"""

POV_FRAMES_PROMPT = """You are producing a precise frame-extraction manifest from the attached video of a fixed income trading floor.

CRITICAL RULE: Every timestamp you output MUST describe what is visible in the CURRENT FRAME at that exact moment. Do NOT extrapolate from earlier shots, do NOT describe 'the view of the past' (something that was shown seconds earlier but is no longer on screen). Anchor strictly to what a viewer sees at that instant.

For each DISTINCT trader point-of-view (POV) / workbench / screen shown in the video, look at the exact frame where that POV is most clearly visible and emit one entry with:
- "id": stable short slug
- "trader_profile": which trader role this belongs to (e.g. sales trader, execution trader, portfolio/risk manager, market maker)
- "timestamp": exact SS.mmm (seconds.milliseconds into the video) of the clearest frame
- "angle": camera framing (over-the-shoulder, side profile, eye-level, screen close-up, wide desk shot)
- "screen_components": what is on that trader's screens at that instant (order ticket fields, blotter, market grid, chart, etc.)
- "crop_hint": a bounding box in normalized xywh [x, y, w, h] fractions of the frame that isolates the trader's workbench/screen region of interest
- "visual_style": theme + accent colors

Cover the entire video start-to-finish. Also output a top-level "timeline" array capturing every notable shot change/trader action with current-frame timestamps and a one-line description, from 00:00 to the end. Return ONLY valid JSON."""


def normalize_manifest(data, gcs_uri: str, model: str) -> dict:
    """Normalize the model's JSON into {pov_frames, timeline} with provenance.

    The model may return a dict {pov_frames: [...], timeline: [...]} or a bare
    list containing an embedded {"timeline": [...]} object plus POV entries.
    """
    pov_frames: list = []
    timeline: list = []
    if isinstance(data, dict):
        pov_frames = data.get("pov_frames") or []
        timeline = data.get("timeline") or []
    elif isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and "timeline" in item:
                timeline = item["timeline"]
                pov_frames.extend(item.get("pov_frames") or [])
            elif isinstance(item, dict) and "trader_profile" in item:
                pov_frames.append(item)
        if not pov_frames and not timeline:
            pov_frames = [e for e in data if isinstance(e, dict)]
    return {
        "pov_frames": pov_frames,
        "timeline": timeline,
        "model": model,
        "gcs_uri": gcs_uri,
        "video_duration_s": None,
    }


PERSONA = Persona(
    key="vanguard",
    title="Vanguard Fixed Income Trading Floor",
    description=(
        "Vanguard-style social media video of the fixed income trading "
        "floor. Produces a full summarization plus a current-frame-anchored "
        "POV frame-extraction manifest (JSON)."
    ),
    gcs_uri=GCS_URI,
    mime_type="video/mp4",
    models=(
        "gemini-3-pro",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-1.5-pro",
        "gemini-1.5-flash",
    ),
    tasks=(
        Task(
            name="Video Summarization Analysis",
            prompt=SUMMARIZATION_PROMPT,
            output_filename="vanguard_video_analysis.md",
            kind=TaskKind.MARKDOWN,
            temperature=0.2,
            max_output_tokens=8192,
            skip_if_exists=True,
        ),
        Task(
            name="Current-Frame POV Frames Manifest",
            prompt=POV_FRAMES_PROMPT,
            output_filename="vanguard_pov_frames_manifest.json",
            kind=TaskKind.JSON,
            temperature=0.0,
            max_output_tokens=32768,
            response_mime_type="application/json",
            save_raw=True,
        ),
    ),
    normalize_manifest=normalize_manifest,
)
