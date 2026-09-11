"""L2Beat chain-risk adapter.

Parses the "Risk analysis" block of an L2Beat project page into a
:class:`ChainRiskProfile`.

Why this is not a generic HTML scrape: L2Beat's risk table is server-rendered
and, once converted to text, is a flat sequence of labelled blocks —

    STATE VALIDATION
    Fraud proofs (1R, ZK)

    Fraud proofs allow actors watching the chain to prove…

Each heading is followed by its one-line value, then prose. So the parse is
"find the heading, take the next non-empty line", which is stable across the
phrasings observed and fails loudly when a heading disappears.

The verbatim value is retained as ``raw`` beside its classification, so a
classifier change is always auditable against what the site actually said.
"""

from __future__ import annotations

import re

from ..browser import FetchResult, PageFetcher
from ..classify import (
    classify_data_availability,
    classify_exit_window,
    classify_proposer_failure,
    classify_sequencer_failure,
    classify_state_validation,
    parse_duration_days,
    parse_duration_hours,
)
from ..errors import ParseError
from ..models import (
    ChainDimensions,
    ChainRiskProfile,
    ChainStage,
    DataAvailabilityDimension,
    ExitWindowDimension,
    ProposerFailureDimension,
    Provenance,
    SequencerFailureDimension,
    SourceState,
    StateValidationDimension,
)
from ..parse import parse_usd_amount, significant_lines
from ..registry import ChainTarget, load_roster
from ..scoring import score_chain
from .base import Source

__all__ = ["L2BeatSource", "parse_chain_page"]

SCHEMA_VERSION = "0.1.0"

#: Heading text → the dimension it introduces, in the order L2Beat renders them.
_HEADINGS: dict[str, str] = {
    "STATE VALIDATION": "state_validation",
    "DATA AVAILABILITY": "data_availability",
    "EXIT WINDOW": "exit_window",
    "SEQUENCER FAILURE": "sequencer_failure",
    "PROPOSER FAILURE": "proposer_failure",
}

_STAGE_PATTERN = re.compile(r"^\s*stage\s*([0-2])\s*$", re.IGNORECASE)


def _lines(text: str) -> list[str]:
    """Split page text into significant lines.

    Thin alias kept so the parser body reads in terms of "lines" rather than the
    shared helper's name; the implementation lives in
    :func:`risk_pipeline.parse.significant_lines`.

    Args:
        text: The rendered page body.

    Returns:
        Stripped, non-empty lines.

    """
    return significant_lines(text)


def _value_after(lines: list[str], heading: str, *, search_from: int = 0) -> tuple[str, int]:
    """Return the value line following a heading.

    Args:
        lines: The page's significant lines.
        heading: The heading text to locate.
        search_from: Index to begin searching at, so the navigation block's
            duplicate headings (which appear before the real content) can be
            skipped.

    Returns:
        A ``(value, index)`` pair, where ``index`` is the heading's position.

    Raises:
        ParseError: When the heading is absent, or present with no following
            line. Both mean the page shape changed.

    """
    try:
        index = lines.index(heading, search_from)
    except ValueError as exc:
        raise ParseError(
            "l2beat",
            heading,
            f"heading not found in page body ({len(lines)} significant lines)",
        ) from exc

    for candidate in lines[index + 1 :]:
        # Stop at the next known heading so a missing value cannot silently
        # consume the following block's heading as its value.
        if candidate in _HEADINGS or candidate.startswith("STAGE "):
            break
        return candidate, index

    raise ParseError("l2beat", heading, "heading present but no value line followed it")


def _parse_stage(lines: list[str]) -> ChainStage:
    """Read the chain's Stages rating.

    L2Beat renders a comparison panel listing Stage 0, 1 and 2 as options, so the
    *first* stage mention after the "Stage" heading is the project's actual rating
    and the later ones are the alternatives. Taking the last, or all of them,
    would report the wrong stage.

    Args:
        lines: The page's significant lines.

    Returns:
        The classified stage.

    """
    try:
        start = lines.index("Stage")
    except ValueError:
        return ChainStage.NOT_APPLICABLE

    for candidate in lines[start + 1 : start + 8]:
        match = _STAGE_PATTERN.match(candidate)
        if match is not None:
            return ChainStage(f"stage-{match.group(1)}")

    return ChainStage.NOT_APPLICABLE


def _parse_tvs(lines: list[str]) -> float | None:
    """Read the chain's Total Value Secured.

    Args:
        lines: The page's significant lines.

    Returns:
        The TVS in dollars, or ``None`` when the page does not state one.

    """
    try:
        start = lines.index("Total Value Secured")
    except ValueError:
        return None
    for candidate in lines[start + 1 : start + 4]:
        amount = parse_usd_amount(candidate)
        if amount is not None:
            return amount
    return None


