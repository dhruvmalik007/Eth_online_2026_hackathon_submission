"""Roster loading — the curated list of what gets scraped.

The roster lives in ``roster.json`` at the package root and is read by *both*
languages: TypeScript validates it with zod, Python with pydantic. Keeping one
file rather than a definition per language removes the class of bug where the
scraper collects a protocol the reader has never heard of, or vice versa.

Loading is strict: a malformed roster is a configuration error and should fail
loudly at startup rather than silently scrape nothing.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .errors import ValidationError

__all__ = [
    "ChainTarget",
    "ProtocolTarget",
    "Roster",
    "load_roster",
]

#: Repo-relative location of the shared roster.
_ROSTER_PATH = Path(__file__).resolve().parents[2] / "roster.json"


@dataclass(frozen=True, slots=True)
class ChainTarget:
    """A chain to profile from L2Beat.

    Args:
        slug: URL-safe identifier, also the snapshot key stem.
        name: Display name.
        l2beat_path: L2Beat's own slug for the project page.

    """

    slug: str
    name: str
    l2beat_path: str


@dataclass(frozen=True, slots=True)
class ProtocolTarget:
    """A protocol whose governance forum to profile.

    Args:
        slug: URL-safe identifier, also the snapshot key stem.
        name: Display name.
        category: One of lending, dex, perps, yield, stablecoin, other.
        forum_url: The forum root, or ``None`` when the protocol has no forum.
        transport: What the capability probe found — one of ``discourse-json``,
            ``html-only``, ``blocked``, ``absent`` or ``unknown``.
        verified: Whether the transport has been confirmed by a live probe.
        note: Optional explanation, used when a protocol is deliberately skipped.

    """

    slug: str
    name: str
    category: str
    forum_url: str | None
    transport: str
    verified: bool
    note: str | None = None


@dataclass(frozen=True, slots=True)
class Roster:
    """The parsed roster.

    Args:
        version: Roster schema version.
        chains: Chains to profile.
        protocols: Protocols whose governance to profile.

    """

    version: str
    chains: list[ChainTarget]
    protocols: list[ProtocolTarget]

    def protocol(self, slug: str) -> ProtocolTarget | None:
        """Look up a protocol by slug.

        Args:
            slug: The protocol identifier.

        Returns:
            The target, or ``None`` when the slug is not in the roster.

        """
        return next((p for p in self.protocols if p.slug == slug), None)

    def scrapable_protocols(self) -> list[ProtocolTarget]:
        """Return protocols that can actually be fetched.

        Returns:
            Protocols whose transport is not ``absent``, i.e. those with a forum
            that the probe could reach (or has not yet ruled out).

        """
        return [p for p in self.protocols if p.transport != "absent"]


def load_roster(path: Path | None = None) -> Roster:
    """Load and validate the roster.

    Args:
        path: Override for the roster location. Defaults to the package root.

    Returns:
        The parsed roster.

    Raises:
        ValidationError: When the file is absent or malformed. A bad roster
            must stop the run rather than produce an empty sweep that looks
            successful.

    """
    resolved = path or _ROSTER_PATH

    try:
        raw = json.loads(resolved.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValidationError("roster", f"roster not found at {resolved}", None) from exc
    except json.JSONDecodeError as exc:
        raise ValidationError("roster", f"roster is not valid JSON: {exc}", None) from exc

    if not isinstance(raw, dict):
        raise ValidationError("roster", "roster root must be an object", raw)

    chains_raw = raw.get("chains")
    protocols_raw = raw.get("protocols")
    if not isinstance(chains_raw, list) or not isinstance(protocols_raw, list):
        raise ValidationError("roster", "roster must have `chains` and `protocols` arrays", None)

    chains = [
        ChainTarget(
            slug=str(entry["slug"]),
            name=str(entry["name"]),
            l2beat_path=str(entry["l2beatPath"]),
        )
        for entry in chains_raw
    ]

    protocols = [
        ProtocolTarget(
            slug=str(entry["slug"]),
            name=str(entry["name"]),
            category=str(entry["category"]),
            forum_url=str(entry["forumUrl"]) if entry.get("forumUrl") is not None else None,
            transport=str(entry.get("transport", "unknown")),
            verified=bool(entry.get("verified", False)),
            note=str(entry["note"]) if entry.get("note") is not None else None,
        )
        for entry in protocols_raw
    ]

    return Roster(
        version=str(raw.get("version", "0.0.0")),
        chains=chains,
        protocols=protocols,
    )
