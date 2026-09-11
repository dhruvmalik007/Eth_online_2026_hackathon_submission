"""Camoufox session management — the transport port and its browser adapter.

Two ideas shape this module.

**Dependency inversion.** :class:`PageFetcher` is a narrow port: it can fetch a
URL and return its text. :class:`CamoufoxFetcher` is the concrete adapter that
implements it with a stealth Firefox. Sources depend only on the port, so a
parser test can inject a fixture-backed fetcher and never launch a browser. That
is what keeps the offline suite genuinely offline.

**Bounded by construction.** Every fetch carries a timeout, retries are capped
with backoff, and the browser is torn down in a `finally` block. A scrape sweep
that can hang forever is a runaway job (plan §9), so the limits live in the
transport rather than being left to callers' discipline.
"""

from __future__ import annotations

import contextlib
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol, runtime_checkable

from .errors import SourceError

if TYPE_CHECKING:  # pragma: no cover - import-time only
    pass

__all__ = [
    "CamoufoxFetcher",
    "DetailReader",
    "FetchResult",
    "FetchSettings",
    "PageFetcher",
]


@dataclass(frozen=True, slots=True)
class FetchSettings:
    """Boundaries for a single fetch.

    Args:
        timeout_seconds: Hard per-navigation timeout. A navigation that exceeds
            this is aborted, never awaited indefinitely.
        settle_ms: Milliseconds to wait after DOM-ready before reading the body.
            Discourse forums and other JS-hydrated pages return an *empty* body
            if read too early — the probe found exactly that on two forums, where
            a correct URL looked unreachable. This delay is the fix, and it is
            bounded so it cannot become an unbounded wait.
        modal_settle_ms: Milliseconds to wait after clicking a details control.
            The drawer renders its four breakdown tables progressively, so a read
            that is too eager captures a partial card. Separate from `settle_ms`
            because a drawer takes longer to populate than a page takes to load.
        max_attempts: Total attempts including the first; retries use exponential
            backoff. Capped so a persistently failing host cannot spin.
        backoff_seconds: Base delay before the first retry; doubles thereafter.
        headless: Whether to run Firefox without a display. Cloud Run has no
            display, so this must be true there.

    """

    timeout_seconds: float = 45.0
    settle_ms: int = 2000
    modal_settle_ms: int = 5000
    max_attempts: int = 3
    backoff_seconds: float = 1.5
    headless: bool = True


@dataclass(frozen=True, slots=True)
class FetchResult:
    """What a successful fetch produced.

    Args:
        url: The URL actually requested (after any redirect).
        text: The response body as text.
        status: The HTTP status observed, when the adapter can report one.
        latency_ms: Wall-clock time for the successful attempt.

    """

    url: str
    text: str
    status: int | None
    latency_ms: float


@runtime_checkable
class PageFetcher(Protocol):
    """Port: fetch a URL and return its text.

    Deliberately narrow (ISP). A source needs content and provenance, not a
    browser handle, so it is given exactly that and nothing more.
    """

    def fetch(self, url: str, *, source_id: str) -> FetchResult:
        """Fetch ``url`` and return its body as text.

        Args:
            url: Absolute URL to fetch.
            source_id: Roster identifier, used to attribute failures.

        Returns:
            The fetched content and its timing.

        Raises:
            SourceError: If every attempt failed, or the host kept returning a
                non-success status.

        """
        ...


@runtime_checkable
class DetailReader(PageFetcher, Protocol):
    """Port: a transport that can both fetch pages *and* drive a detail drawer.

    Composed from :class:`PageFetcher` rather than duplicating ``fetch``, because
    a drawer-reading source needs both capabilities — it must read the
    leaderboard tab (to learn row order) and then open each row's drawer. The
    composition states that relationship in the type: any ``DetailReader`` is
    also a ``PageFetcher``, never the reverse.
    """

    def read_detail_modal(self, page_url: str, row_index: int, *, source_id: str) -> str:
        """Open the ``row_index``-th detail drawer on ``page_url`` and read it.

        Args:
            page_url: The leaderboard tab whose rows carry the control.
            row_index: Zero-based row position to open.
            source_id: Roster identifier, used to attribute failures.

        Returns:
            The drawer's rendered text.

        Raises:
            SourceError: When the page cannot be loaded, the row does not exist,
                or the drawer never opens.

        """
        ...


