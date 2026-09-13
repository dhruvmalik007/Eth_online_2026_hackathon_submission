"""Shared pytest fixtures for the offline suite.

Every test in this directory reads captured upstream payloads rather than the
network, so the suite is deterministic and runs anywhere.
"""

from __future__ import annotations

from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def fixtures_dir() -> Path:
    """Directory holding the captured upstream payloads.

    Returns:
        The absolute path to ``tests/fixtures``.
    """
    return FIXTURES


@pytest.fixture(scope="session")
def l2beat_base_html(fixtures_dir: Path) -> str:
    """The rendered text of the L2Beat Base Chain project page.

    Args:
        fixtures_dir: The fixtures directory.

    Returns:
        The captured page body.
    """
    return (fixtures_dir / "l2beat_base.txt").read_text(encoding="utf-8")


@pytest.fixture(scope="session")
def discourse_aave_json(fixtures_dir: Path) -> str:
    """Aave's Discourse ``latest.json`` payload.

    Args:
        fixtures_dir: The fixtures directory.

    Returns:
        The captured JSON body.
    """
    return (fixtures_dir / "discourse_aave.json").read_text(encoding="utf-8")


@pytest.fixture(scope="session")
def market_makers_html(fixtures_dir: Path) -> str:
    """The rendered text of the DefiLlama market-maker leaderboard.

    Args:
        fixtures_dir: The fixtures directory.

    Returns:
        The captured page body.
    """
    return (fixtures_dir / "defillama_market_makers.txt").read_text(encoding="utf-8")


@pytest.fixture(scope="session")
def defillama_hacks_json(fixtures_dir: Path) -> str:
    """The DeFiLlama security-incident feed, trimmed to the cases that matter.

    The live feed is 345 KB of 1,268 records, almost all concerning projects this
    pipeline does not track. This fixture keeps the records that exercise the
    parser: every incident attributable to a roster subject, plus the five
    look-alike names that must *not* be attributed, plus an incident whose amount
    is zero. Trimmed so the suite stays fast and the traps stay visible.

    Args:
        fixtures_dir: The fixtures directory.

    Returns:
        The captured JSON body.
    """
    return (fixtures_dir / "defillama_hacks.json").read_text(encoding="utf-8")
