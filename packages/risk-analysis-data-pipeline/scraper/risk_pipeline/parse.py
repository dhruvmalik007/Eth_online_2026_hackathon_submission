"""Shared parsing primitives for the HTML-backed sources.

Small pure helpers extracted here so the L2Beat and market-maker adapters do not
each carry their own copy — the number formats they read (``"$14.57 B"``,
``"$296.53K"``) are the same, and a fix to one should not have to be mirrored in
the other.
"""

from __future__ import annotations

import re

__all__ = [
    "nonempty_lines",
    "parse_percentage",
    "parse_usd_amount",
    "significant_lines",
]

_USD_PATTERN = re.compile(r"\$?\s*([\d,]+(?:\.\d+)?)\s*([KMBT])?", re.IGNORECASE)
_PCT_PATTERN = re.compile(r"(-?\d+(?:\.\d+)?)\s*%")

_USD_SUFFIXES: dict[str, float] = {"K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}


def significant_lines(text: str) -> list[str]:
    r"""Split rendered page text into stripped, non-empty lines.

    Use this when the parser indexes "the next line after a label" — the L2Beat
    case — where surrounding whitespace is noise.

    Args:
        text: The rendered page body.

    Returns:
        Lines with surrounding whitespace removed and empty lines dropped.

    Examples:
        >>> significant_lines("a\\n\\n  b  \\n")
        ['a', 'b']

    """
    return [line.strip() for line in text.splitlines() if line.strip()]


def nonempty_lines(text: str) -> list[str]:
    r"""Split text into non-empty lines, preserving each line verbatim.

    The market-maker leaderboard encodes its table structure *in tab characters*
    — a rank line is ``"1\\t"`` and a score cell begins with a tab. Stripping
    would erase exactly the delimiters the parse depends on, so this variant
    drops only whitespace-only lines and leaves everything else untouched.

    Args:
        text: The rendered page body.

    Returns:
        Lines whose content is more than whitespace, unmodified.

    Examples:
        >>> nonempty_lines("a\\n\\t\\n  b  \\n")
        ['a', '  b  ']

    """
    return [line for line in text.splitlines() if line.strip()]


def parse_usd_amount(text: str) -> float | None:
    """Parse a compact USD amount such as ``"$14.57 B"``.

    Args:
        text: The raw amount text.

    Returns:
        The amount in dollars, or ``None`` when the text carries no amount.

        The ``None`` case is real: some pages omit the figure. It is kept
        distinct from zero so a consumer can tell "not reported" apart from
        "nothing at stake" — a distinction that matters when the number feeds a
        risk score.

    Examples:
        >>> parse_usd_amount("$14.57 B")
        14570000000.0
        >>> parse_usd_amount("$296.53K")
        296530.0
        >>> parse_usd_amount("—") is None
        True

    """
    match = _USD_PATTERN.search(text.strip())
    if match is None:
        return None
    raw_number = match.group(1)
    if raw_number is None:
        return None
    value = float(raw_number.replace(",", ""))
    suffix = match.group(2)
    if suffix is not None:
        value *= _USD_SUFFIXES.get(suffix.upper(), 1.0)
    return value


def parse_percentage(text: str) -> float | None:
    """Parse a percentage such as ``"0.31%"`` or ``"100 %"``.

    Args:
        text: The raw percentage text.

    Returns:
        The value in percent points, or ``None`` when no percentage is present.

    Examples:
        >>> parse_percentage("0.31%")
        0.31
        >>> parse_percentage("Rank: 9") is None
        True

    """
    match = _PCT_PATTERN.search(text)
    if match is None:
        return None
    raw_number = match.group(1)
    if raw_number is None:
        return None
    return float(raw_number)
