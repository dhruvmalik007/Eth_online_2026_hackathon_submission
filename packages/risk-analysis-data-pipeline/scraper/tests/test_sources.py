"""Parser tests against captured upstream payloads.

These assert on shapes observed in the real responses, so they fail when an
upstream changes rather than when an assumption changes. The success bar is that
every field the contract requires is populated from genuine content — a parser
that returns an empty-but-valid record is a failure, not a pass.
"""

from __future__ import annotations

import json

import pytest

from risk_pipeline.errors import ParseError
from risk_pipeline.registry import ChainTarget, ProtocolTarget, load_roster
from risk_pipeline.sources.defillama_mm import parse_market_maker_page
from risk_pipeline.sources.discourse import parse_discourse_payload, slugify
from risk_pipeline.sources.l2beat import parse_chain_page

FETCHED_AT = "2026-09-11T00:00:00Z"


class TestL2BeatParser:
    """The L2Beat chain-risk page parser."""

    def test_parses_the_real_base_page(self, l2beat_base_html: str) -> None:
        target = ChainTarget(slug="base", name="Base Chain", l2beat_path="base")
        profile = parse_chain_page(
            l2beat_base_html,
            target,
            source_url="https://l2beat.com/layer2s/projects/base",
            fetched_at=FETCHED_AT,
        )

        assert profile.slug == "base"
        assert profile.name == "Base Chain"
        assert profile.stage.value == "stage-1"
        # $14.57 B, read from the page's Total Value Secured block.
        assert profile.value_secured_usd == pytest.approx(14_570_000_000.0)

    def test_classifies_every_dimension_and_retains_raw_text(self, l2beat_base_html: str) -> None:
        target = ChainTarget(slug="base", name="Base Chain", l2beat_path="base")
        profile = parse_chain_page(
            l2beat_base_html,
            target,
            source_url="https://l2beat.com/layer2s/projects/base",
            fetched_at=FETCHED_AT,
        )
        dims = profile.dimensions

        assert dims.state_validation.raw == "Fraud proofs (1R, ZK)"
        assert dims.state_validation.category == "fraud-proofs"
        assert dims.data_availability.raw == "Onchain"
        assert dims.data_availability.category == "onchain"
        assert dims.exit_window.raw == "None"
        assert dims.exit_window.category == "none"
        assert dims.sequencer_failure.raw == "Self sequence"
        assert dims.sequencer_failure.category == "self-sequence"
        assert dims.proposer_failure.raw == "Self propose"
        assert dims.proposer_failure.category == "self-propose"

    def test_scores_match_the_hand_computed_composite(self, l2beat_base_html: str) -> None:
        target = ChainTarget(slug="base", name="Base Chain", l2beat_path="base")
        profile = parse_chain_page(
            l2beat_base_html,
            target,
            source_url="https://l2beat.com/layer2s/projects/base",
            fetched_at=FETCHED_AT,
        )
        # 0.30(0.70)+0.25(1.00)+0.20(0.10)+0.15(0.80)+0.10(1.00) = 0.700
        assert profile.risk_scores.composite == pytest.approx(0.70)

    def test_raises_when_the_risk_section_is_absent(self) -> None:
        target = ChainTarget(slug="base", name="Base Chain", l2beat_path="base")
        with pytest.raises(ParseError, match="Risk analysis"):
            parse_chain_page(
                "a page with no risk section at all",
                target,
                source_url="https://example.test",
                fetched_at=FETCHED_AT,
            )

    def test_raises_when_a_dimension_heading_is_missing(self, l2beat_base_html: str) -> None:
        # Simulate an upstream change that drops one heading. The parser must fail
        # loudly rather than emit a profile with a silently defaulted dimension.
        damaged = l2beat_base_html.replace("PROPOSER FAILURE", "PROPOSER GONE")
        target = ChainTarget(slug="base", name="Base Chain", l2beat_path="base")
        with pytest.raises(ParseError, match="PROPOSER FAILURE"):
            parse_chain_page(
                damaged,
                target,
                source_url="https://example.test",
                fetched_at=FETCHED_AT,
            )


