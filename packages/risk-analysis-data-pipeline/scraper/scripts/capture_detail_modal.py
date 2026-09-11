"""Capture a market maker's "Details" modal as an offline fixture.

The leaderboard's per-maker detail lives behind a **modal**, not a URL: clicking
``Details`` on a row opens a card carrying four detailed KPI breakdowns (depth,
volume, spread, KPI adherence — each with value, percentile and rank), plus the
CEX and DEX venues the maker supports and its ancillary services. None of that is
reachable by fetching a link, so it must be captured by driving the DOM.

This script exists so the modal parser can be written and tested against real
markup rather than guesswork. It writes the modal's rendered text to
``tests/fixtures/``.

    uv run python scripts/capture_detail_modal.py                 # first row
    uv run python scripts/capture_detail_modal.py --row 3         # a specific row
    uv run python scripts/capture_detail_modal.py --page spread
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from risk_pipeline.browser import FetchSettings

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures"
BASE_URL = "https://defillama.com/market-makers"

#: The tab whose rows carry a Details button. Any of them exposes the same modal;
#: the depth tab is used because it lists every maker in one table.
DEFAULT_PAGE = "depth"

DETAIL_TIMEOUT_MS = 20_000


def main(argv: list[str] | None = None) -> int:
    """Capture one maker's detail modal.

    Args:
        argv: Argument vector; defaults to ``sys.argv[1:]``.

    Returns:
        Process exit code — 0 on success, 1 when the modal could not be captured.
    """
    parser = argparse.ArgumentParser(description="Capture a market-maker details modal.")
    parser.add_argument("--page", default=DEFAULT_PAGE, help="Tab: depth|volume|spread|kpi.")
    parser.add_argument("--row", type=int, default=1, help="1-based row index to open.")
    parser.add_argument("--stem", default=None, help="Fixture stem override.")
    args = parser.parse_args(argv)

    from camoufox.sync_api import Camoufox

    url = f"{BASE_URL}/{args.page}"
    stem = args.stem or f"mm_detail_{args.page}_row{args.row}"
    settings = FetchSettings(settle_ms=2500)

    try:
        with Camoufox(headless=settings.headless) as browser:
            page = browser.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=45_000)
            page.wait_for_timeout(4000)

            buttons = page.get_by_text("Details", exact=True)
            count = buttons.count()
            if count < args.row:
                print(f"only {count} Details buttons found; cannot open row {args.row}")
                return 1

            target = buttons.nth(args.row - 1)
            # The button sits in a table row; scroll it into view first so the
            # click lands on the intended control rather than a sticky overlay.
            target.scroll_into_view_if_needed(timeout=DETAIL_TIMEOUT_MS)
            page.wait_for_timeout(500)
            target.click(timeout=DETAIL_TIMEOUT_MS)

            # The modal renders progressively; give the four breakdown tables time
            # to populate before reading, otherwise the capture is a partial card.
            page.wait_for_timeout(5000)
            text = page.evaluate("() => document.body.innerText")

        FIXTURES.mkdir(parents=True, exist_ok=True)
        path = FIXTURES / f"{stem}.txt"
        path.write_text(text, encoding="utf-8")
        print(f"[ok] {stem}: {len(text):,} bytes -> {path.name}")
        return 0
    except Exception as exc:
        print(f"[FAIL] {stem}: {type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":  # pragma: no cover - CLI wiring
    raise SystemExit(main())