def parse_chain_page(
    text: str,
    target: ChainTarget,
    *,
    source_url: str,
    fetched_at: str,
) -> ChainRiskProfile:
    """Parse one L2Beat project page into a chain risk profile.

    Args:
        text: The rendered page body.
        target: The roster entry this page belongs to.
        source_url: The URL fetched, recorded for provenance.
        fetched_at: ISO timestamp of the fetch.

    Returns:
        The validated profile, including deterministically scored dimensions.

    Raises:
        ParseError: When the risk-analysis section or any of its five headings
            is absent. A missing heading means the page changed shape, and
            emitting a partial profile would quietly corrupt a risk score.

    """
    lines = _lines(text)

    try:
        risk_start = lines.index("Risk analysis")
    except ValueError as exc:
        raise ParseError(
            "l2beat", "Risk analysis", "risk-analysis section not present on the page"
        ) from exc

    raw: dict[str, str] = {}
    # Each heading is located independently from the section start rather than
    # via an advancing cursor: L2Beat does not render the five dimensions in a
    # fixed order (its page leads with Sequencer failure), so a single forward
    # scan would walk past a heading it had already passed. The nav block above
    # the section splits its labels across separate lines ("SEQUENCER" /
    # "FAILURE"), so it cannot collide with these multi-word headings.
    for heading in _HEADINGS:
        value, _ = _value_after(lines, heading, search_from=risk_start)
        raw[heading] = value

    dimensions = ChainDimensions(
        state_validation=StateValidationDimension(
            raw=raw["STATE VALIDATION"],
            category=classify_state_validation(raw["STATE VALIDATION"]),
            challenge_period_days=parse_duration_days(raw["STATE VALIDATION"]),
        ),
        data_availability=DataAvailabilityDimension(
            raw=raw["DATA AVAILABILITY"],
            category=classify_data_availability(raw["DATA AVAILABILITY"]),
        ),
        exit_window=ExitWindowDimension(
            raw=raw["EXIT WINDOW"],
            category=classify_exit_window(raw["EXIT WINDOW"]),
            days=parse_duration_days(raw["EXIT WINDOW"]),
        ),
        sequencer_failure=SequencerFailureDimension(
            raw=raw["SEQUENCER FAILURE"],
            category=classify_sequencer_failure(raw["SEQUENCER FAILURE"]),
            delay_hours=parse_duration_hours(raw["SEQUENCER FAILURE"]),
        ),
        proposer_failure=ProposerFailureDimension(
            raw=raw["PROPOSER FAILURE"],
            category=classify_proposer_failure(raw["PROPOSER FAILURE"]),
        ),
    )

    return ChainRiskProfile(
        schema_version=SCHEMA_VERSION,
        slug=target.slug,
        name=target.name,
        l2beat_url=source_url,
        stage=_parse_stage(lines),
        dimensions=dimensions,
        value_secured_usd=_parse_tvs(lines),
        risk_scores=score_chain(dimensions),
        provenance=Provenance(
            source="l2beat.com",
            source_url=source_url,
            fetched_at=fetched_at,
            state=SourceState.FRESH,
        ),
    )


class L2BeatSource(Source[ChainRiskProfile]):
    """Collects a chain risk profile for every chain in the roster.

    One page per chain, because the aggregated risk *index* renders only its
    navigation in text — an early probe measured 3.7 KB there against 37 KB for a
    chain page. Scraping the index would have produced empty records that looked
    like "no chains".
    """

    source_id = "l2beat"

    def __init__(self, targets: list[ChainTarget] | None = None) -> None:
        self._targets = targets if targets is not None else load_roster().chains

    @property
    def targets(self) -> list[ChainTarget]:
        """The chains this source will collect.

        Returns:
            A copy of the configured target list.

        """
        return list(self._targets)

    def pages(self, fetcher: PageFetcher) -> list[FetchResult]:
        """Fetch every chain's project page.

        Args:
            fetcher: The transport port.

        Returns:
            One result per chain, in roster order.

        """
        return [
            fetcher.fetch(
                f"https://l2beat.com/layer2s/projects/{t.l2beat_path}",
                source_id=self.source_id,
            )
            for t in self._targets
        ]

    def parse(self, pages: list[FetchResult]) -> list[ChainRiskProfile]:
        """Parse each fetched page into a validated profile.

        Args:
            pages: Results from :meth:`pages`, in roster order.

        Returns:
            One profile per chain. A chain whose page cannot be parsed is
            reported by raising, so the sweep records the source as failed rather
            than emitting a partial chain set.

        """
        profiles: list[ChainRiskProfile] = []
        for target, page in zip(self._targets, pages, strict=False):
            # Per-record provenance: each chain page is its own source URL, so the
            # timestamp is taken from the fetch rather than invented here.
            fetched_at = _now_iso()
            profiles.append(
                parse_chain_page(page.text, target, source_url=page.url, fetched_at=fetched_at)
            )
        return profiles


def _now_iso() -> str:
    """Current UTC time as an ISO-8601 string.

    Returns:
        A ``Z``-suffixed timestamp, matching the contract's format.

    """
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat().replace("+00:00", "Z")
