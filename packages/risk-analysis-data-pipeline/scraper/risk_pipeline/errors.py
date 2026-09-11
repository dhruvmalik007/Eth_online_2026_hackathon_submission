"""Structured, typed failures for the risk pipeline worker.

Mirrors the TypeScript hierarchy in ``src/errors.ts``. Every failure carries the
context needed to act on it — the source that failed, the selector that did not
match, the field that failed validation — so the orchestrator can decide whether
a failure is containable (mark the source failed, continue the sweep) or fatal
(abort the run) from the exception type rather than from a message string.

No library code raises a bare ``Exception``; everything derives from
:class:`RiskPipelineError`.
"""

from __future__ import annotations

__all__ = [
    "ParseError",
    "RiskPipelineError",
    "SourceError",
    "StoreError",
    "ValidationError",
]


class RiskPipelineError(Exception):
    """Base class for every error this package raises.

    Args:
        message: Description phrased so an operator knows which source or record
            is implicated.
        cause: The underlying exception, when this one wraps another.

    """

    def __init__(self, message: str, cause: BaseException | None = None) -> None:
        super().__init__(message)
        self.cause = cause


class SourceError(RiskPipelineError):
    """A source could not be fetched.

    Containable: the orchestrator records the source as ``failed`` in the
    manifest and continues, so one broken upstream does not cost the whole
    refresh.

    Args:
        source_id: Stable identifier from the roster, e.g. ``l2beat``.
        message: What went wrong, including the URL where relevant.
        cause: The underlying exception.

    """

    def __init__(self, source_id: str, message: str, cause: BaseException | None = None) -> None:
        super().__init__(f"[{source_id}] {message}", cause)
        self.source_id = source_id


class ParseError(RiskPipelineError):
    """A source responded, but its expected structure was not found.

    Distinct from :class:`SourceError` because the remedy differs: the site is
    reachable, so the fix is a selector or classifier change. Carrying the
    selector makes that obvious.

    Args:
        source_id: Stable identifier from the roster.
        selector: The selector, JSON path or field that did not resolve.
        message: What was expected versus what was found.

    """

    def __init__(self, source_id: str, selector: str, message: str) -> None:
        super().__init__(f'[{source_id}] parse failure at "{selector}": {message}')
        self.source_id = source_id
        self.selector = selector


class ValidationError(RiskPipelineError):
    """A record failed schema validation at the boundary.

    Args:
        field_path: Dotted path to the failing field, from pydantic's error
            location, so the failure names the exact field rather than the record.
        message: The validation message.
        value: The rejected value, for diagnostics.

    """

    def __init__(self, field_path: str, message: str, value: object) -> None:
        super().__init__(f'validation failed at "{field_path}": {message}')
        self.field_path = field_path
        self.value = value


class StoreError(RiskPipelineError):
    """The snapshot store (GCS or the local directory) could not be written.

    Args:
        operation: ``read``, ``write`` or ``list``.
        key: The object key or path involved.
        message: What went wrong.
        cause: The underlying exception.

    """

    def __init__(
        self,
        operation: str,
        key: str,
        message: str,
        cause: BaseException | None = None,
    ) -> None:
        super().__init__(f'store {operation} failed for "{key}": {message}', cause)
        self.operation = operation
        self.key = key
