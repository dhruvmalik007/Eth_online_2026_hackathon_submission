#!/usr/bin/env python3
"""Unified video analysis entry point for the Reactor pipeline.

One script, many personas. Replaces the earlier one-off scripts:
  - analyze_video.py            (Bloomberg Trading EMS)
  - analyze_vanguard_video.py   (Vanguard fixed income trading floor)

Usage:
  python3 analyze_videos.py --list-personas
  python3 analyze_videos.py bloomberg
  python3 analyze_videos.py vanguard
  python3 analyze_videos.py all
  python3 analyze_videos.py vanguard --gcs-uri gs://my-bucket/my.mp4 --out-dir out
"""

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
_PKG_SRC = _ROOT / "packages" / "reactor-video" / "src"
if str(_PKG_SRC) not in sys.path:
    sys.path.insert(0, str(_PKG_SRC))

from reactor_video.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
