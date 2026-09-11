r"""Parser for a market maker's "Details" modal.

The leaderboard's per-maker detail is not reachable by URL — it lives in a modal
that opens when ``Details`` is clicked on a row. This module parses the modal's
rendered text into a :class:`MarketMakerDetail`.

The modal's structure, verified against a captured payload, is four
tab-separated breakdown tables delimited by their headings, followed by four
plain lists:

    Depth KPIs, Detailed Breakdown
    <Metric>\\t<Value>\\t<Percentile>\\t<Rank>
    ...
    Volume KPIs, Detailed Breakdown
    ...
    Spread KPIs, Detailed Breakdown
    ...
    KPI Adherence, Detailed Breakdown
    ...
    Available engagement options
    <option>
    Major CEXs Supported
    <exchange>
    Major DEXs Supported
    <exchange>
    Ancillary services offered
    <service>

Two details of that structure matter:

* Each breakdown is preceded by a repeated header (``"Metric"``, ``"Value"``,
  ``"Percentile"``, ``"Rank"``, and arrow glyphs), so the parser cannot simply
  read the first lines after a heading — it must skip the header rows.
* Values include ``"N/A"``, which is preserved verbatim with a ``None`` numeric
  form rather than coerced to zero.
"""

from __future__ import annotations

from .errors import ParseError
from .models import (
    MarketMakerDetail,
    MarketMakerDetailBreakdowns,
    MarketMakerDetailScores,
    MarketMakerMetricRow,
    MarketMakerStanding,
    MarketMakerStandings,
    Provenance,
    SourceState,
)
from .parse import nonempty_lines, parse_percentage, parse_usd_amount

__all__ = [
    "BREAKDOWN_HEADINGS",
    "LIST_HEADINGS",
    "SCORE_LABELS",
    "STANDING_HEADINGS",
    "parse_market_maker_detail",
    "parse_metric_value",
]

SCHEMA_VERSION = "0.1.0"

#: Breakdown heading text → the field it populates, in modal order.
BREAKDOWN_HEADINGS: dict[str, str] = {
    "Depth KPIs, Detailed Breakdown": "depth",
    "Volume KPIs, Detailed Breakdown": "volume",
    "Spread KPIs, Detailed Breakdown": "spread",
    "KPI Adherence, Detailed Breakdown": "kpi_adherence",
}

#: List heading text → the field it populates.
LIST_HEADINGS: dict[str, str] = {
    "Available engagement options": "engagement_options",
    "Major CEXs Supported": "cex_supported",
    "Major DEXs Supported": "dex_supported",
    "Ancillary services offered": "ancillary_services",
}

#: Leaderboard heading → the standing it introduces.
STANDING_HEADINGS: dict[str, str] = {
    "Aggregated Leaderboard": "aggregated",
    "Depth Leaderboard": "depth",
    "Volume Leaderboard": "volume",
    "Spread Leaderboard": "spread",
    "KPI Adherence Leaderboard": "kpi_adherence",
}

#: Score label → the field it populates. Values print as ``"9.10/10.00"``.
SCORE_LABELS: dict[str, str] = {
    "Composite Score": "composite",
    "Trading KPIs": "trading_kpis",
    "Trust": "trust",
    "Coverage & Capabilities": "coverage_capabilities",
    "Uptime": "uptime",
    "Integration Level": "integration_level",
}

#: Header cells that precede each breakdown table's data rows.
_HEADER_CELLS: frozenset[str] = frozenset(
    {"Metric", "Value", "Percentile", "Rank", "↓", "Last 30-day", ""}
)

#: How many leading lines a list may lose to chrome before we assume the list is
#: genuinely absent. The lists render immediately after their heading, so a small
#: allowance covers a stray blank line without swallowing the next section.
_LIST_LOOKAHEAD = 40

#: How far past a standing heading to look for its percentile and rank. The modal
#: interleaves a prose sentence with the two figures, so the window must clear it.
_STANDING_LOOKAHEAD = 8


def parse_metric_value(raw: str) -> float | None:
    """Parse a modal metric value into a number when it is one.

    The modal mixes dollars, percentages and plain counts in the same column, so
    the parser tries each interpretation in turn and returns ``None`` when none
    applies — which is the correct answer for ``"N/A"``.

    Args:
        raw: The published value, e.g. ``"$553.88K"``, ``"87.46%"``, ``"11"``.

    Returns:
        The parsed magnitude, or ``None`` when the value is not numeric.

    Examples:
        >>> parse_metric_value("$553.88K")
        553880.0
        >>> parse_metric_value("87.46%")
        87.46
        >>> parse_metric_value("11")
        11.0
        >>> parse_metric_value("N/A") is None
        True

    """
    text = raw.strip()
    if not text or text.upper() == "N/A":
        return None

    if text.startswith("$"):
        return parse_usd_amount(text)

    percentage = parse_percentage(text)
    if percentage is not None:
        return percentage

    try:
        return float(text.replace(",", ""))
    except ValueError:
        return None


