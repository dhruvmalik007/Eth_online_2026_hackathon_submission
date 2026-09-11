"""Emit canonical snapshots for the cross-language contract drift test.

The Python worker and the TypeScript read path each define the snapshot contract.
Nothing stops those two definitions from diverging — a field renamed on one side
and not the other would only surface when a consumer went looking for a number
that never arrived.

This script closes that gap: it parses the captured upstream fixtures with the
real parsers and writes the resulting JSON to ``test/fixtures/contract/``, where
the TypeScript suite validates every document against its zod schemas. A rename
on either side therefore fails the build.

    uv run python scripts/emit_contract_fixtures.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from risk_pipeline.detail import parse_market_maker_detail
from risk_pipeline.registry import ChainTarget, load_roster
from risk_pipeline.sources.defillama_mm import (
    parse_market_maker_page,
)
from risk_pipeline.sources.discourse import parse_discourse_payload
from risk_pipeline.sources.l2beat import parse_chain_page

SCRAPER_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_ROOT = SCRAPER_ROOT.parent
SOURCE_FIXTURES = SCRAPER_ROOT / "tests" / "fixtures"
OUTPUT = PACKAGE_ROOT / "test" / "fixtures" / "contract"

FETCHED_AT = "2026-09-11T00:00:00Z"


def main() -> int:
    """Emit one canonical document per contract shape.

    Returns:
        Process exit code — 0 on success, 1 when an input fixture is missing.
    """
    OUTPUT.mkdir(parents=True, exist_ok=True)
    roster = load_roster()
    written: list[str] = []

    # Chain risk profile
    chain_fixture = SOURCE_FIXTURES / "l2beat_base.txt"
    if chain_fixture.exists():
        chain = parse_chain_page(
            chain_fixture.read_text(encoding="utf-8"),
            ChainTarget(slug="base", name="Base Chain", l2beat_path="base"),
            source_url="https://l2beat.com/layer2s/projects/base",
            fetched_at=FETCHED_AT,
        )
        written.append(_write("chain-risk-profile.json", chain.model_dump_json(by_alias=True)))

    # Protocol governance profile
    discourse_fixture = SOURCE_FIXTURES / "discourse_aave.json"
    aave = roster.protocol("aave")
    if discourse_fixture.exists() and aave is not None:
        governance = parse_discourse_payload(
            discourse_fixture.read_text(encoding="utf-8"),
            aave,
            source_url="https://governance.aave.com/latest.json",
            fetched_at=FETCHED_AT,
        )
        written.append(
            _write("protocol-governance-profile.json", governance.model_dump_json(by_alias=True))
        )

    # Market-maker profile and summary
    mm_fixture = SOURCE_FIXTURES / "defillama_market_makers.txt"
    if mm_fixture.exists():
        profiles, summary_kwargs = parse_market_maker_page(
            mm_fixture.read_text(encoding="utf-8"),
            source_url="https://defillama.com/market-makers",
            fetched_at=FETCHED_AT,
        )
        if profiles:
            written.append(
                _write("market-maker-profile.json", profiles[0].model_dump_json(by_alias=True))
            )
        from risk_pipeline.models import MarketMakerSummary

        summary = MarketMakerSummary(**summary_kwargs)
        written.append(_write("market-maker-summary.json", summary.model_dump_json(by_alias=True)))

    # Market-maker detail card
    detail_fixture = SOURCE_FIXTURES / "mm_detail_sample.txt"
    if detail_fixture.exists():
        detail = parse_market_maker_detail(
            detail_fixture.read_text(encoding="utf-8"),
            slug="auros-global",
            name="Auros Global",
            source_url="https://defillama.com/market-makers/depth",
            fetched_at=FETCHED_AT,
        )
        written.append(_write("market-maker-detail.json", detail.model_dump_json(by_alias=True)))

    # Manifest — assembled by hand here because it is a run artifact rather than
    # a parse result, but the shape is the contract the TypeScript side reads.
    manifest = {
        "schemaVersion": "0.1.0",
        "generatedAt": FETCHED_AT,
        "cadenceHours": 6,
        "sources": {
            "l2beat": {
                "state": "fresh",
                "fetchedAt": FETCHED_AT,
                "latencyMs": 1234.5,
                "records": 12,
                "contentHash": "abc123",
                "error": None,
            },
            "discourse": {
                "state": "failed",
                "fetchedAt": None,
                "latencyMs": 45.0,
                "records": 0,
                "contentHash": None,
                "error": "[curve] HTTP 403",
            },
        },
        "temporal": {
            "chainRiskHistory": 12,
            "protocolGovernanceHistory": 8,
            "marketMakerMetrics": 22,
            "embeddings": 42,
        },
        "notes": ["curve is blocked by Cloudflare; excluded from v0.1"],
    }
    written.append(_write("manifest.json", json.dumps(manifest, indent=2)))

    for name in written:
        print(f"[ok] {name}")
    print(f"\nwrote {len(written)} contract fixture(s) to {OUTPUT}")
    return 0 if len(written) >= 5 else 1


def _write(name: str, body: str) -> str:
    """Write one contract fixture.

    Args:
        name: The file name.
        body: The serialized document.

    Returns:
        The file name, for reporting.
    """
    (OUTPUT / name).write_text(body + "\n", encoding="utf-8")
    return name


if __name__ == "__main__":  # pragma: no cover - CLI wiring
    raise SystemExit(main())