class CamoufoxFetcher:
    """A :class:`PageFetcher` backed by Camoufox (stealth Firefox).

    The browser is launched lazily on first use and reused across fetches within
    the instance, because starting Firefox costs more than the requests
    themselves. ``close()`` releases it; the class is usable as a context
    manager so teardown is guaranteed even on the error path.

    Args:
        settings: Fetch boundaries. Defaults are deliberately conservative.

    Examples:
        >>> with CamoufoxFetcher() as fetcher:            # doctest: +SKIP
        ...     result = fetcher.fetch("https://l2beat.com", source_id="l2beat")
        ...     print(result.status)

    """

    def __init__(self, settings: FetchSettings | None = None) -> None:
        self._settings = settings or FetchSettings()
        self._browser: object | None = None

    def __enter__(self) -> CamoufoxFetcher:
        """Enter the context, launching nothing yet (launch is lazy)."""
        return self

    def __exit__(self, *_exc: object) -> None:
        """Release the browser even when the body raised."""
        self.close()

    def _ensure_browser(self) -> object:
        """Launch Firefox on first use and return the browser handle.

        Returns:
            The Camoufox browser instance.

        Raises:
            SourceError: If the browser binary cannot be launched — an
                environment problem, reported once rather than per fetch.

        """
        if self._browser is not None:
            return self._browser

        try:
            # Imported here so the module (and therefore every parser test) can be
            # imported without the browser stack present.
            from camoufox.sync_api import Camoufox

            # Camoufox ships no type stubs, so this call is necessarily untyped.
            # The `ignore_missing_imports` override silences the import itself;
            # this covers the call.
            self._browser = Camoufox(headless=self._settings.headless).__enter__()  # type: ignore[no-untyped-call]
        except Exception as exc:
            raise SourceError(
                "browser",
                "could not launch Camoufox; is the browser binary installed? "
                "Run `uv run camoufox fetch` inside scraper/.",
                exc,
            ) from exc
        return self._browser

    def fetch(self, url: str, *, source_id: str) -> FetchResult:
        """Fetch ``url`` through the browser, with bounded retries.

        Args:
            url: Absolute URL to fetch.
            source_id: Roster identifier, used to attribute failures.

        Returns:
            The body text plus status and latency.

        Raises:
            SourceError: When every attempt fails or the status is not a
                success. The message names the last status and attempt count so
                the operator knows whether it was a timeout, a block, or a 404.

        """
        last_error: str = "no attempt made"
        started = time.monotonic()

        for attempt in range(1, self._settings.max_attempts + 1):
            try:
                browser = self._ensure_browser()
                page = browser.new_page()  # type: ignore[attr-defined]
                try:
                    response = page.goto(
                        url,
                        timeout=self._settings.timeout_seconds * 1000,
                        wait_until="domcontentloaded",
                    )
                    status = response.status if response is not None else None
                    if status is not None and status >= 400:
                        last_error = f"HTTP {status}"
                    else:
                        # Let a JS-hydrated page populate before reading. Reading
                        # at DOM-ready returns an empty body on Discourse forums
                        # and other client-rendered pages, which is
                        # indistinguishable from a block unless we wait.
                        if self._settings.settle_ms > 0:
                            page.wait_for_timeout(self._settings.settle_ms)
                        # `inner_text` on the body returns rendered text, which
                        # is what both a server-rendered HTML table and a JSON
                        # document (Firefox wraps it in a <pre>) present.
                        text = page.evaluate("() => document.body.innerText")
                        if isinstance(text, str) and text.strip():
                            return FetchResult(
                                url=url,
                                text=text,
                                status=status,
                                latency_ms=(time.monotonic() - started) * 1000.0,
                            )
                        last_error = "empty body"
                finally:
                    page.close()
            except SourceError:
                raise
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"

            if attempt < self._settings.max_attempts:
                time.sleep(self._settings.backoff_seconds * (2 ** (attempt - 1)))

        raise SourceError(
            source_id,
            f"fetch failed after {self._settings.max_attempts} attempt(s): {last_error}",
        )

    def close(self) -> None:
        """Tear the browser down. Safe to call more than once."""
        if self._browser is None:
            return
        try:
            self._browser.__exit__(None, None, None)  # type: ignore[attr-defined]
        except Exception:
            pass
        finally:
            self._browser = None

    def read_detail_modal(self, page_url: str, row_index: int, *, source_id: str) -> str:
        """Open a leaderboard row's detail drawer and return its rendered text.

        The drawer is the only route to a market maker's full breakdown — it is a
        modal rather than a URL, so it has to be driven: navigate to the tab, find
        the row's control, click it, and read what appears.

        The row is located by position among the ``Details`` controls rather than
        by its text, because the control is identical on every row and only its
        position identifies which maker it belongs to.

        Args:
            page_url: The leaderboard tab carrying the rows.
            row_index: Zero-based row position to open.
            source_id: Roster identifier, used to attribute failures.

        Returns:
            The drawer's text, including the page behind it, so a caller can parse
            both the maker's own figures and any context retained underneath.

        Raises:
            SourceError: When the page cannot be loaded, fewer rows exist than
                requested, or the drawer does not open.

        """
        browser = self._ensure_browser()
        page = browser.new_page()  # type: ignore[attr-defined]
        try:
            response = page.goto(
                page_url,
                timeout=self._settings.timeout_seconds * 1000,
                wait_until="domcontentloaded",
            )
            status = response.status if response is not None else None
            if status is not None and status >= 400:
                raise SourceError(source_id, f"detail page returned HTTP {status}")

            page.wait_for_timeout(self._settings.settle_ms)

            controls = page.get_by_text("Details", exact=True)
            available = controls.count()
            if available <= row_index:
                raise SourceError(
                    source_id,
                    f"requested detail row {row_index} but only {available} row(s) are present",
                )

            control = controls.nth(row_index)
            with contextlib.suppress(Exception):
                control.scroll_into_view_if_needed(timeout=self._settings.timeout_seconds * 1000)

            control.click(timeout=self._settings.timeout_seconds * 1000)
            # The drawer renders its four breakdown tables progressively; reading
            # immediately yields a partial card.
            page.wait_for_timeout(self._settings.modal_settle_ms)

            text = page.evaluate("() => document.body.innerText")
        except SourceError:
            raise
        except Exception as exc:
            raise SourceError(
                source_id,
                f"could not open the detail drawer for row {row_index}: "
                f"{type(exc).__name__}: {exc}",
            ) from exc
        finally:
            page.close()

        if not isinstance(text, str) or not text.strip():
            raise SourceError(source_id, f"detail drawer for row {row_index} rendered empty")
        return text