def _parse_breakdown_rows(lines: list[str]) -> list[MarketMakerMetricRow]:
    """Parse the tab-separated data rows of one breakdown table.

    Args:
        lines: The slice of modal lines belonging to this breakdown.

    Returns:
        One row per metric. Header cells and blank lines are skipped; a line
        without the expected three tabs is not a data row and is ignored, which
        keeps the parser tolerant of the stray layout elements the modal carries.

    """
    rows: list[MarketMakerMetricRow] = []

    for line in lines:
        if "\t" not in line:
            continue
        cells = [cell.strip() for cell in line.split("\t")]
        if len(cells) < 4:
            continue
        metric, value_raw, percentile_raw, rank_raw = cells[0], cells[1], cells[2], cells[3]
        if not metric or metric in _HEADER_CELLS:
            continue

        rows.append(
            MarketMakerMetricRow(
                metric=metric,
                value_raw=value_raw,
                value_numeric=parse_metric_value(value_raw),
                percentile=parse_percentage(percentile_raw),
                rank=_parse_rank(rank_raw),
            )
        )

    return rows


def _parse_rank(raw: str) -> int | None:
    """Parse a rank cell.

    Args:
        raw: The rank cell, e.g. ``"11"`` or ``"N/A"``.

    Returns:
        The rank, or ``None`` when the cell reports none.

    """
    try:
        return int(raw.strip())
    except ValueError:
        return None


def _parse_score(raw: str) -> float | None:
    """Parse a modal score printed as ``"9.10/10.00"``.

    Args:
        raw: The score cell.

    Returns:
        The numerator, or ``None`` when the cell is not a scale score.

    Examples:
        >>> _parse_score("9.10/10.00")
        9.1
        >>> _parse_score("N/A") is None
        True

    """
    numerator = raw.split("/")[0].strip()
    try:
        return float(numerator)
    except ValueError:
        return None


def _parse_scores(lines: list[str]) -> MarketMakerDetailScores:
    """Read the six restated scores from the modal header.

    Args:
        lines: The modal's lines.

    Returns:
        The parsed scores, with `None` for any label the modal omitted.

    """
    found: dict[str, float | None] = dict.fromkeys(SCORE_LABELS.values())
    for index, line in enumerate(lines):
        field = SCORE_LABELS.get(line)
        if field is not None and index + 1 < len(lines):
            found[field] = _parse_score(lines[index + 1])
    return MarketMakerDetailScores(**found)


def _parse_standings(lines: list[str]) -> MarketMakerStandings:
    """Read the per-leaderboard percentiles and ranks.

    The modal places a prose sentence between the heading and the two figures
    (``"Outperformed 84% of their peers..."`` then ``"Percentile: 84%"`` then
    ``"Rank: 8"``), so the search window must clear that sentence.

    Args:
        lines: The modal's lines.

    Returns:
        The parsed standings, with `None` for any leaderboard not reported.

    """
    found: dict[str, MarketMakerStanding | None] = dict.fromkeys(STANDING_HEADINGS.values())

    for index, line in enumerate(lines):
        field = STANDING_HEADINGS.get(line)
        if field is None:
            continue

        standing = MarketMakerStanding()
        for candidate in lines[index + 1 : index + 1 + _STANDING_LOOKAHEAD]:
            if candidate.startswith("Percentile:"):
                standing = MarketMakerStanding(
                    percentile=parse_percentage(candidate), rank=standing.rank
                )
            elif candidate.startswith("Rank:"):
                standing = MarketMakerStanding(
                    percentile=standing.percentile, rank=_parse_rank(candidate.split(":", 1)[1])
                )
            elif candidate in STANDING_HEADINGS:
                break
        found[field] = standing

    return MarketMakerStandings(**found)


def _parse_description(lines: list[str], name: str) -> str | None:
    """Read the maker's ``About`` blurb from the modal header.

    Args:
        lines: The modal's lines.
        name: The maker's display name, used to locate the heading.

    Returns:
        The description text, or ``None`` when the modal carries none.

    """
    heading = f"About {name}"
    for index, line in enumerate(lines):
        if line == heading and index + 1 < len(lines):
            candidate = lines[index + 1]
            # The blurb is a sentence, not a label; a short all-caps entry would
            # mean the layout moved and we should not guess.
            if len(candidate) > 40:
                return candidate
    return None


def _parse_integration_label(lines: list[str]) -> str | None:
    """Read the integration-level label from the modal header.

    Args:
        lines: The modal's lines.

    Returns:
        The label (e.g. ``"Fully Integrated"``), or ``None`` when absent.

    """
    for line in lines:
        if line in {"Fully Integrated", "Partially Integrated", "Not Integrated", "None"}:
            return line
    return None


