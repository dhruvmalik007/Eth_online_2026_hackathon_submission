"""Capture real upstream payloads as offline test fixtures.

The offline suite must assert against what the sites *actually* return, not
against structures invented to make the tests pass. This script fetches each
target through the real Camoufox transport and writes the payload to
``tests/fixtures/``, where the parser tests read it.

Re-run it when an upstream changes shape, and the diff on the fixture tells you
exactly what moved.

    uv run python scripts/capture_fixtures.py
    uv run python scripts/capture_fixtures.py --only l2beat,discourse
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from risk_pipeline.browser import CamoufoxFetcher, FetchSettings
from risk_pipeline.errors import RiskPipelineError
from risk_pipeline.probe import (
    L2BEAT_TARGETS,
    MARKET_MAKER_URL,
)
from risk_pipeline.registry import load_roster

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures"

#: Fixed captures, keyed by fixture stem.
STATIC_TARGETS: dict[str, str] = {
    "l2beat_risk_index": L2BEAT_TARGETS["risk-index"],
    "l2beat_base": L2BEAT_TARGETS["sample-chain"],
    "defillama_market_makers": MARKET_MAKER_URL,
}

#: The market-maker detail tabs. Each is a distinct route carrying a different
#: per-maker metric family — depth, volume, spread, KPI adherence — which the
#: summary leaderboard does not publish. Captured individually because they are
#: separate pages, not fragments of one.
MARKET_MAKER_TABS: dict[str, str] = {
    "defillama_mm_depth": f"{MARKET_MAKER_URL}/depth",
    "defillama_mm_volume": f"{MARKET_MAKER_URL}/volume",
    "defillama_mm_spread": f"{MARKET_MAKER_URL}/spread",
    "defillama_mm_kpi": f"{MARKET_MAKER_URL}/kpi",
    "defillama_mm_documentation": f"{MARKET_MAKER_URL}/documentation",
}


def main(argv: list[str] | None = None) -> int:
    """Capture fixtures for every reachable target.

    Args:
        argv: Argument vector; defaults to ``sys.argv[1:]``.

    Returns:
        Process exit code — 0 on success, 1 when a required capture failed.
    """
    parser = argparse.ArgumentParser(description="Capture real payloads as fixtures.")
    parser.add_argument("--only", default=None, help="Comma-separated subset.")
    args = parser.parse_args(argv)
    only = {p.strip() for p in args.only.split(",")} if args.only else None

    FIXTURES.mkdir(parents=True, exist_ok=True)
    failures = 0
    settings = FetchSettings(settle_ms=2500, max_attempts=2)

    with CamoufoxFetcher(settings) as fetcher:
        for stem, url in {**STATIC_TARGETS, **MARKET_MAKER_TABS}.items():
            if only is not None and stem not in only and stem.split("_")[0] not in only:
                continue
            try:
                result = fetcher.fetch(url, source_id=stem)
                path = FIXTURES / f"{stem}.txt"
                path.write_text(result.text, encoding="utf-8")
                print(f"[ok]   {stem:<32} {len(result.text):>8,} bytes -> {path.name}")
            except RiskPipelineError as exc:
                failures += 1
                print(f"[FAIL] {stem:<32} {exc}")

        # Capture one verified Discourse forum per protocol category, so the
        # parser tests cover the shapes actually seen rather than one sample.
        captured_categories: set[str] = set()
        for target in load_roster().scrapable_protocols():
            if target.transport != "discourse-json":
                continue
            if only is not None and target.slug not in only and "discourse" not in only:
                continue
            # One per category is enough to cover the payload shape.
            if target.category in captured_categories:
                continue
            try:
                result = fetcher.fetch(
                    f"{target.forum_url.rstrip('/')}/latest.json", source_id=target.slug
                )
                path = FIXTURES / f"discourse_{target.slug}.json"
                path.write_text(result.text, encoding="utf-8")
                captured_categories.add(target.category)
                print(
                    f"[ok]   discourse/{target.slug:<16} "
                    f"{len(result.text):>8,} bytes -> {path.name}"
                )
            except RiskPipelineError as exc:
                failures += 1
                print(f"[FAIL] discourse/{target.slug:<16} {exc}")

    print(f"\nfixtures written to {FIXTURES} ({failures} failure(s))")
    return 1 if failures else 0


if __name__ == "__main__":  # pragma: no cover - CLI wiring
    raise SystemExit(main())
