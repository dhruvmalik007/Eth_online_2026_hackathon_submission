"""The source abstraction: fetch → parse → validate → provenance.

This module owns the *contract* every source honours, and nothing else.

The template-method shape is deliberate. Subclasses implement two narrow hooks —
which URLs to fetch, and how to turn fetched text into records — and the base
class owns the parts that must not vary:

* **Error containment.** A source that fails is recorded as ``failed`` and the
  sweep continues; one broken upstream must not cost the whole refresh.
* **Provenance.** Every record set carries its source URL, fetch time and
  freshness state, so a figure the agent cites is traceable.
* **Validation.** Records are pydantic models, so constructing one *is*
  validating it. A subclass cannot return a partial or unvalidated record
  because the type system will not let it: the only way to produce a record is
  through a validated model.

That last point is the Liskov guarantee — any `Source` can stand in for any
other, because none of them can weaken the contract the base class defines.

Adding a new source is additive: write the subclass, register it. No file in
this module changes (open/closed).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from pydantic import BaseModel

from ..browser import DetailReader, FetchResult, PageFetcher
from ..errors import RiskPipelineError, SourceError
from ..models import Provenance, SourceState

__all__ = ["ModalSource", "Source", "SourceOutcome"]

#: A collection result: the validated records plus the URL they came from, so the
#: outcome can attribute provenance without the template needing to know whether
#: the source fetched pages or drove a drawer.
type Collected[RecordT: BaseModel] = tuple[list[RecordT], str]


@dataclass(frozen=True, slots=True)
class SourceOutcome[RecordT: BaseModel]:
    """The result of one source's collection attempt.

    Args:
        source_id: Roster identifier for the source.
        state: Freshness/health verdict — ``fresh`` on success, ``failed`` when
            the source could not be collected.
        records: Validated records. Empty on failure rather than partial, so a
            consumer never has to guess whether a short list means "few results"
            or "the fetch broke halfway".
        provenance: Source URL and fetch time, for citation.
        latency_ms: Wall-clock duration of the attempt.
        error: Human-readable failure reason, present only when ``state`` is
            ``failed``.

    """

    source_id: str
    state: SourceState
    records: list[RecordT]
    provenance: Provenance
    latency_ms: float
    error: str | None = None


class Source[RecordT: BaseModel](ABC):
    """Base class for every scrape target.

    Subclasses implement :meth:`pages` (which URLs to fetch) and :meth:`parse`
    (how to turn their text into records). Everything else — error containment,
    provenance, timing — is owned here so behaviour cannot drift between
    sources.

    Examples:
        >>> class Dummy(Source[ChainRiskProfile]):   # doctest: +SKIP
        ...     source_id = "dummy"
        ...     def pages(self, fetcher):
        ...         return [fetcher.fetch("https://example.test", source_id=self.source_id)]
        ...     def parse(self, pages):
        ...         return []

    """

    #: Stable identifier, matching the roster and the manifest key.
    source_id: str

    @abstractmethod
    def pages(self, fetcher: PageFetcher) -> list[FetchResult]:
        """Fetch every page this source needs.

        Args:
            fetcher: The transport port. Implementations must not construct a
                browser themselves — that is what keeps parsers testable.

        Returns:
            One result per fetched page, in the order the parser expects.

        Raises:
            SourceError: When a required page cannot be fetched.

        """
        ...

    @abstractmethod
    def parse(self, pages: list[FetchResult]) -> list[RecordT]:
        """Turn fetched pages into validated records.

        Args:
            pages: The results from :meth:`pages`, in the same order.

        Returns:
            Validated records. Returning a partial set is a bug; raise instead.

        Raises:
            ParseError: When an expected selector or field is absent — the
                site changed shape, and that must be loud.

        """
        ...

    def collect_records(self, fetcher: PageFetcher) -> Collected[RecordT]:
        """Fetch and parse, returning records and their source URL.

        Args:
            fetcher: The transport port to fetch through.

        Returns:
            The validated records and the URL they were fetched from.

        Raises:
            RiskPipelineError: When the source cannot be collected.

        """
        pages = self.pages(fetcher)
        return self.parse(pages), _primary_url(pages)

    def collect(self, fetcher: PageFetcher) -> SourceOutcome[RecordT]:
        """Run the full fetch → parse → validate cycle, containing failures.

        This is the template method: it is concrete, and subclasses should not
        override it, because doing so would bypass the provenance and error
        guarantees every consumer relies on.

        Args:
            fetcher: The transport port to fetch through.

        Returns:
            A :class:`SourceOutcome` describing what was collected, or why it
            was not. Never raises for an ordinary source failure — a failed
            source is data the manifest needs, not an exception the sweep should
            die on.

        """
        return _contained(self.source_id, lambda: self.collect_records(fetcher))

    def require(self, condition: bool, selector: str, message: str) -> None:
        """Assert a parse expectation, raising a typed failure when unmet.

        A small helper so subclasses express "this must be present" without each
        of them importing and raising the same error type.

        Args:
            condition: The expectation, e.g. ``table is not None``.
            selector: The selector or field the expectation concerns.
            message: What was expected versus found.

        Raises:
            ParseError: When ``condition`` is false.

        """
        if not condition:
            from ..errors import ParseError

            raise ParseError(self.source_id, selector, message)


class ModalSource[RecordT: BaseModel](ABC):
    """Base class for sources whose data lives behind a DOM interaction.

    Some upstreams publish per-entity detail only in a drawer that opens on a
    click, with no URL to fetch. Those cannot use :class:`Source`, whose contract
    is "fetch pages, then parse them" — they need a reader that can drive the
    DOM, which is a genuinely different capability.

    This class therefore mirrors :class:`Source`'s guarantees (error containment,
    provenance, timing) while depending on :class:`DetailReader` instead of
    :class:`PageFetcher`. Both delegate the containment template to the same
    helper, so the behaviour is identical without one inheriting from the other —
    a hierarchy that would have forced the base to know about DOM interaction.
    """

    #: Stable identifier, matching the roster and the manifest key.
    source_id: str

    @abstractmethod
    def collect_records(self, reader: DetailReader) -> Collected[RecordT]:
        """Drive the DOM and return validated records plus their source URL.

        Args:
            reader: The modal-reading port.

        Returns:
            The validated records and the URL they were read from.

        Raises:
            RiskPipelineError: When the collection cannot complete.

        """
        ...

    def collect(self, reader: DetailReader) -> SourceOutcome[RecordT]:
        """Run the collection with the same containment as :meth:`Source.collect`.

        Args:
            reader: The modal-reading port.

        Returns:
            A :class:`SourceOutcome` describing what was collected, or why not.

        """
        return _contained(self.source_id, lambda: self.collect_records(reader))


def _contained[RecordT: BaseModel](
    source_id: str, work: Callable[[], Collected[RecordT]]
) -> SourceOutcome[RecordT]:
    """Run a collection, converting a typed failure into a failed outcome.

    The shared template behind both source families. Extracting it means the
    containment rule — "a broken upstream is recorded, not raised" — is written
    once, so it cannot drift between the page-fetching and DOM-driving paths.

    Args:
        source_id: Roster identifier, used for provenance and error attribution.
        work: The collection to run, returning records and their source URL.

    Returns:
        A successful or failed outcome. Never raises for a
        :class:`RiskPipelineError`; anything else propagates, because an
        unexpected exception type is a bug rather than an upstream failure.

    """
    started = datetime.now(UTC)
    started_monotonic = _monotonic()

    try:
        records, source_url = work()
        return SourceOutcome(
            source_id=source_id,
            state=SourceState.FRESH,
            records=records,
            provenance=Provenance(
                source=source_id,
                source_url=source_url,
                fetched_at=started.isoformat().replace("+00:00", "Z"),
                state=SourceState.FRESH,
            ),
            latency_ms=(_monotonic() - started_monotonic) * 1000.0,
        )
    except RiskPipelineError as exc:
        return SourceOutcome(
            source_id=source_id,
            state=SourceState.FAILED,
            records=[],
            provenance=Provenance(
                source=source_id,
                source_url="",
                fetched_at=started.isoformat().replace("+00:00", "Z"),
                state=SourceState.FAILED,
            ),
            latency_ms=(_monotonic() - started_monotonic) * 1000.0,
            error=str(exc),
        )


def _primary_url(pages: list[FetchResult]) -> str:
    """Return the first page's URL, or an empty string when there are none.

    Args:
        pages: Fetched page results.

    Returns:
        The URL used for provenance attribution.

    """
    return pages[0].url if pages else ""


def _monotonic() -> float:
    """Read the monotonic clock.

    Isolated behind a function so tests can substitute a deterministic clock for
    latency assertions.

    Returns:
        Seconds from an arbitrary fixed point.

    """
    import time

    return time.monotonic()


# Re-exported so sources can raise the right type without a second import.
__all__ += ["SourceError"]
