"""Tests for the market-maker "Details" modal parser.

Assertions run against a captured modal, so they pin the structure that was
actually observed: four KPI breakdown tables, the header scores and standings,
and the CEX/DEX venue lists.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from risk_pipeline.detail import parse_market_maker_detail, parse_metric_value
from risk_pipeline.errors import ParseError
from risk_pipeline.models import MarketMakerDetail

FIXTURES = Path(__file__).parent / "fixtures"
FETCHED_AT = "2026-09-11T00:00:00Z"


@pytest.fixture(scope="module")
def detail_text() -> str:
    """A captured Details modal for a market maker.

    Returns:
        The modal's rendered text.
    """
    return (FIXTURES / "mm_detail_sample.txt").read_text(encoding="utf-8")


def _parse(text: str) -> MarketMakerDetail:
    """Parse a modal with the fixture's identity.

    Args:
        text: The modal text.

    Returns:
        The parsed detail card.
    """
    return parse_market_maker_detail(
        text,
        slug="auros-global",
        name="Auros Global",
        source_url="https://defillama.com/market-makers/depth",
        fetched_at=FETCHED_AT,
    )


class TestMetricValueParsing:
    """Value coercion across the modal's mixed units."""

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("$553.88K", 553_880.0),
            ("$1.01M", 1_010_000.0),
            ("87.46%", 87.46),
            ("11", 11.0),
        ],
    )
    def test_parses_each_unit(self, raw: str, expected: float) -> None:
        assert parse_metric_value(raw) == pytest.approx(expected)

    @pytest.mark.parametrize("raw", ["N/A", "", "—"])
    def test_non_numeric_values_are_none(self, raw: str) -> None:
        # `None` is the honest answer for "N/A"; zero would assert a measurement
        # the source never made.
        assert parse_metric_value(raw) is None


class TestDetailParsing:
    """The modal's four breakdown tables."""

    def test_parses_every_breakdown_family(self, detail_text: str) -> None:
        detail = _parse(detail_text)
        assert len(detail.breakdowns.depth) > 0
        assert len(detail.breakdowns.volume) > 0
        assert len(detail.breakdowns.spread) > 0
        assert len(detail.breakdowns.kpi_adherence) > 0

    def test_reads_the_200bps_depth_band(self, detail_text: str) -> None:
        detail = _parse(detail_text)
        rows = {r.metric: r for r in detail.breakdowns.depth}
        bid = rows["Bid Depth 200 bps (USD)"]
        assert bid.value_raw == "$554.88K"
        assert bid.value_numeric == pytest.approx(554_880.0)
        assert bid.percentile == 100.0
        assert bid.rank == 1

    def test_depth_covers_all_three_bands(self, detail_text: str) -> None:
        detail = _parse(detail_text)
        labels = " ".join(r.metric for r in detail.breakdowns.depth)
        # The modal breaks depth out at 50, 100 and 200 bps. A parser that found
        # only one band would still "pass" a count assertion, so the bands are
        # asserted explicitly.
        assert "50 bps" in labels
        assert "100 bps" in labels
        assert "200 bps" in labels

    def test_preserves_na_rows_with_a_null_numeric(self, detail_text: str) -> None:
        detail = _parse(detail_text)
        na_rows = [r for r in detail.breakdowns.volume if r.value_raw == "N/A"]
        assert na_rows, "the fixture is expected to contain N/A loan-utilization rows"
        assert all(r.value_numeric is None for r in na_rows)

    def test_raises_when_no_breakdown_is_present(self) -> None:
        with pytest.raises(ParseError, match="modal structure"):
            _parse("a drawer with no breakdown tables in it")


class TestDetailHeader:
    """The scores, standings and descriptive fields."""

    def test_reads_the_scores(self, detail_text: str) -> None:
        detail = _parse(detail_text)
        assert detail.scores.composite == pytest.approx(9.10)
        assert detail.scores.trading_kpis == pytest.approx(8.90)
        assert detail.scores.coverage_capabilities == pytest.approx(9.50)

    def test_reads_the_standings(self, detail_text: str) -> None:
        detail = _parse(detail_text)
        assert detail.standings.depth is not None
        assert detail.standings.depth.percentile == 100.0
        assert detail.standings.depth.rank == 1
        assert detail.standings.aggregated is not None
        assert detail.standings.aggregated.rank == 8

    def test_reads_the_description_and_integration_label(self, detail_text: str) -> None:
        detail = _parse(detail_text)
        assert detail.description is not None
        assert len(detail.description) > 40
        assert detail.integration_label == "Fully Integrated"

    def test_reads_engagements_and_average_fdv(self, detail_text: str) -> None:
        detail = _parse(detail_text)
        assert detail.active_engagements == 15
        assert detail.avg_fdv_usd == pytest.approx(342_310_979.0)


class TestVenueCoverage:
    """The CEX and DEX lists — the drill-down's headline value."""

    def test_reads_major_cexs(self, detail_text: str) -> None:
        detail = _parse(detail_text)
        assert "Binance" in detail.cex_supported
        assert "Coinbase Exchange" in detail.cex_supported
        assert "Kraken" in detail.cex_supported
        assert len(detail.cex_supported) >= 10

    def test_reads_major_dexs(self, detail_text: str) -> None:
        detail = _parse(detail_text)
        assert "Uniswap V3 (Base)" in detail.dex_supported
        assert "PancakeSwap (v2)" in detail.dex_supported
        assert len(detail.dex_supported) >= 3

    def test_dex_list_does_not_absorb_the_ancillary_section(self, detail_text: str) -> None:
        # The DEX list is followed by the ancillary-services heading. A collector
        # without a stop condition would swallow every following line, so this
        # pins that the boundary holds.
        detail = _parse(detail_text)
        assert "Treasury Management" not in detail.dex_supported
        assert "Treasury Management" in detail.ancillary_services

    def test_reads_engagement_options(self, detail_text: str) -> None:
        detail = _parse(detail_text)
        assert "Loan + Call Option" in detail.engagement_options
