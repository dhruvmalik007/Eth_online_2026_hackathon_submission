"""Tests for the DeFiLlama security-incident collector.

Assertions are against the *real* feed, trimmed to the records that exercise the
parser. The bar is not "the parser returned something" but "it attributed every
incident to the right subject, and refused to attribute the look-alikes".

The five look-alikes matter more than the eighteen matches: ``compounder
finance``, ``super sushi samurai``, ``crosscurve``, ``hyperliquid malaysia`` and
``leadblock's morpho blue market`` each contain a roster slug, so a substring
match would attribute all five to protocols they have nothing to do with.
"""

from __future__ import annotations

import pytest

from risk_pipeline.errors import ParseError
from risk_pipeline.models import IncidentSeverity, IncidentSubjectKind
from risk_pipeline.registry import load_roster
from risk_pipeline.sources.incidents import (
    EXCLUDED_UPSTREAM_NAMES,
    INCIDENT_SUBJECT_ALIASES,
    IncidentSource,
    _resolve_aliases,
    _subject_index,
    parse_incident_feed,
    severity_for_amount,
)

FEED_URL = "https://api.llama.fi/hacks"


def _index() -> dict[str, tuple[str, IncidentSubjectKind]]:
    """Build the lookup the parser uses, from the real roster.

    Returns:
        The name index extended with the curated aliases.
    """
    index = _subject_index(load_roster())
    index.update(_resolve_aliases(index))
    return index


def _parse(text: str) -> tuple[list, dict[str, int]]:
    """Parse a feed body with the real roster index.

    Args:
        text: The feed body.

    Returns:
        The ``(records, skipped)`` pair.
    """
    return parse_incident_feed(text, source_url=FEED_URL, index=_index())


class TestSeverityDerivation:
    """Severity is derived from the disclosed amount, at documented boundaries."""

    @pytest.mark.parametrize(
        ("amount", "expected"),
        [
            (0.0, IncidentSeverity.LOW),
            (99_999.0, IncidentSeverity.LOW),
            (100_000.0, IncidentSeverity.MEDIUM),
            (999_999.0, IncidentSeverity.MEDIUM),
            (1_000_000.0, IncidentSeverity.HIGH),
            (9_999_999.0, IncidentSeverity.HIGH),
            (10_000_000.0, IncidentSeverity.CRITICAL),
            (3_500_000_000.0, IncidentSeverity.CRITICAL),
        ],
    )
    def test_bands(self, amount: float, expected: IncidentSeverity) -> None:
        assert severity_for_amount(amount) == expected

    def test_every_level_is_reachable_from_the_real_feed(
        self, defillama_hacks_json: str
    ) -> None:
        # If a band were unreachable the thresholds would be decorative, so this
        # asserts the policy actually partitions the data.
        records, _ = _parse(defillama_hacks_json)
        assert {r.severity for r in records} == set(IncidentSeverity)


class TestSubjectAttribution:
    """Only roster subjects are attributed, by exact name or curated alias."""

    def test_emits_exactly_the_roster_incidents(self, defillama_hacks_json: str) -> None:
        records, _ = _parse(defillama_hacks_json)

        assert len(records) == 18
        assert {r.subject for r in records} == {
            "aave",
            "compound",
            "curve",
            "dydx",
            "gmx",
            "hyperliquid",
            "pancakeswap",
            "sushi",
            "uniswap",
        }

    def test_never_attributes_a_look_alike_name(self, defillama_hacks_json: str) -> None:
        # The core correctness property of the curated-alias design.
        records, skipped = _parse(defillama_hacks_json)
        subjects = {r.subject for r in records}

        for trapped in EXCLUDED_UPSTREAM_NAMES:
            assert trapped not in _index(), f"{trapped!r} leaked into the subject index"
        # Each trap is counted as unmatched, not silently dropped.
        assert skipped["unmatched-subject"] == len(EXCLUDED_UPSTREAM_NAMES)
        # Morpho's only entry in the feed is "leadblock's morpho blue market", a
        # third-party market built on it. Excluding that look-alike leaves morpho
        # with no incidents -- the correct answer, not a gap in the data.
        assert "morpho" not in subjects
        # The protocols whose names were also trapped still carry genuine records,
        # so the exclusion did not over-reach and silence the real protocol.
        assert {"compound", "sushi", "curve", "hyperliquid"} <= subjects

    def test_alias_targets_are_roster_members(self) -> None:
        # A stale alias must not be able to invent a subject.
        index = _index()
        for alias, (slug, _kind) in index.items():
            if alias in INCIDENT_SUBJECT_ALIASES:
                assert index.get(slug) is not None, f"alias {alias!r} points at unknown {slug!r}"

    def test_subject_kind_is_protocol_only(self, defillama_hacks_json: str) -> None:
        # Chain and market-maker kinds are deliberately not produced: the feed's
        # `chain` array says where contracts were deployed, not that a chain was
        # compromised.
        records, _ = _parse(defillama_hacks_json)
        assert {r.subject_kind for r in records} == {IncidentSubjectKind.PROTOCOL}