def _parse_scalar_after(lines: list[str], label: str, parser: object) -> float | None:
    """Read a numeric value printed on the line after a label.

    Args:
        lines: The modal's lines.
        label: The exact label text.
        parser: A single-argument callable returning ``float | None``.

    Returns:
        The parsed value, or ``None`` when the label or a parseable value is
        absent.

    """
    for index, line in enumerate(lines):
        if line != label or index + 1 >= len(lines):
            continue
        if callable(parser):
            result = parser(lines[index + 1])
            return result if isinstance(result, float) else None
    return None


def _collect_list(lines: list[str], start: int) -> list[str]:
    """Collect a plain list that follows a heading.

    Args:
        lines: The modal's lines.
        start: Index just past the heading.

    Returns:
        The list entries, stopping at the next recognized heading. Entries are
        returned verbatim — a venue name is data, not something to normalize.

    """
    entries: list[str] = []
    for line in lines[start : start + _LIST_LOOKAHEAD]:
        if line in BREAKDOWN_HEADINGS or line in LIST_HEADINGS or line in STANDING_HEADINGS:
            break
        # A tab-separated line belongs to a breakdown table, not to a list.
        if "\t" in line:
            break
        entries.append(line)
    return entries


def parse_market_maker_detail(
    text: str,
    *,
    slug: str,
    name: str,
    source_url: str,
    fetched_at: str,
) -> MarketMakerDetail:
    """Parse a Details modal into a validated detail card.

    Args:
        text: The modal's rendered page text.
        slug: The maker's slug, matching its profile snapshot.
        name: The maker's display name.
        source_url: The page the modal was opened from, for provenance.
        fetched_at: ISO timestamp of the capture.

    Returns:
        The validated detail card, carrying the four KPI breakdowns, the header
        scores and standings, the venue lists and the engagement metadata.

    Raises:
        ParseError: When no breakdown table is found at all. That means the modal
            structure changed, and emitting an empty card would look like a maker
            with no metrics rather than a broken parser.

    """
    lines = nonempty_lines(text)

    # Locate each breakdown's heading, then take everything up to the next one.
    positions: list[tuple[int, str]] = []
    for index, line in enumerate(lines):
        field = BREAKDOWN_HEADINGS.get(line)
        if field is not None:
            positions.append((index, field))

    if not positions:
        raise ParseError(
            "market-makers",
            "Details modal",
            "no KPI breakdown headings found; the modal structure has changed",
        )

    boundaries = [index for index, _ in positions]
    boundaries.append(len(lines))

    breakdowns: dict[str, list[MarketMakerMetricRow]] = {
        "depth": [],
        "volume": [],
        "spread": [],
        "kpi_adherence": [],
    }
    for position, (index, field) in enumerate(positions):
        breakdowns[field] = _parse_breakdown_rows(lines[index + 1 : boundaries[position + 1]])

    lists: dict[str, list[str]] = {
        "engagement_options": [],
        "cex_supported": [],
        "dex_supported": [],
        "ancillary_services": [],
    }
    for index, line in enumerate(lines):
        field = LIST_HEADINGS.get(line)
        if field is not None:
            lists[field] = _collect_list(lines, index + 1)

    return MarketMakerDetail(
        schema_version=SCHEMA_VERSION,
        slug=slug,
        name=name,
        window="30d",
        description=_parse_description(lines, name),
        integration_label=_parse_integration_label(lines),
        scores=_parse_scores(lines),
        standings=_parse_standings(lines),
        active_engagements=_parse_int_after(lines, "Active Engagements in Forgd"),
        avg_fdv_usd=_parse_scalar_after(lines, "Avg. FDV of Projects in Forgd", parse_usd_amount),
        breakdowns=MarketMakerDetailBreakdowns(
            depth=breakdowns["depth"],
            volume=breakdowns["volume"],
            spread=breakdowns["spread"],
            kpi_adherence=breakdowns["kpi_adherence"],
        ),
        engagement_options=lists["engagement_options"],
        cex_supported=lists["cex_supported"],
        dex_supported=lists["dex_supported"],
        ancillary_services=lists["ancillary_services"],
        provenance=Provenance(
            source="defillama.com/market-makers",
            source_url=source_url,
            fetched_at=fetched_at,
            state=SourceState.FRESH,
        ),
    )


def _parse_int_after(lines: list[str], label: str) -> int | None:
    """Read a whole number printed on the line after a label.

    Args:
        lines: The modal's lines.
        label: The exact label text.

    Returns:
        The integer value, or ``None`` when the label or a numeric value is
        absent.

    """
    for index, line in enumerate(lines):
        if line != label or index + 1 >= len(lines):
            continue
        try:
            return int(lines[index + 1].strip())
        except ValueError:
            return None
    return None
