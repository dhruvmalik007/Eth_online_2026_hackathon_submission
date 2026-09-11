"""Failure-path tests for the sweep orchestration.

The load-bearing property is that one broken upstream must not cost the whole
refresh, and that the damage must be *visible*: a failed source is recorded with
its error in the manifest, and none of its records are written. A sweep that
silently wrote a truncated snapshot would publish a partial truth that looks
complete, which is worse than publishing nothing.

The fetcher is injected, so every case here runs offline — no browser, no
network. That injection is the reason these paths are testable at all.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from risk_pipeline.__main__ import _Logger, run_sweep
from risk_pipeline.browser import FetchResult
from risk_pipeline.errors import SourceError
from risk_pipeline.publish import LocalDirWriter


class FakeFetcher:
    """A page fetcher whose bodies, or failures, are scripted per URL fragment.

    Satisfies the ``PageFetcher`` port structurally — the sources depend on the
    protocol, so a plain object works without inheriting the real browser adapter
    and without launching Firefox.
    """

    def __init__(
        self,
        *,
        bodies: dict[str, str] | None = None,
        failing: set[str] | None = None,
    ) -> None:
        """Script the fetcher.

        Args:
            bodies: URL fragment to response body. The first matching fragment
                wins, so a specific URL can be listed before a broader one.
            failing: URL fragments that raise, simulating a blocked host.
        """
        self._bodies = bodies or {}
        self._failing = failing or set()
        self.requests: list[str] = []

    def _respond(self, url: str, source_id: str) -> str:
        self.requests.append(url)
        for fragment in self._failing:
            if fragment in url:
                # A `SourceError` specifically, because that is what the port
                # contract says a failed fetch raises — and what the source base
                # class contains. Any other exception is treated as a bug and
                # deliberately propagates, so raising `RuntimeError` here would
                # test the wrong thing.
                raise SourceError(source_id, f"simulated transport failure for {fragment}")
        for fragment, body in self._bodies.items():
            if fragment in url:
                return body
        raise SourceError(source_id, f"no scripted response for {url}")

    def fetch(self, url: str, *, source_id: str) -> FetchResult:
        """Return the scripted body for ``url``, or raise if it is marked failing.

        Args:
            url: The URL being fetched.
            source_id: Roster identifier, attributed to any failure.

        Returns:
            The scripted body with synthetic timing.

        Raises:
            SourceError: When the URL matches a failing fragment, or has no script.
        """
        return FetchResult(
            url=url,
            text=self._respond(url, source_id),
            status=200,
            latency_ms=1.0,
        )

    def read_detail_modal(self, page_url: str, row_index: int, *, source_id: str) -> str:
        """Return a scripted drawer body, or raise if the page is marked failing.

        Args:
            page_url: The leaderboard page whose drawer is being opened.
            row_index: Zero-based row position.
            source_id: Roster identifier, attributed to any failure.

        Returns:
            The scripted drawer text.

        Raises:
            SourceError: When the page matches a failing fragment, or has no script.
        """
        return self._respond(f"{page_url}#detail-{row_index}", source_id)


def _manifest(out_dir: Path) -> dict[str, Any]:
    """Read the written manifest.

    Args:
        out_dir: The sweep's output directory.

    Returns:
        The parsed manifest.

    Raises:
        AssertionError: When the file is not a JSON object, which means the
            writer produced something other than a manifest.
    """
    data: object = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
    if not isinstance(data, dict):  # pragma: no cover - defensive
        raise AssertionError("manifest is not a JSON object")
    return data


@pytest.fixture
def out_dir(tmp_path: Path) -> Path:
    """A pristine output directory per test."""
    return tmp_path


class TestFailureIsolation:
    """A failure in one source must be contained and recorded."""

    def test_a_failing_source_does_not_abort_the_sweep(
        self, out_dir: Path, l2beat_base_html: str
    ) -> None:
        # The l2beat page is served from the real captured fixture; the governance
        # forum is blocked. Both sources must run, because one blocked forum must
        # not cost the refresh.
        fetcher = FakeFetcher(
            bodies={"l2beat.com": l2beat_base_html},
            failing={"governance.aave.com"},
        )

        outcomes, _ = run_sweep(
            selected={"l2beat", "discourse"},
            writer=LocalDirWriter(out_dir),
            fetcher=fetcher,
            cadence_hours=6.0,
            log=_Logger(),
        )

        states = {o.source_id: o.state.value for o in outcomes}
        assert states["discourse"] == "failed"
        # The healthy source still produced its snapshot.
        assert states["l2beat"] == "fresh"
        assert list(out_dir.glob("chains/*.json")) != []

    def test_the_manifest_records_the_error_with_its_source(self, out_dir: Path) -> None:
        fetcher = FakeFetcher(failing={"l2beat.com", "governance.aave.com", "defillama.com"})

        run_sweep(
            selected={"l2beat", "discourse"},
            writer=LocalDirWriter(out_dir),
            fetcher=fetcher,
            cadence_hours=6.0,
            log=_Logger(),
        )

        manifest = _manifest(out_dir)
        failed = manifest["sources"]["discourse"]
        assert failed["state"] == "failed"
        # The error travels with the state; a bare "failed" leaves an operator
        # with nothing to act on.
        assert failed["error"]

    def test_a_failing_source_writes_no_partial_records(self, out_dir: Path) -> None:
        # The property that matters most: a truncated snapshot must never be
        # published, because a reader cannot tell it from a complete one.
        fetcher = FakeFetcher(failing={"l2beat.com", "governance.aave.com"})

        run_sweep(
            selected={"l2beat", "discourse"},
            writer=LocalDirWriter(out_dir),
            fetcher=fetcher,
            cadence_hours=6.0,
            log=_Logger(),
        )

        assert list(out_dir.glob("chains/*.json")) == []
        assert list(out_dir.glob("protocols/*.json")) == []

    def test_a_sweep_where_every_source_fails_still_writes_a_manifest(self, out_dir: Path) -> None:
        # A manifest listing only failures is a diagnosis. No manifest at all
        # would be indistinguishable from the job never having run.
        fetcher = FakeFetcher(failing={"l2beat.com", "governance.aave.com"})

        outcomes, documents = run_sweep(
            selected={"l2beat", "discourse"},
            writer=LocalDirWriter(out_dir),
            fetcher=fetcher,
            cadence_hours=6.0,
            log=_Logger(),
        )

        assert all(o.state.value == "failed" for o in outcomes)
        # Only the manifest document was written.
        assert documents == 1
        assert set(_manifest(out_dir)["sources"]) == {"l2beat", "discourse"}


class TestLimitConsistency:
    """The manifest's counts must describe what is actually on disk."""

    def test_the_record_count_matches_the_documents_written(
        self, out_dir: Path, l2beat_base_html: str
    ) -> None:
        # A regression here once advertised 12 records while writing 3 documents:
        # the cap was applied after the outcome was recorded, so the manifest
        # overstated the snapshot and a consumer would have waited for files that
        # never arrived.
        fetcher = FakeFetcher(bodies={"l2beat.com": l2beat_base_html})

        run_sweep(
            selected={"l2beat"},
            writer=LocalDirWriter(out_dir),
            fetcher=fetcher,
            cadence_hours=6.0,
            log=_Logger(),
            limit=1,
        )

        manifest = _manifest(out_dir)
        records = manifest["sources"]["l2beat"]["records"]
        documents = len(list(out_dir.glob("chains/*.json")))
        assert records == documents == 1
