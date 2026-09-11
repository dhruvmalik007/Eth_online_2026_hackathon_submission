"""Manifest assembly — the artifact an operator reads first.

A run's individual snapshots say what was collected; the manifest says whether the
run *worked*. It is the one document that answers "did the sweep succeed, what is
stale, and why" without opening anything else, which is why a failed source is
recorded here with its reason rather than merely being absent.

The shape extends the manifest already used by
``data/defillama_metrics/scrape_manifest.json``, so existing tooling that reads
that file can read this one.
"""

from __future__ import annotations

from datetime import UTC, datetime

from pydantic import BaseModel

from .models import Manifest, ManifestSource, ManifestTemporal, SourceState
from .sources.base import SourceOutcome

__all__ = ["build_manifest", "empty_temporal"]

SCHEMA_VERSION = "0.1.0"


def empty_temporal() -> ManifestTemporal:
    """Return a zeroed temporal-write tally.

    Returns:
        A tally with every table at zero, used as the starting point before rows
        are written.
    """
    return ManifestTemporal(
        chain_risk_history=0,
        protocol_governance_history=0,
        market_maker_metrics=0,
        embeddings=0,
    )


def build_manifest(
    outcomes: list[SourceOutcome[BaseModel]],
    *,
    cadence_hours: float,
    temporal: ManifestTemporal | None = None,
    notes: list[str] | None = None,
) -> Manifest:
    """Assemble the run manifest from per-source outcomes.

    Args:
        outcomes: One outcome per source attempt, successful or not.
        cadence_hours: The configured refresh interval, recorded so a consumer can
            judge staleness against intent rather than guessing.
        temporal: Rows written per temporal table, when history was persisted.
        notes: Non-fatal observations worth surfacing to a human.

    Returns:
        The validated manifest.

    Raises:
        ValidationError: When an outcome carries a state the contract rejects —
            which would mean a source invented a status.
    """
    sources: dict[str, ManifestSource] = {}

    for outcome in outcomes:
        sources[outcome.source_id] = ManifestSource(
            state=outcome.state,
            fetched_at=(
                outcome.provenance.fetched_at if outcome.state == SourceState.FRESH else None
            ),
            latency_ms=outcome.latency_ms,
            records=len(outcome.records),
            content_hash=None,
            error=outcome.error,
        )

    return Manifest(
        schema_version=SCHEMA_VERSION,
        generated_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        cadence_hours=cadence_hours,
        sources=sources,
        temporal=temporal or empty_temporal(),
        notes=notes or [],
    )