class TestRecordShape:
    """Each record satisfies the contract the timeseries table already declares."""

    def test_ids_are_unique_and_stable(self, defillama_hacks_json: str) -> None:
        first, _ = _parse(defillama_hacks_json)
        second, _ = _parse(defillama_hacks_json)

        ids = [r.incident_id for r in first]
        assert len(set(ids)) == len(ids), "incident ids must be unique across the feed"
        # Re-parsing the same body must produce the same ids, or an upsert is not
        # idempotent. Regression guard: defillamaId is a *project* id reused
        # across a project's incidents, so it must never be the incident id.
        assert [r.incident_id for r in second] == ids

    def test_primary_key_is_unique(self, defillama_hacks_json: str) -> None:
        # The table's PK is (subject, occurred_at); a collision would abort the
        # insert batch.
        records, _ = _parse(defillama_hacks_json)
        keys = [(r.subject, r.occurred_at) for r in records]
        assert len(set(keys)) == len(keys)

    def test_undisclosed_amounts_are_skipped_not_zeroed(
        self, defillama_hacks_json: str
    ) -> None:
        records, skipped = _parse(defillama_hacks_json)

        # A zero or absent amount has no honest severity, so it is excluded and
        # counted rather than labelled "low".
        assert skipped["undisclosed-amount"] == 2
        assert all(r.amount_usd is not None and r.amount_usd > 0 for r in records)

    def test_retains_the_upstream_record_verbatim(self, defillama_hacks_json: str) -> None:
        records, _ = _parse(defillama_hacks_json)
        record = records[0]

        assert record.raw["name"]
        assert record.raw["date"]
        assert isinstance(record.raw["amount"], int)
        assert record.occurred_at.endswith("Z")

    def test_summary_names_the_subject_and_technique(self, defillama_hacks_json: str) -> None:
        records, _ = _parse(defillama_hacks_json)
        gmx = next(r for r in records if r.subject == "gmx")

        assert "GMX" in gmx.summary
        assert gmx.incident_kind in gmx.summary or gmx.raw["classification"] in gmx.summary

    def test_source_url_is_always_resolvable(self, defillama_hacks_json: str) -> None:
        # The feed's own `source` field is usually empty; the citation falls back
        # to the feed URL so it always resolves to something real.
        records, _ = _parse(defillama_hacks_json)
        assert all(r.source_url for r in records)


class TestFailurePaths:
    """A reshaped feed is loud, never a silent empty result."""

    def test_rejects_a_non_json_body(self) -> None:
        with pytest.raises(ParseError):
            _parse("<html>not json</html>")

    def test_rejects_a_non_array_root(self) -> None:
        with pytest.raises(ParseError):
            _parse('{"hacks": []}')

    def test_an_empty_feed_is_not_an_error(self) -> None:
        records, skipped = _parse("[]")
        assert records == []
        assert skipped["unmatched-subject"] == 0


class TestSourceWiring:
    """The Source adapter exposes the feed and the roster index it built."""

    def test_source_id_and_feed_url(self) -> None:
        source = IncidentSource()

        assert source.source_id == "incidents"
        assert source.feed_url == FEED_URL
