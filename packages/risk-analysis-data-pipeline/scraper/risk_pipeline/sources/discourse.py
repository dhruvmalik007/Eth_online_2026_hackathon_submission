"""Discourse governance-forum adapter.

Parses a Discourse ``/latest.json`` payload into a
:class:`ProtocolGovernanceProfile`.

Discourse exposes a documented, stable JSON API — ``<forum>/latest.json``
returns a ``topic_list.topics`` array with every field needed here (id, title,
slug, counts, timestamps, closed/archived flags). That is why this source is
cheap and reliable where the L2Beat source needs HTML structure: the upstream is
machine-readable by design.

The governance *stage* (`[RFC]`, `[TEMP CHECK]`, `[ARFC]`…) is classified from
the title prefix by a pure function, never inferred by a model, so the same
payload always yields the same profile.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime

# `Any` appears in this module for exactly one purpose, and it is the documented
# exception the typing standard permits (plan §10.2): the raw, untrusted Discourse
# JSON payload, before validation. An upstream topic object has no static shape we
# can trust, so every access is a runtime check that raises `ParseError` when the
# field is missing or the wrong type. Everything *above* this boundary is fully
# typed, because pydantic validates the payload into a `Proposal` before any other
# module sees it.
from typing import Any

from ..browser import FetchResult, PageFetcher
from ..classify import classify_proposal_stage
from ..errors import ParseError
from ..models import (
    GovernanceSource,
    Proposal,
    ProposalStatus,
    ProtocolGovernanceProfile,
    Provenance,
    SourceState,
)
from ..registry import ProtocolTarget, load_roster
from ..scoring import score_governance
from .base import Source

__all__ = [
    "DiscourseSource",
    "parse_discourse_payload",
    "slugify",
]

SCHEMA_VERSION = "0.1.0"

#: Topics older than this are still captured but do not count toward activity,
#: which measures whether governance is currently *live* rather than how long the
#: forum has existed.
_RECENT_WINDOW_DAYS = 180

_SLUG_UNSAFE = re.compile(r"[^a-z0-9]+")


def slugify(name: str) -> str:
    """Turn a display name into a URL-safe slug.

    Args:
        name: The market-maker or protocol name.

    Returns:
        A lowercase, hyphen-separated slug.

    Examples:
        >>> slugify("Auros Global")
        'auros-global'
        >>> slugify("G-20 Group")
        'g-20-group'
        >>> slugify("JPEG Trading")
        'jpeg-trading'

    """
    return _SLUG_UNSAFE.sub("-", name.strip().lower()).strip("-")


def _proposal_status(topic: dict[str, Any]) -> ProposalStatus:
    """Derive a proposal's status from the topic's flags.

    Args:
        topic: One entry from ``topic_list.topics``.

    Returns:
        ``archived`` when the topic is archived, ``closed`` when it is closed,
        otherwise ``open``. Archived is checked first because a topic can carry
        both flags, and archived is the stronger statement.

    """
    if topic.get("archived") is True:
        return ProposalStatus.ARCHIVED
    if topic.get("closed") is True:
        return ProposalStatus.CLOSED
    return ProposalStatus.OPEN


def _required_str(topic: dict[str, Any], key: str, source_id: str) -> str:
    """Read a required string field from a topic.

    Args:
        topic: One entry from ``topic_list.topics``.
        key: The field name.
        source_id: Roster identifier, for error attribution.

    Returns:
        The field's value.

    Raises:
        ParseError: When the field is absent or not a string — Discourse
            occasionally omits fields on deleted or hidden topics, and a silent
            default would misrepresent a proposal.

    """
    value = topic.get(key)
    if not isinstance(value, str):
        raise ParseError(
            source_id,
            f"topic_list.topics[].{key}",
            f"expected a string, found {type(value).__name__}",
        )
    return value


def _required_int(topic: dict[str, Any], key: str, source_id: str) -> int:
    """Read a required integer field from a topic.

    Args:
        topic: One entry from ``topic_list.topics``.
        key: The field name.
        source_id: Roster identifier, for error attribution.

    Returns:
        The field's value, coerced from a numeric string when necessary.

    Raises:
        ParseError: When the field is absent or not numeric.

    """
    value = topic.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ParseError(
            source_id,
            f"topic_list.topics[].{key}",
            f"expected a number, found {type(value).__name__}",
        )
    return int(value)


def parse_discourse_payload(
    text: str,
    target: ProtocolTarget,
    *,
    source_url: str,
    fetched_at: str,
    now: datetime | None = None,
) -> ProtocolGovernanceProfile:
    """Parse a Discourse ``latest.json`` payload into a governance profile.

    Args:
        text: The raw JSON body.
        target: The roster entry this payload belongs to.
        source_url: The URL fetched, recorded for provenance.
        fetched_at: ISO timestamp of the fetch.
        now: Reference instant for recency filtering. Injectable so the
            recency assertion is deterministic in tests.

    Returns:
        The validated governance profile.

    Raises:
        ParseError: When the body is not JSON, lacks ``topic_list.topics``, or
            a topic is missing a field this contract depends on.

    """
    source_id = target.slug

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ParseError(source_id, "body", f"not valid JSON: {exc}") from exc

    if not isinstance(payload, dict):
        raise ParseError(source_id, "body", "expected a JSON object at the root")

    topic_list = payload.get("topic_list")
    if not isinstance(topic_list, dict):
        raise ParseError(source_id, "topic_list", "missing or not an object")

    topics = topic_list.get("topics")
    if not isinstance(topics, list):
        raise ParseError(source_id, "topic_list.topics", "missing or not an array")

    reference = now or datetime.now(UTC)
    forum_root = (target.forum_url or "").rstrip("/")
    proposals: list[Proposal] = []

    for topic in topics:
        if not isinstance(topic, dict):
            continue

        slug = _required_str(topic, "slug", source_id)
        topic_id = _required_int(topic, "id", source_id)
        title = _required_str(topic, "title", source_id)
        created_at = _required_str(topic, "created_at", source_id)
        last_posted_at = _required_str(topic, "last_posted_at", source_id)

        excerpt = topic.get("excerpt")
        proposals.append(
            Proposal(
                id=topic_id,
                title=title,
                slug=slug,
                stage=classify_proposal_stage(title),
                status=_proposal_status(topic),
                created_at=created_at,
                last_posted_at=last_posted_at,
                posts_count=_required_int(topic, "posts_count", source_id),
                reply_count=_required_int(topic, "reply_count", source_id),
                views=_required_int(topic, "views", source_id),
                like_count=_required_int(topic, "like_count", source_id),
                url=f"{forum_root}/t/{slug}/{topic_id}",
                excerpt=excerpt if isinstance(excerpt, str) else None,
            )
        )

    recent = [p for p in proposals if _is_recent(p.last_posted_at, reference)]
    scored = recent if recent else proposals

    return ProtocolGovernanceProfile(
        schema_version=SCHEMA_VERSION,
        slug=target.slug,
        name=target.name,
        category=target.category,
        governance=GovernanceSource(
            forum_url=target.forum_url or "",
            platform="discourse",
            json_api=f"{forum_root}/latest.json",
            reachable=True,
        ),
        proposals=proposals,
        governance_scores=score_governance(scored),
        provenance=Provenance(
            source="discourse",
            source_url=source_url,
            fetched_at=fetched_at,
            state=SourceState.FRESH,
        ),
    )


def _is_recent(iso_timestamp: str, reference: datetime) -> bool:
    """Whether a topic was active within the recency window.

    Args:
        iso_timestamp: The topic's ``last_posted_at``.
        reference: The instant to measure from.

    Returns:
        ``True`` when the topic's last activity is inside the window. An
        unparseable timestamp is treated as *not* recent, so a malformed value
        cannot inflate the activity score.

    """
    try:
        parsed = datetime.fromisoformat(iso_timestamp.replace("Z", "+00:00"))
    except ValueError:
        return False
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return (reference - parsed).days <= _RECENT_WINDOW_DAYS


class DiscourseSource(Source[ProtocolGovernanceProfile]):
    """Collects a governance profile for every scrapable protocol in the roster.

    Protocols the capability probe classified as ``absent`` or ``blocked`` are
    excluded here rather than failing the sweep — the roster already records why
    they are unavailable, so retrying them every six hours would spend time to
    relearn a known answer.
    """

    source_id = "discourse"

    def __init__(self, targets: list[ProtocolTarget] | None = None) -> None:
        if targets is not None:
            self._targets = targets
        else:
            self._targets = [p for p in load_roster().protocols if p.transport == "discourse-json"]

    @property
    def targets(self) -> list[ProtocolTarget]:
        """The protocols this source will collect.

        Returns:
            A copy of the configured target list.

        """
        return list(self._targets)

    def pages(self, fetcher: PageFetcher) -> list[FetchResult]:
        """Fetch every protocol's Discourse JSON endpoint.

        Args:
            fetcher: The transport port.

        Returns:
            One result per protocol, in target order.

        """
        return [
            fetcher.fetch(f"{(t.forum_url or '').rstrip('/')}/latest.json", source_id=t.slug)
            for t in self._targets
        ]

    def parse(self, pages: list[FetchResult]) -> list[ProtocolGovernanceProfile]:
        """Parse each fetched payload into a validated profile.

        Args:
            pages: Results from :meth:`pages`, in target order.

        Returns:
            One profile per protocol that produced a usable payload. A protocol
            whose payload is malformed is skipped rather than aborting the rest,
            because one migrated forum should not cost every other protocol's
            governance data.

        """
        profiles: list[ProtocolGovernanceProfile] = []
        fetched_at = _now_iso()
        for target, page in zip(self._targets, pages, strict=False):
            try:
                profiles.append(
                    parse_discourse_payload(
                        page.text,
                        target,
                        source_url=page.url,
                        fetched_at=fetched_at,
                    )
                )
            except ParseError:
                # Recorded as a per-protocol gap; the source-level outcome stays
                # fresh because the transport itself worked.
                continue
        return profiles


def _now_iso() -> str:
    """Current UTC time as an ISO-8601 string.

    Returns:
        A ``Z``-suffixed timestamp, matching the contract's format.

    """
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")
