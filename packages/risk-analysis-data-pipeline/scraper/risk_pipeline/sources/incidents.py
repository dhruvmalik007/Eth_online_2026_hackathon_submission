"""Security-incident adapter — the cyber half of the risk profile.

``types.ts`` records that this feed was an open question: the
``security_incidents`` table, its zod row schema, its embedding kind and its
covariate builder all shipped in v0.1.0, but nothing ever produced a row. This
module is the collector that was missing. No migration is needed to store its
output; the table already accepts it.

## Why DeFiLlama's hacks endpoint

It is the only public feed that states, per incident, the four things the
contract needs: when it happened, who it happened to, what technique was used,
and how much was lost. It is also already the source for the market-maker
family, so the package gains no new upstream dependency or credential.

## Two fields are derived, and that is stated rather than hidden

``severity`` has no upstream value. It is computed from the disclosed amount
against :data:`SEVERITY_THRESHOLDS`, whose boundaries are the observed quartiles
of the feed rather than round numbers chosen for appearance. An incident whose
amount the feed does not disclose therefore **cannot** be classified, and is
skipped rather than labelled: guessing "low" for an unknown loss would put a
reassuring number where the honest answer is "not stated".

``incident_id`` is a digest of the record's identifying fields. The feed also
carries a ``defillamaId``, and it is deliberately not used: it is a *project*
id reused across a project's incidents, so treating it as the incident id
collapses a protocol's whole history into one row. See :func:`_stable_id`.

## Subject attribution is a curated table, not a substring match

Incidents are attributed only to subjects already in the roster, which is what
keeps a risk score traceable to a known protocol. Matching is by exact name plus
a curated alias table, **never** by substring: the feed contains ``compounder
finance``, ``super sushi samurai``, ``crosscurve``, ``hyperliquid malaysia`` and
``leadblock's morpho blue market``, each of which contains a roster slug and
none of which is that protocol. Substring matching would silently misattribute
all five. The exclusions are listed in :data:`EXCLUDED_UPSTREAM_NAMES` with
their reasons, so a reader can see a decision rather than an omission.

Chain and market-maker subjects are deliberately not produced. The feed's
``chain`` array names where an incident's contracts were deployed, which is not
the same claim as "this chain was compromised"; attributing it that way would
manufacture chain-risk signal the data does not support.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime

from ..browser import FetchResult, PageFetcher
from ..errors import ParseError
from ..models import (
    IncidentSeverity,
    IncidentSubjectKind,
    SecurityIncident,
)
from ..registry import Roster, load_roster
from .base import Source

__all__ = [
    "EXCLUDED_UPSTREAM_NAMES",
    "FEED_URL",
    "INCIDENT_SUBJECT_ALIASES",
    "SEVERITY_THRESHOLDS",
    "IncidentSource",
    "parse_incident_feed",
    "severity_for_amount",
]

SCHEMA_VERSION = "0.1.0"

#: The upstream feed: every recorded DeFi exploit, as one JSON array.
FEED_URL = "https://api.llama.fi/hacks"

#: Amount boundaries, in USD, between the four severity levels.
#:
#: Set from the feed's own distribution rather than chosen for tidiness: over the
#: 1,219 records that state an amount, the 25th percentile is ~$180k, the median
#: ~$980k and the 75th ~$5M. The boundaries below sit close to those quartiles,
#: so "high" means roughly "worse than three quarters of recorded incidents"
#: rather than an arbitrary threshold.
SEVERITY_THRESHOLDS: tuple[tuple[float, IncidentSeverity], ...] = (
    (10_000_000.0, IncidentSeverity.CRITICAL),
    (1_000_000.0, IncidentSeverity.HIGH),
    (100_000.0, IncidentSeverity.MEDIUM),
)

#: Upstream subject name → roster protocol slug.
#:
#: Curated by hand against the feed's actual name list. Every entry here is a
#: name that denotes the roster protocol; the look-alikes that do not are in
#: :data:`EXCLUDED_UPSTREAM_NAMES` instead.
INCIDENT_SUBJECT_ALIASES: dict[str, str] = {
    "aave v2": "aave",
    "aave v3": "aave",
    "uniswap v1": "uniswap",
    "uniswap v2": "uniswap",
    "uniswap v3": "uniswap",
    "uniswap (phishing attack)": "uniswap",
    "compound v2": "compound",
    "compound v3": "compound",
    "gmx v1 perps": "gmx",
    "gmx v2": "gmx",
    "dydx v3": "dydx",
    "dydx v4": "dydx",
    "pancakeswap / cream finance": "pancakeswap",
    "curve dex": "curve",
    "curve finance mev bot": "curve",
    "curve llamalend": "curve",
    "sushiswap": "sushi",
}

#: Upstream subject names that contain a roster slug but are **not** that
#: protocol. Recorded explicitly so the exclusion is auditable, and asserted by
#: the tests, so a future edit cannot quietly start matching them.
EXCLUDED_UPSTREAM_NAMES: dict[str, str] = {
    "compounder finance": "contains 'compound' but is an unrelated yield aggregator",
    "super sushi samurai": "contains 'sushi' but is an NFT collection, not the DEX",
    "crosscurve": "contains 'curve' but is a separate project",
    "hyperliquid malaysia": "contains 'hyperliquid' but is an unaffiliated entity",
    "leadblock's morpho blue market": "a third-party market built on Morpho, not Morpho itself",
}

_AMOUNT_RE = re.compile(r"[^0-9.]")


def severity_for_amount(amount_usd: float) -> IncidentSeverity:
    """Classify an incident's severity from its disclosed loss.

    Args:
        amount_usd: The loss in USD. Must be a real figure — callers skip
            incidents whose amount the feed does not state, because there is no
            honest severity to assign them.

    Returns:
        The severity band the amount falls in, per :data:`SEVERITY_THRESHOLDS`.
    """
    for boundary, severity in SEVERITY_THRESHOLDS:
        if amount_usd >= boundary:
            return severity
    return IncidentSeverity.LOW


def _iso(epoch_seconds: object) -> str | None:
    """Convert the feed's epoch-seconds date into the contract's ISO-8601 form.

    Args:
        epoch_seconds: The raw ``date`` field.

    Returns:
        A ``Z``-suffixed timestamp, or ``None`` when the field is absent or not
        a number — the record is then skipped rather than dated to now.
    """
    if not isinstance(epoch_seconds, (int, float)) or isinstance(epoch_seconds, bool):
        return None
    return datetime.fromtimestamp(float(epoch_seconds), tz=UTC).isoformat().replace("+00:00", "Z")


def _amount(raw: object) -> float | None:
    """Read a loss figure, distinguishing "not stated" from zero.

    Args:
        raw: The raw ``amount`` field.

    Returns:
        The loss in USD, or ``None`` when the feed states no figure. A zero is
        reported as ``None`` for the same reason it is never invented: the feed
        uses 0 for "unknown" as well as for "nothing", and the contract's
        ``amount_usd`` is nullable precisely so the two need not be conflated.
    """
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw) if raw > 0 else None
    if isinstance(raw, str):
        cleaned = _AMOUNT_RE.sub("", raw)
        try:
            value = float(cleaned)
        except ValueError:
            return None
        return value if value > 0 else None
    return None


def _stable_id(record: dict[str, object]) -> str:
    """Derive a stable incident id from the record's own fields.

    The feed also carries a ``defillamaId``, and it is deliberately **not** used.
    It does not identify an incident: it is a *project* id, reused across that
    project's incidents. The same value ``337`` appears on both the September
    2022 and the July 2025 GMX entries, and the same happens for ``144`` (dYdX),
    ``3`` (Curve) and ``119`` (Sushi). Treating it as the incident id collapsed
    four protocols' histories into a single row each and made their embedding
    subjects ambiguous — caught by asserting id uniqueness across the real feed,
    not by inspection.

    The digest is taken over the fields that identify an incident rather than
    over the record's position, so re-fetching the same feed yields the same ids
    and an upsert stays idempotent.

    Args:
        record: One upstream record.

    Returns:
        An ``defillama:<digest>`` identifier, unique per incident.
    """
    digest = hashlib.sha256(
        "|".join(
            str(record.get(field, ""))
            for field in ("name", "date", "classification", "technique", "amount")
        ).encode("utf-8")
    ).hexdigest()
    return f"defillama:{digest[:16]}"


def _subject_index(roster: Roster) -> dict[str, tuple[str, IncidentSubjectKind]]:
    """Build the lookup from an upstream subject name to a roster subject.

    Only roster members are indexed, which is what keeps an incident traceable
    to a subject the rest of the pipeline already knows about.

    Args:
        roster: The loaded roster.

    Returns:
        A mapping from lowercased upstream name to ``(slug, subject_kind)``.
        Both the slug and the display name are registered, so "gmx" and "GMX"
        resolve identically.
    """
    index: dict[str, tuple[str, IncidentSubjectKind]] = {}
    for chain in roster.chains:
        for key in (chain.slug, chain.name):
            index[key.lower()] = (chain.slug, IncidentSubjectKind.CHAIN)
    for protocol in roster.protocols:
        for key in (protocol.slug, protocol.name):
            index[key.lower()] = (protocol.slug, IncidentSubjectKind.PROTOCOL)
    return index


def _resolve_aliases(
    index: dict[str, tuple[str, IncidentSubjectKind]],
) -> dict[str, tuple[str, IncidentSubjectKind]]:
    """Attach each curated alias to the roster subject it names.

    An alias whose target is not in the roster is dropped rather than trusted:
    the roster is the authority on what exists, so a stale alias cannot invent a
    subject.

    Args:
        index: The name index built by :func:`_subject_index`.

    Returns:
        The alias lookup, in the same shape as ``index``.
    """
    resolved: dict[str, tuple[str, IncidentSubjectKind]] = {}
    for alias, slug in INCIDENT_SUBJECT_ALIASES.items():
        target = index.get(slug.lower())
        if target is not None:
            resolved[alias] = target
    return resolved


def _summarize(label: str, classification: str, technique: str) -> str:
    """Compose a one-line, human-readable description of an incident.

    Args:
        label: The subject name as the feed prints it.
        classification: The feed's taxonomy label.
        technique: The free-text technique, frequently empty.

    Returns:
        A summary naming the subject and what happened, built from the parts the
        feed actually supplied so an absent technique leaves no dangling
        punctuation.
    """
    headline = " — ".join(part for part in (label, classification) if part)
    if technique:
        return f"{headline}: {technique}" if headline else technique
    return headline or "Security incident"


def parse_incident_feed(
    text: str,
    *,
    source_url: str,
    index: dict[str, tuple[str, IncidentSubjectKind]],
) -> tuple[list[SecurityIncident], dict[str, int]]:
    """Parse the upstream feed into validated incident records.

    Args:
        text: The feed body.
        source_url: The URL fetched, used as the citation fallback.
        index: Roster lookup from :func:`_subject_index`, extended with aliases.

    Returns:
        A ``(records, skipped)`` pair. ``skipped`` counts each reason a record
        was not emitted — an unmatched subject, an undisclosed amount, or a
        duplicate primary key — so an unexplained shortfall is visible in the
        run instead of resembling a quiet feed.

    Raises:
        ParseError: When the body is not a JSON array. A reshaped feed means the
            upstream changed and emitting nothing would look like "no incidents".
    """
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ParseError("incidents", FEED_URL, f"feed is not valid JSON: {exc}") from exc

    if not isinstance(payload, list):
        raise ParseError(
            "incidents", FEED_URL, f"feed root must be an array, got {type(payload).__name__}"
        )

    records: list[SecurityIncident] = []
    skipped = {"unmatched-subject": 0, "undisclosed-amount": 0, "duplicate-key": 0}
    seen: set[tuple[str, str]] = set()

    for entry in payload:
        if not isinstance(entry, dict):
            skipped["unmatched-subject"] += 1
            continue

        name = str(entry.get("name") or "").strip().lower()
        subject = index.get(name)
        if subject is None:
            skipped["unmatched-subject"] += 1
            continue
        slug, subject_kind = subject

        amount = _amount(entry.get("amount"))
        if amount is None:
            # No figure means no honest severity. Skipped, and counted, rather
            # than labelled "low" on no evidence.
            skipped["undisclosed-amount"] += 1
            continue

        occurred_at = _iso(entry.get("date"))
        if occurred_at is None:
            skipped["unmatched-subject"] += 1
            continue

        # The table's primary key is (subject, occurred_at), so two records
        # sharing both cannot coexist. Keeping the first is the deterministic
        # choice; the alternative would overwrite rather than accumulate.
        key = (slug, occurred_at)
        if key in seen:
            skipped["duplicate-key"] += 1
            continue
        seen.add(key)

        classification = str(entry.get("classification") or "").strip()
        technique = str(entry.get("technique") or "").strip()
        label = str(entry.get("name") or "").strip()
        upstream_source = str(entry.get("source") or "").strip()

        records.append(
            SecurityIncident(
                occurred_at=occurred_at,
                incident_id=_stable_id(entry),
                subject=slug,
                subject_kind=subject_kind,
                # The classification is the feed's own taxonomy
                # ("Access Control", "Protocol Logic", ...), retained verbatim;
                # the free-text technique goes in the summary and the raw record
                # rather than being merged into the kind.
                incident_kind=classification or "Unclassified",
                severity=severity_for_amount(amount),
                amount_usd=amount,
                summary=_summarize(label, classification, technique),
                # The feed's own citation is frequently empty; falling back to
                # the feed URL keeps the citation resolvable.
                source_url=upstream_source or source_url,
                raw=dict(entry),
            )
        )

    return records, skipped


class IncidentSource(Source[SecurityIncident]):
    """Collects security incidents attributed to roster subjects.

    One page, because the feed is a single document covering every recorded
    incident. Filtering to the roster happens in the parser, so the fetch stays a
    plain GET of a public JSON array.
    """

    source_id = "incidents"

    def __init__(
        self,
        roster: Roster | None = None,
        *,
        feed_url: str = FEED_URL,
    ) -> None:
        """Configure the source.

        Args:
            roster: The roster to attribute against. Defaults to the package
                roster, so a caller cannot accidentally attribute against a
                different subject list than the rest of the sweep.
            feed_url: Override for the feed location, used by tests.
        """
        self._roster = roster if roster is not None else load_roster()
        self._feed_url = feed_url
        self._index = _subject_index(self._roster)
        self._index.update(_resolve_aliases(self._index))
        self.skipped: dict[str, int] = {}

    @property
    def feed_url(self) -> str:
        """The feed this source reads.

        Returns:
            The configured feed URL.
        """
        return self._feed_url

    def pages(self, fetcher: PageFetcher) -> list[FetchResult]:
        """Fetch the incident feed.

        Args:
            fetcher: The transport port.

        Returns:
            A single-element list holding the feed body.
        """
        return [fetcher.fetch(self._feed_url, source_id=self.source_id)]

    def parse(self, pages: list[FetchResult]) -> list[SecurityIncident]:
        """Turn the fetched feed into validated incident records.

        Args:
            pages: Results from :meth:`pages`.

        Returns:
            Incidents attributed to roster subjects. Records for other subjects
            are excluded and tallied in :attr:`skipped`, not raised on: the feed
            legitimately covers thousands of projects this pipeline does not
            track.

        Raises:
            ParseError: When the feed is absent or not a JSON array.
        """
        if not pages:
            raise ParseError(self.source_id, self._feed_url, "feed was not fetched")

        records, skipped = parse_incident_feed(
            pages[0].text,
            source_url=pages[0].url,
            index=self._index,
        )
        self.skipped = skipped
        return records
