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
