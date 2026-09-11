"""Orchestration and CLI — the composition root for the sweep.

This is the only module that knows which concrete transport, sources and writer
are in play. Everything below it depends on ports, and this module injects the
adapters, which is what makes the pipeline testable and the storage target a
configuration choice rather than a code change.

    uv run python -m risk_pipeline --no-cloud --out ./data
    uv run python -m risk_pipeline --sources l2beat,discourse
    uv run python -m risk_pipeline --no-cloud --out ./data --cadence-hours 6

Exit code is non-zero when *every* source failed, so the job can be monitored —
but a partial failure is a recorded, non-fatal outcome rather than an abort. That
distinction matters: one blocked forum must not cost the whole refresh.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from pydantic import BaseModel

from .browser import CamoufoxFetcher, FetchSettings, PageFetcher
from .errors import RiskPipelineError
from .manifest import build_manifest
from .publish import MANIFEST_KEY, GcsWriter, LocalDirWriter, SnapshotWriter, snapshot_key
from .sources.base import Source, SourceOutcome
from .sources.defillama_mm import MarketMakerSource
from .sources.discourse import DiscourseSource
from .sources.l2beat import L2BeatSource

__all__ = ["main", "run_sweep"]

#: Default refresh cadence, matching the Cloud Scheduler job.
DEFAULT_CADENCE_HOURS = 6.0

#: Source identifiers accepted by ``--sources``.
SOURCE_IDS = ("l2beat", "discourse", "market-makers")


def _build_sources(selected: set[str]) -> list[Source[BaseModel]]:
    """Construct the requested sources.

    Adding a source means adding a class and a branch here; the source's own
    module never changes, which is the open/closed property the design relies on.

    Args:
        selected: Source identifiers to include.

    Returns:
        The constructed sources, in a stable order.
    """
    sources: list[Source[BaseModel]] = []
    if "l2beat" in selected:
        sources.append(L2BeatSource())  # type: ignore[arg-type]
    if "discourse" in selected:
        sources.append(DiscourseSource())  # type: ignore[arg-type]
    if "market-makers" in selected:
        sources.append(MarketMakerSource())  # type: ignore[arg-type]
    return sources


def _resolve_writer(args: argparse.Namespace) -> SnapshotWriter:
    """Choose the snapshot writer from the CLI flags and environment.

    Args:
        args: The parsed arguments.

    Returns:
        A local-directory writer when ``--no-cloud`` or an explicit ``--out`` is
        given, otherwise a GCS writer.

    Raises:
        SystemExit: When cloud output is requested but no bucket is configured —
            failing loudly beats writing nowhere.
    """
    if args.no_cloud or args.out is not None:
        root = Path(args.out or os.environ.get("RISK_LOCAL_DIR", "./data"))
        return LocalDirWriter(root)

    bucket = os.environ.get("RISK_GCS_BUCKET", "").strip()
    if not bucket:
        print(
            "error: RISK_GCS_BUCKET is not set. Use --no-cloud to write locally, "
            "or configure the bucket.",
            file=sys.stderr,
        )
        raise SystemExit(2)
    prefix = os.environ.get("RISK_GCS_PREFIX", "risk")
    return GcsWriter(bucket, prefix)


def _write_records(
    writer: SnapshotWriter,
    outcome: SourceOutcome[BaseModel],
    *,
    log: _Logger,
) -> int:
    """Persist one source's records.

    Args:
        writer: The snapshot writer.
        outcome: The source outcome to persist.
        log: The logging callable.

    Returns:
        The number of documents written.
    """
    written = 0
    for record in outcome.records:
        kind = _kind_for(outcome.source_id)
        slug = getattr(record, "slug", None)
        if kind is None or not isinstance(slug, str):
            log("warn", outcome.source_id, "skipping a record with no slug")
            continue
        # `model_dump_json(by_alias=True)` is what produces the camelCase the
        # TypeScript contract expects; the drift test asserts the two agree.
        body = record.model_dump_json(by_alias=True)
        writer.write(snapshot_key(kind, slug), body)
        written += 1
    return written


def _kind_for(source_id: str) -> str | None:
    """Map a source identifier to its snapshot family.

    Args:
        source_id: The source identifier.

    Returns:
        The snapshot kind, or ``None`` for a source that writes no snapshots.
    """
    return {
        "l2beat": "chains",
        "discourse": "protocols",
        "market-makers": "market-makers",
    }.get(source_id)


class _Logger:
    """Structured run logging.

    Emits one record per event, in a human-readable form by default and as JSON
    when ``RISK_LOG_FORMAT=json`` so the same records are queryable in Cloud
    Logging.
    """

    def __init__(self) -> None:
        self._as_json = os.environ.get("RISK_LOG_FORMAT", "pretty") == "json"
        self.records: list[dict[str, object]] = []

    def __call__(self, level: str, stage: str, message: str, detail: object = None) -> None:
        """Emit one log record.

        Args:
            level: Severity marker — ``stage``, ``ok``, ``warn`` or ``fail``.
            stage: The pipeline stage the record belongs to.
            message: What happened.
            detail: Optional structured detail.
        """
        from datetime import UTC, datetime

        record: dict[str, object] = {
            "at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "level": level,
            "stage": stage,
            "message": message,
            "detail": detail,
        }
        self.records.append(record)
        if self._as_json:
            print(json.dumps(record), flush=True)
        else:
            mark = {"stage": "--", "ok": "OK", "warn": "!!", "fail": "XX"}.get(level, "--")
            suffix = "" if detail is None else f" {json.dumps(detail, default=str)}"
            print(f"[{mark}] {stage:<14} {message}{suffix}", flush=True)


def run_sweep(
    *,
    selected: set[str],
    writer: SnapshotWriter,
    fetcher: PageFetcher,
    cadence_hours: float,
    log: _Logger,
    limit: int | None = None,
) -> tuple[list[SourceOutcome[BaseModel]], int]:
    """Run one collection sweep.

    The fetcher is a parameter rather than constructed here, so the sweep is
    exercisable without launching a browser. Building the concrete adapter is the
    CLI's job (see :func:`main`), which is what keeps a test able to drive the
    failure paths — a broken source must be observable without a network.

    Args:
        selected: Source identifiers to collect.
        writer: Where snapshots are persisted.
        fetcher: The page-fetching port the sources read through.
        cadence_hours: The configured refresh interval, recorded in the manifest.
        log: The logger.
        limit: Optional cap on records per source, for a bounded smoke run.

    Returns:
        The per-source outcomes and the total number of documents written.
    """
    outcomes: list[SourceOutcome[BaseModel]] = []
    documents = 0

    for source in _build_sources(selected):
        log("stage", source.source_id, "collecting")
        outcome = source.collect(fetcher)

        if outcome.state.value == "failed":
            # A failed source is *recorded and skipped*, never written: writing a
            # partial record set would publish a truncated snapshot that looks
            # like the truth, and the next successful sweep would have to
            # overwrite it.
            outcomes.append(outcome)
            log("fail", source.source_id, "collection failed", {"error": outcome.error})
            continue

        if limit is not None:
            outcome = SourceOutcome(
                source_id=outcome.source_id,
                state=outcome.state,
                records=outcome.records[:limit],
                provenance=outcome.provenance,
                latency_ms=outcome.latency_ms,
                error=outcome.error,
            )

        # Recorded *after* truncation, so the manifest's `records` count always
        # equals the number of snapshots actually on disk. Recording the
        # untruncated count would advertise documents that were never written.
        outcomes.append(outcome)

        written = _write_records(writer, outcome, log=log)
        documents += written
        log(
            "ok",
            source.source_id,
            "collected",
            {
                "records": len(outcome.records),
                "written": written,
                "latencyMs": round(outcome.latency_ms, 1),
            },
        )

    temporal = None
    manifest = build_manifest(outcomes, cadence_hours=cadence_hours, temporal=temporal)
    writer.write(MANIFEST_KEY, manifest.model_dump_json(by_alias=True))
    documents += 1
    log(
        "ok",
        "manifest",
        "written",
        {"sources": len(manifest.sources), "documents": documents},
    )

    return outcomes, documents


def main(argv: list[str] | None = None) -> int:
    """CLI entry point for a collection sweep.

    Args:
        argv: Argument vector; defaults to ``sys.argv[1:]``.

    Returns:
        Process exit code — 0 on success, 1 when every source failed, 2 on a
        configuration error.
    """
    parser = argparse.ArgumentParser(description="Run a risk-data collection sweep.")
    parser.add_argument(
        "--sources",
        default=",".join(SOURCE_IDS),
        help=f"Comma-separated subset of {', '.join(SOURCE_IDS)}.",
    )
    parser.add_argument("--no-cloud", action="store_true", help="Write snapshots locally.")
    parser.add_argument("--out", default=None, help="Local output directory.")
    parser.add_argument("--dry-run", action="store_true", help="Collect without writing.")
    parser.add_argument(
        "--cadence-hours",
        type=float,
        default=DEFAULT_CADENCE_HOURS,
        help="Configured refresh interval, recorded in the manifest.",
    )
    parser.add_argument("--limit", type=int, default=None, help="Cap records per source.")
    args = parser.parse_args(argv)

    selected = {part.strip() for part in args.sources.split(",") if part.strip()}
    unknown = selected - set(SOURCE_IDS)
    if unknown:
        print(f"error: unknown source(s): {', '.join(sorted(unknown))}", file=sys.stderr)
        return 2

    log = _Logger()

    settings = FetchSettings(
        timeout_seconds=float(os.environ.get("RISK_SOURCE_TIMEOUT_S", "45")),
        headless=os.environ.get("RISK_HEADLESS", "true").lower() != "false",
    )

    try:
        writer: SnapshotWriter = (
            LocalDirWriter(Path(args.out or "./data")) if args.dry_run else _resolve_writer(args)
        )
        # The browser is opened here, around the sweep rather than inside it, so
        # one session serves every source and its teardown is guaranteed even if
        # a source raises.
        with CamoufoxFetcher(settings) as fetcher:
            outcomes, documents = run_sweep(
                selected=selected,
                writer=writer,
                fetcher=fetcher,
                cadence_hours=args.cadence_hours,
                log=log,
                limit=args.limit,
            )
    except RiskPipelineError as exc:
        log("fail", "sweep", "aborted", {"error": str(exc)})
        return 1

    fresh = sum(1 for o in outcomes if o.state.value == "fresh")
    log(
        "stage",
        "sweep",
        "complete",
        {"fresh": fresh, "sources": len(outcomes), "documents": documents},
    )

    # A sweep where nothing succeeded is a failure worth alerting on; a partial
    # success is recorded in the manifest and left for a human to weigh.
    return 0 if fresh > 0 else 1


if __name__ == "__main__":  # pragma: no cover - CLI wiring
    raise SystemExit(main())
