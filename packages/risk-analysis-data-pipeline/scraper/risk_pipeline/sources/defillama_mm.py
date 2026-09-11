"""DefiLlama market-maker leaderboard adapter (data by Forgd).

Parses the 30-day Market Maker Performance Index into
:class:`MarketMakerProfile` records plus a :class:`MarketMakerSummary`.

The page has three distinct regions, and knowing which is which matters because
they do not carry the same fields:

1. **Hero cards** (top three makers) — the only place ``activeEngagements``,
   ``fdvUsd`` and the depth/spread/volume metrics appear.
2. **The full table** — every maker's rank, grade, composite and sub-scores.
3. **The summary strip** — the leader in each metric.

So a profile carries ``metrics=None`` for most makers. That is deliberate: the
alternative is to invent depth figures the page never published, or to pretend
every row has them. The schema makes the absence explicit instead.

Two things the page does *not* publish, and which this parser therefore does not
invent: a per-market-maker **TVL** (the 30-day block reports depth, volume,
spread and uptime), and an **Integration Level** for most rows, which renders as
an empty cell in the table.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Literal, TypedDict

from ..browser import FetchResult, PageFetcher
from ..errors import ParseError
from ..models import (
    MarketMakerGrade,
    MarketMakerLeader,
    MarketMakerMetrics,
    MarketMakerProfile,
    MarketMakerSubScores,
    Provenance,
    SourceState,
)
from ..parse import nonempty_lines, parse_percentage, parse_usd_amount
from .base import Source
from .discourse import slugify

__all__ = [
    "MarketMakerSource",
    "MarketMakerSummaryKwargs",
    "parse_market_maker_page",
]

SCHEMA_VERSION = "0.1.0"


class MarketMakerSummaryKwargs(TypedDict, total=False):
    """Keyword arguments for constructing a ``MarketMakerSummary``.

    Typed rather than ``dict[str, object]`` so a mistyped key is a type error at
    both the point of construction and the point of consumption, and so a test
    reading ``summary["top_volume"].name`` narrows to the real model instead of
    ``object``.

    ``total=False`` because this is a *builder*: the leaderboard parse supplies
    the metric leaders, and the caller then completes the identity fields
    (``maker_count`` needs the parsed profile list). Every key is optional at the
    type level and the final shape is validated by pydantic — which is the check
    that actually matters, since a missing key fails there with a field name.
    """

    schema_version: str
    generated_at: str
    maker_count: int
    top_depth: MarketMakerLeader | None
    top_volume: MarketMakerLeader | None
    top_spread: MarketMakerLeader | None
    top_uptime: MarketMakerLeader | None
    provenance: Provenance


SOURCE_URL = "https://defillama.com/market-makers"
PROVIDER = "Forgd via DefiLlama"

#: A data row's score cell, e.g. ``"\tAA\t9.40\t10.00\t8.50\t8.75\t9.30\t"``.
#: The trailing tab is significant — the Integration Level column renders empty,
#: which is why its value is captured as ``None`` rather than assumed to be zero.
_ROW_PATTERN = re.compile(
    r"^\t(?P<grade>AAA|AA|A|BBB|BB|CCC)\t"
    r"(?P<composite>\d+(?:\.\d+)?)\t"
    r"(?P<kpis>\d+(?:\.\d+)?)\t"
    r"(?P<trust>\d+(?:\.\d+)?)\t"
    r"(?P<coverage>\d+(?:\.\d+)?)\t"
    r"(?P<uptime>\d+(?:\.\d+)?)\t?"
    r"(?P<integration>\d+(?:\.\d+)?)?"
    r"\s*$"
)

_RANK_PATTERN = re.compile(r"^(?P<rank>\d+)\t$")
_ENGAGEMENTS_PATTERN = re.compile(r"^(?P<count>\d+)\s+active engagements$", re.IGNORECASE)
_RANK_LABEL_PATTERN = re.compile(r"^Rank:\s*(?P<rank>\d+)$", re.IGNORECASE)

#: The four metric-leader fields the summary strip can populate.
#:
#: The field side is a `Literal` rather than `str` so an assignment into
#: `MarketMakerSummaryKwargs` is checked against the real keys: a typo in this
#: table becomes a type error here instead of a silently dropped leader.
type LeaderField = Literal["top_depth", "top_volume", "top_spread", "top_uptime"]

#: Summary-strip labels, matched on a stable substring so the surrounding
#: punctuation (which varies, e.g. an em-dash in the uptime label) cannot break
#: the match.
_SUMMARY_LABELS: tuple[tuple[str, LeaderField], ...] = (
    ("depth (30d)", "top_depth"),
    ("highest volume", "top_volume"),
    ("bid-ask spread", "top_spread"),
    ("kpi adherence", "top_uptime"),
)


def _empty_sub_scores(grade: MarketMakerGrade, composite: float) -> MarketMakerSubScores:
    """Build a sub-score block with only the composite known.

    Args:
        grade: The maker's letter grade.
        composite: The overall composite score.

    Returns:
        A sub-score block whose components mirror the composite, used only when a
        row is present in the table without a parseable score cell.

    """
    return MarketMakerSubScores(
        trading_kpis=composite,
        trust=composite,
        coverage_capabilities=composite,
        uptime=composite,
        integration_level=None,
    )


def parse_leaderboard_table(
    lines: list[str],
    source_id: str,
) -> list[tuple[int, str, MarketMakerGrade, float, MarketMakerSubScores]]:
    r"""Parse the full leaderboard table.

    The table renders as three lines per maker — ``"<rank>\\t"``, the name, then a
    tab-delimited score cell. Parsing walks those triples rather than trying to
    parse rows from a single line, because the columns and the identity do not
    share a line.

    Args:
        lines: The page's significant lines.
        source_id: Roster identifier, for error attribution.

    Returns:
        Tuples of ``(rank, name, grade, composite, sub_scores)`` in table order.

    Raises:
        ParseError: When no data rows are found at all. An empty table means the
            page structure changed; returning an empty list would look like a
            league with no members.

    """
    rows: list[tuple[int, str, MarketMakerGrade, float, MarketMakerSubScores]] = []

    for index, line in enumerate(lines):
        rank_match = _RANK_PATTERN.match(line)
        if rank_match is None:
            continue
        if index + 2 >= len(lines):
            continue

        name = lines[index + 1]
        cell = lines[index + 2]
        score_match = _ROW_PATTERN.match(cell)
        if score_match is None or not name:
            continue

        composite = float(score_match.group("composite"))
        integration_raw = score_match.group("integration")
        rows.append(
            (
                int(rank_match.group("rank")),
                name,
                MarketMakerGrade(score_match.group("grade")),
                composite,
                MarketMakerSubScores(
                    trading_kpis=float(score_match.group("kpis")),
                    trust=float(score_match.group("trust")),
                    coverage_capabilities=float(score_match.group("coverage")),
                    uptime=float(score_match.group("uptime")),
                    integration_level=(
                        float(integration_raw) if integration_raw is not None else None
                    ),
                ),
            )
        )

    if not rows:
        raise ParseError(
            source_id,
            "leaderboard table",
            "no data rows matched; the table structure has likely changed",
        )
    return rows


def _parse_hero_cards(lines: list[str]) -> dict[str, MarketMakerMetrics]:
    """Parse the depth/spread/volume metrics from the hero cards.

    Args:
        lines: The page's significant lines.

    Returns:
        A mapping from slugified maker name to its metrics. Only the makers the
        page highlights appear — typically the top three.

    """
    metrics: dict[str, MarketMakerMetrics] = {}

    for index, line in enumerate(lines):
        if _ENGAGEMENTS_PATTERN.match(line) is None:
            continue
        if index < 1:
            continue
        name = lines[index - 1]
        window = lines[index : index + 20]

        depth = _labeled_number(window, "Avg", "Depth", parse_usd_amount)
        spread = _labeled_value(window, "Avg Spread", parse_percentage)
        volume = _labeled_value(window, "Avg Volume", parse_usd_amount)

        if depth is None and spread is None and volume is None:
            continue

        ranks = [int(m.group("rank")) for m in (_RANK_LABEL_PATTERN.match(x) for x in window) if m]
        metrics[slugify(name)] = MarketMakerMetrics(
            depth_usd=depth[0] if depth is not None else 0.0,
            depth_rank=ranks[0] if len(ranks) > 0 else None,
            spread_pct=spread if spread is not None else 0.0,
            spread_rank=ranks[1] if len(ranks) > 1 else None,
            volume_usd=volume if volume is not None else 0.0,
            volume_rank=ranks[2] if len(ranks) > 2 else None,
        )

    return metrics


def _labeled_value(
    window: list[str],
    label: str,
    parser: object,
) -> float | None:
    """Read the value on the line after a label within a window.

    Args:
        window: A slice of lines to search.
        label: The exact label text.
        parser: A single-argument callable returning ``float | None``.

    Returns:
        The parsed value, or ``None`` when the label or a parseable value is
        absent.

    """
    for i, line in enumerate(window):
        if line != label or i + 1 >= len(window):
            continue
        if callable(parser):
            result = parser(window[i + 1])
            return result if isinstance(result, float) else None
    return None


def _labeled_number(
    window: list[str],
    prefix: str,
    suffix: str,
    parser: object,
) -> tuple[float, int | None] | None:
    """Read a value whose label starts and ends with known text.

    Used for the depth label, which embeds the band width
    (``"Avg 2.00% Depth"``) and so cannot be matched by equality.

    Args:
        window: A slice of lines to search.
        prefix: Text the label must start with.
        suffix: Text the label must end with.
        parser: A single-argument callable returning ``float | None``.

    Returns:
        A ``(value, rank)`` pair, or ``None`` when absent.

    """
    for i, line in enumerate(window):
        if not (line.startswith(prefix) and line.endswith(suffix)) or i + 1 >= len(window):
            continue
        if callable(parser):
            parsed = parser(window[i + 1])
            if isinstance(parsed, float):
                rank = None
                if i + 2 < len(window):
                    match = _RANK_LABEL_PATTERN.match(window[i + 2])
                    if match is not None:
                        rank = int(match.group("rank"))
                return parsed, rank
    return None


def _parse_hero_extras(lines: list[str]) -> dict[str, tuple[int | None, float | None]]:
    """Parse engagements and FDV from the hero cards.

    Args:
        lines: The page's significant lines.

    Returns:
        A mapping from slugified name to ``(active_engagements, fdv_usd)``.

    """
    extras: dict[str, tuple[int | None, float | None]] = {}

    for index, line in enumerate(lines):
        match = _ENGAGEMENTS_PATTERN.match(line)
        if match is None or index < 1:
            continue
        name = lines[index - 1]
        engagements = int(match.group("count"))

        fdv: float | None = None
        window = lines[index : index + 12]
        for i, candidate in enumerate(window):
            if candidate.startswith("Median Engagements FDV") and i + 1 < len(window):
                fdv = parse_usd_amount(window[i + 1])
                break

        extras[slugify(name)] = (engagements, fdv)

    return extras


def _parse_summary(lines: list[str], source_url: str, fetched_at: str) -> MarketMakerSummaryKwargs:
    """Parse the summary strip's metric leaders.

    Args:
        lines: The page's significant lines.
        source_url: The URL fetched, recorded for provenance.
        fetched_at: ISO timestamp of the fetch.

    Returns:
        Keyword arguments ready to build a :class:`MarketMakerSummary`, with
        absent leaders left as ``None``.

    """
    found: MarketMakerSummaryKwargs = {}
    for i, line in enumerate(lines):
        lowered = line.lower()
        for needle, field in _SUMMARY_LABELS:
            if needle not in lowered or i + 2 >= len(lines):
                continue
            name = lines[i + 1]
            value = parse_usd_amount(lines[i + 2])
            if value is None:
                value = parse_percentage(lines[i + 2])
            if value is not None:
                found[field] = MarketMakerLeader(name=name, value=value)
    return found


def parse_market_maker_page(
    text: str,
    *,
    source_url: str,
    fetched_at: str,
) -> tuple[list[MarketMakerProfile], MarketMakerSummaryKwargs]:
    """Parse the leaderboard page into profiles plus summary inputs.

    Args:
        text: The rendered page body.
        source_url: The URL fetched, recorded for provenance.
        fetched_at: ISO timestamp of the fetch.

    Returns:
        A ``(profiles, summary_kwargs)`` pair. The summary is returned as keyword
        arguments because the leaderboard page is a single fetch that yields both
        artifact families.

    Raises:
        ParseError: When the table cannot be parsed. A leaderboard with no rows
            is a structural change, not an empty league.

    """
    lines = nonempty_lines(text)
    rows = parse_leaderboard_table(lines, "market-makers")
    hero_metrics = _parse_hero_cards(lines)
    hero_extras = _parse_hero_extras(lines)

    provenance = Provenance(
        source="defillama.com/market-makers",
        source_url=source_url,
        fetched_at=fetched_at,
        state=SourceState.FRESH,
    )

    profiles: list[MarketMakerProfile] = []
    for rank, name, grade, composite, sub_scores in rows:
        slug = slugify(name)
        engagements, fdv = hero_extras.get(slug, (None, None))
        profiles.append(
            MarketMakerProfile(
                schema_version=SCHEMA_VERSION,
                slug=slug,
                name=name,
                rank=rank,
                grade=grade,
                composite_score=composite,
                sub_scores=sub_scores,
                metrics=hero_metrics.get(slug),
                active_engagements=engagements,
                fdv_usd=fdv,
                window="30d",
                provider=PROVIDER,
                provenance=provenance,
            )
        )

    summary_kwargs = _parse_summary(lines, source_url, fetched_at)
    summary_kwargs.update(
        {
            "schema_version": SCHEMA_VERSION,
            "generated_at": fetched_at,
            "maker_count": len(profiles),
            "provenance": provenance,
        }
    )
    return profiles, summary_kwargs


class MarketMakerSource(Source[MarketMakerProfile]):
    """Collects the market-maker leaderboard.

    A single page yields every maker, so this source is one fetch rather than one
    per entity — the opposite of :class:`L2BeatSource`, which needs a page per
    chain. The shape of the upstream decides the shape of the adapter.
    """

    source_id = "market-makers"

    def pages(self, fetcher: PageFetcher) -> list[FetchResult]:
        """Fetch the leaderboard page.

        Args:
            fetcher: The transport port.

        Returns:
            A single-element list.

        """
        return [fetcher.fetch(SOURCE_URL, source_id=self.source_id)]

    def parse(self, pages: list[FetchResult]) -> list[MarketMakerProfile]:
        """Parse the leaderboard into profiles.

        Args:
            pages: The single fetched page.

        Returns:
            Every market maker on the leaderboard.

        """
        if not pages:
            raise ParseError(self.source_id, "page", "no page was fetched")
        page = pages[0]
        profiles, _ = parse_market_maker_page(
            page.text,
            source_url=page.url,
            fetched_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        )
        return profiles
