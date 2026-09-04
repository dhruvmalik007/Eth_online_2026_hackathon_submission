"""Command-line interface for reactor-video.

The same parser backs the ``reactor-analyze`` console script and the
repo-root ``analyze_videos.py`` entry point. Metadata-only modes
(``--list-personas``, ``--dry-run``) never import the Gemini SDK, so they
work on machines without GCP set up.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from reactor_video.engine import run_persona
from reactor_video.personas import available_personas, get_persona


def build_parser() -> argparse.ArgumentParser:
    """Build the shared argument parser."""
    parser = argparse.ArgumentParser(
        prog="analyze_videos",
        description=(
            "Persona-driven video analysis (Gemini/Vertex). One entry point "
            "for every reference video of the Reactor pipeline."
        ),
    )
    parser.add_argument(
        "persona",
        nargs="?",
        help=f"persona key or 'all' (available: {', '.join(available_personas())})",
    )
    parser.add_argument(
        "--list-personas", action="store_true", help="list personas and exit"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print each task and planned artifact path without calling GCP",
    )
    parser.add_argument(
        "--gcs-uri", help="override the persona's default video URI (gs://...)"
    )
    parser.add_argument(
        "--out-dir", help="base output directory (default: analysis/<persona>/)"
    )
    parser.add_argument("--project", help="GCP project id (env: REACTOR_GCP_PROJECT)")
    parser.add_argument("--location", help="GCP location (env: REACTOR_GCP_LOCATION)")
    return parser


def _describe(persona_key: str, out_dir: Path) -> None:
    """Print a persona's task list and planned artifacts (dry-run mode)."""
    persona = get_persona(persona_key)
    print(f"[{persona.key}] {persona.title} — {persona.description}")
    for task in persona.tasks:
        print(f"  task: {task.name} ({task.kind.value}, temp={task.temperature})")
    for path in persona.planned_outputs(out_dir):
        print(f"  artifact: {path}")


def main(argv: list[str] | None = None) -> int:
    """Run the CLI; returns the process exit code."""
    args = build_parser().parse_args(argv)

    if args.list_personas:
        print(f"{'KEY':<12}{'TITLE':<40}TASKS  DEFAULT VIDEO")
        for key in available_personas():
            persona = get_persona(key)
            print(
                f"{persona.key:<12}{persona.title:<40}"
                f"{len(persona.tasks):<6}{persona.gcs_uri}"
            )
        return 0

    if not args.persona:
        build_parser().error("persona is required (or use --list-personas)")

    keys = available_personas() if args.persona.lower() == "all" else [args.persona]

    if args.dry_run:
        for key in keys:
            _describe(key, Path(args.out_dir or "analysis") / get_persona(key).key)
        return 0

    failures = 0
    for key in keys:
        persona = get_persona(key)
        out_dir = Path(args.out_dir or "analysis") / persona.key
        try:
            run_persona(
                persona,
                out_dir=out_dir,
                gcs_uri=args.gcs_uri,
                project_id=args.project,
                location=args.location,
            )
        except Exception as exc:  # noqa: BLE001 - one persona failing must not stop 'all'
            failures += 1
            print(f"[{persona.key}] FAILED: {exc}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
