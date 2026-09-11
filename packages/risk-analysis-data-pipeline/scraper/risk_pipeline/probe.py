"""Capability probe — the gate that must pass before parsers are written.

The plan makes this Phase 0 for a reason: writing a parser against an assumed
page structure is how you end up with a pipeline that silently produces empty
records. This probe answers, for every roster target, three questions:

1. **Can we reach it at all** through the real transport (Camoufox)?
2. **What shape is the response** — machine-readable JSON, or server-rendered
   HTML that needs parsing?
3. **Are the fields we depend on actually present** in that response?

It is deliberately verbose: the output *is* the field map the parsers are built
from, so it prints counts and samples rather than a bare pass/fail.

Run it with::

    uv run python -m risk_pipeline.probe
    uv run python -m risk_pipeline.probe --only l2beat,morpho
    uv run python -m risk_pipeline.probe --no-browser   # HTTP-only dry check

Exit code is non-zero when any *required* target fails, so it can be wired into
a gate rather than read by eye.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field

from .browser import CamoufoxFetcher, FetchSettings
from .errors import RiskPipelineError
from .registry import ProtocolTarget, load_roster

__all__ = ["main", "probe"]

#: L2Beat pages the chain scraper depends on.
L2BEAT_TARGETS: dict[str, str] = {
    "risk-index": "https://l2beat.com/layer2s/risk",
    "sample-chain": "https://l2beat.com/layer2s/projects/base",
}

#: DefiLlama's market-maker leaderboard.
MARKET_MAKER_URL = "https://defillama.com/market-makers"

#: Fields the market-maker leaderboard must expose for the parser to work.
MARKET_MAKER_REQUIRED_TERMS = (
    "composite score",
    "depth",
    "spread",
    "volume",
    "uptime",
)


@dataclass
class ProbeResult:
    """The outcome of probing one target.

    Args:
        target: The identifier probed.
        transport: Classified transport — ``discourse-json``, ``html-only``,
            ``blocked``, ``absent`` or ``error``.
        reachable: Whether a response was obtained.
        bytes_received: Size of the body, a cheap proxy for "did we get a page".
        matched_terms: Required terms found in the body.
        missing_terms: Required terms absent from the body.
        error: Failure detail, when the probe could not complete.

    """

    target: str
    transport: str
    reachable: bool
    bytes_received: int = 0
    matched_terms: list[str] = field(default_factory=list)
    missing_terms: list[str] = field(default_factory=list)
    error: str | None = None


def _looks_like_json(text: str) -> bool:
    """Check whether a body is a JSON document.

    Args:
        text: The fetched body.

    Returns:
        ``True`` when the body parses as JSON and is an object or array.

    """
    stripped = text.strip()
    if stripped[:1] not in {"{", "["}:
        return False
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        return False
    return isinstance(parsed, (dict, list))


def _classify_protocol(
    target: ProtocolTarget,
    fetcher: CamoufoxFetcher,
) -> ProbeResult:
    """Probe one protocol's governance forum.

    Tries the Discourse JSON endpoint first (cheap and machine-readable), then
    the forum root. A forum that answers HTML but not JSON is still usable, just
    more expensive to parse — the distinction is recorded rather than collapsed.

    Args:
        target: The protocol roster entry.
        fetcher: The transport to fetch through.

    Returns:
        The probe result.

    """
    if target.forum_url is None:
        return ProbeResult(
            target=target.slug,
            transport="absent",
            reachable=False,
            error="no forum URL in the roster",
        )

    api_url = f"{target.forum_url.rstrip('/')}/latest.json"

    try:
        result = fetcher.fetch(api_url, source_id=target.slug)
    except RiskPipelineError as exc:
        # JSON failed. Fall back to the human-facing page to distinguish
        # "blocked entirely" from "reachable, but not a Discourse JSON API".
        try:
            page = fetcher.fetch(target.forum_url, source_id=target.slug)
        except RiskPipelineError as page_exc:
            return ProbeResult(
                target=target.slug,
                transport="blocked",
                reachable=False,
                error=f"json: {exc}; page: {page_exc}",
            )
        return ProbeResult(
            target=target.slug,
            transport="html-only",
            reachable=True,
            bytes_received=len(page.text),
            error=f"json endpoint unavailable: {exc}",
        )

    if _looks_like_json(result.text):
        try:
            payload = json.loads(result.text)
        except json.JSONDecodeError:
            payload = None
        has_topics = isinstance(payload, dict) and isinstance(payload.get("topic_list"), dict)
        return ProbeResult(
            target=target.slug,
            transport="discourse-json",
            reachable=True,
            bytes_received=len(result.text),
            matched_terms=["topic_list"] if has_topics else [],
            missing_terms=[] if has_topics else ["topic_list"],
        )

    return ProbeResult(
        target=target.slug,
        transport="html-only",
        reachable=True,
        bytes_received=len(result.text),
    )


def _probe_side(
    name: str,
    url: str,
    fetcher: CamoufoxFetcher,
    required_terms: tuple[str, ...] = (),
) -> ProbeResult:
    """Probe an HTML page and check for required terms.

    Args:
        name: Identifier for reporting.
        url: The page to fetch.
        fetcher: The transport to fetch through.
        required_terms: Case-insensitive substrings that must appear.

    Returns:
        The probe result, with matched and missing terms populated.

    """
    try:
        result = fetcher.fetch(url, source_id=name)
    except RiskPipelineError as exc:
        return ProbeResult(
            target=name,
            transport="blocked",
            reachable=False,
            error=str(exc),
        )

    lowered = result.text.lower()
    matched = [term for term in required_terms if term in lowered]
    missing = [term for term in required_terms if term not in lowered]

    return ProbeResult(
        target=name,
        transport="html-only" if not _looks_like_json(result.text) else "json",
        reachable=True,
        bytes_received=len(result.text),
        matched_terms=matched,
        missing_terms=missing,
    )


def probe(only: set[str] | None = None) -> list[ProbeResult]:
    """Probe every roster target and the fixed pages the scraper needs.

    Args:
        only: When given, restrict to these target identifiers.

    Returns:
        One result per probed target. Failures are captured as results rather
        than raised, so a single unreachable forum does not hide the rest of the
        report.

    """
    roster = load_roster()
    results: list[ProbeResult] = []
    settings = FetchSettings()

    with CamoufoxFetcher(settings) as fetcher:
        if only is None or "l2beat" in only:
            for name, url in L2BEAT_TARGETS.items():
                results.append(
                    _probe_side(
                        f"l2beat:{name}",
                        url,
                        fetcher,
                        required_terms=("state validation", "sequencer"),
                    )
                )

        if only is None or "market-makers" in only:
            results.append(
                _probe_side(
                    "defillama:market-makers",
                    MARKET_MAKER_URL,
                    fetcher,
                    required_terms=MARKET_MAKER_REQUIRED_TERMS,
                )
            )

        for target in roster.protocols:
            if only is not None and target.slug not in only and "protocols" not in only:
                continue
            results.append(_classify_protocol(target, fetcher))

    return results


def _print_report(results: list[ProbeResult]) -> int:
    """Print the probe report and return the count of failed targets.

    Args:
        results: Probe results to report.

    Returns:
        The number of targets that were unreachable or missing required fields.

    """
    failures = 0
    print("\n" + "=" * 78)
    print("CAPABILITY PROBE — transport and field map")
    print("=" * 78)

    for result in results:
        if result.transport in {"blocked", "error"} or result.missing_terms:
            status = "FAIL"
            failures += 1
        elif result.transport == "absent":
            status = "SKIP"
        else:
            status = " OK "
        print(f"[{status}] {result.target:<34} transport={result.transport}")
        if result.bytes_received:
            print(f"        bytes={result.bytes_received:,}")
        if result.matched_terms:
            print(f"        matched: {', '.join(result.matched_terms)}")
        if result.missing_terms:
            print(f"        MISSING: {', '.join(result.missing_terms)}")
        if result.error:
            print(f"        error: {result.error[:200]}")

    print("=" * 78)
    print(f"{len(results) - failures} ok, {failures} failed")
    print("=" * 78 + "\n")
    return failures


def main(argv: list[str] | None = None) -> int:
    """CLI entry point for the capability probe.

    Args:
        argv: Argument vector; defaults to ``sys.argv[1:]``.

    Returns:
        Process exit code — 0 when every required target passed, 1 otherwise.

    """
    parser = argparse.ArgumentParser(description="Probe scrape-target capability.")
    parser.add_argument(
        "--only",
        default=None,
        help="Comma-separated subset: l2beat, market-makers, protocols, or slugs.",
    )
    args = parser.parse_args(argv)

    only = {part.strip() for part in args.only.split(",")} if args.only else None
    try:
        results = probe(only)
    except RiskPipelineError as exc:
        print(f"probe aborted: {exc}", file=sys.stderr)
        return 1

    return 1 if _print_report(results) else 0


if __name__ == "__main__":  # pragma: no cover - CLI wiring
    raise SystemExit(main())