class TestDiscourseParser:
    """The Discourse governance-forum parser."""

    def _aave(self) -> ProtocolTarget:
        target = load_roster().protocol("aave")
        assert target is not None
        return target

    def test_parses_the_real_aave_payload(self, discourse_aave_json: str) -> None:
        profile = parse_discourse_payload(
            discourse_aave_json,
            self._aave(),
            source_url="https://governance.aave.com/latest.json",
            fetched_at=FETCHED_AT,
        )
        assert profile.slug == "aave"
        assert profile.category == "lending"
        assert len(profile.proposals) == 30
        assert profile.governance.reachable is True
        assert profile.governance.json_api == "https://governance.aave.com/latest.json"

    def test_classifies_stages_from_real_titles(self, discourse_aave_json: str) -> None:
        profile = parse_discourse_payload(
            discourse_aave_json,
            self._aave(),
            source_url="https://governance.aave.com/latest.json",
            fetched_at=FETCHED_AT,
        )
        stages = {p.stage.value for p in profile.proposals}
        # The live payload carries ARFC, AIP and TEMP CHECK topics, so a parser
        # returning only "other" has failed even though it produced records.
        assert "arfc" in stages
        assert "aip" in stages

    def test_builds_canonical_topic_urls(self, discourse_aave_json: str) -> None:
        profile = parse_discourse_payload(
            discourse_aave_json,
            self._aave(),
            source_url="https://governance.aave.com/latest.json",
            fetched_at=FETCHED_AT,
        )
        sample = profile.proposals[0]
        assert sample.url == f"https://governance.aave.com/t/{sample.slug}/{sample.id}"

    def test_raises_on_a_non_json_body(self) -> None:
        with pytest.raises(ParseError, match="not valid JSON"):
            parse_discourse_payload(
                "<html>a page, not an API</html>",
                self._aave(),
                source_url="https://example.test",
                fetched_at=FETCHED_AT,
            )

    def test_raises_when_topic_list_is_absent(self) -> None:
        with pytest.raises(ParseError, match="topic_list"):
            parse_discourse_payload(
                json.dumps({"unexpected": "shape"}),
                self._aave(),
                source_url="https://example.test",
                fetched_at=FETCHED_AT,
            )

    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("Auros Global", "auros-global"),
            ("G-20 Group", "g-20-group"),
            ("JPEG Trading", "jpeg-trading"),
            ("Flowdesk", "flowdesk"),
        ],
    )
    def test_slugify(self, name: str, expected: str) -> None:
        assert slugify(name) == expected


class TestMarketMakerParser:
    """The DefiLlama market-maker leaderboard parser."""

    def test_parses_the_real_leaderboard(self, market_makers_html: str) -> None:
        profiles, summary = parse_market_maker_page(
            market_makers_html,
            source_url="https://defillama.com/market-makers",
            fetched_at=FETCHED_AT,
        )
        assert len(profiles) > 15
        assert summary["maker_count"] == len(profiles)
        # Ranked and in order, starting at 1.
        assert [p.rank for p in profiles] == list(range(1, len(profiles) + 1))

    def test_reads_the_top_row_exactly(self, market_makers_html: str) -> None:
        profiles, _ = parse_market_maker_page(
            market_makers_html,
            source_url="https://defillama.com/market-makers",
            fetched_at=FETCHED_AT,
        )
        top = profiles[0]
        assert top.rank == 1
        assert top.name == "Flowdesk"
        assert top.grade.value == "AA"
        assert top.composite_score == pytest.approx(9.4)
        assert top.sub_scores.trading_kpis == pytest.approx(10.0)
        assert top.sub_scores.uptime == pytest.approx(9.3)

    def test_integration_level_is_none_not_zero(self, market_makers_html: str) -> None:
        # The column renders empty. `None` records "not published"; `0.0` would
        # assert the maker scored zero, which the source never said.
        profiles, _ = parse_market_maker_page(
            market_makers_html,
            source_url="https://defillama.com/market-makers",
            fetched_at=FETCHED_AT,
        )
        assert all(p.sub_scores.integration_level is None for p in profiles)

    def test_hero_metrics_are_present_only_for_highlighted_makers(
        self, market_makers_html: str
    ) -> None:
        profiles, _ = parse_market_maker_page(
            market_makers_html,
            source_url="https://defillama.com/market-makers",
            fetched_at=FETCHED_AT,
        )
        with_metrics = [p for p in profiles if p.metrics is not None]
        # The page highlights a handful of makers; most rows carry no depth,
        # spread or volume, and the schema models that rather than inventing it.
        assert 0 < len(with_metrics) < len(profiles)
        top = profiles[0]
        assert top.metrics is not None
        assert top.metrics.volume_usd == pytest.approx(1_780_000.0)
        assert top.active_engagements == 11

    def test_parses_the_summary_leaders(self, market_makers_html: str) -> None:
        _, summary = parse_market_maker_page(
            market_makers_html,
            source_url="https://defillama.com/market-makers",
            fetched_at=FETCHED_AT,
        )
        assert summary["top_volume"] is not None
        assert summary["top_volume"].name == "Flowdesk"
        # Each leader is optional, so it must be narrowed before its fields are
        # read — the same discipline the consumers apply.
        assert summary["top_spread"] is not None
        assert summary["top_spread"].name == "GSR"

    def test_raises_when_the_table_is_gone(self) -> None:
        with pytest.raises(ParseError, match="table structure"):
            parse_market_maker_page(
                "a page with no leaderboard rows",
                source_url="https://defillama.com/market-makers",
                fetched_at=FETCHED_AT,
            )
