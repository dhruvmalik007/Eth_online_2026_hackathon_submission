"""Branded units — the Python mirror of ``src/units.ts``.

Same vocabulary, same intent: make the unit part of the type so a percentage
cannot be passed where a decimal fraction is expected. ``NewType`` is a static
marker with no runtime cost, exactly like the TypeScript brand.

Units are defined here once so the two languages use identical names; a
reviewer reading either side sees the same contract.

The units contract:

===============  ============================  ==========
Unit             Meaning                       Example
===============  ============================  ==========
``Usd``          US dollars                    ``1_250_000``
``Pct``          percent points (0-100)        ``4`` = 4%
``DecimalRate``  decimal fraction              ``0.04`` = 4%
``Bps``          basis points                  ``400`` = 4%
``Days``         whole or partial days         ``30``
===============  ============================  ==========

Internal computation uses ``DecimalRate`` and ``Usd``; ``Pct`` and ``Bps`` exist
only at the snapshot and tool boundaries, converted by :func:`pct_to_rate`,
:func:`rate_to_pct` and :func:`bps_to_rate`.
"""

from __future__ import annotations

from typing import NewType

__all__ = [
    "Bps",
    "Days",
    "DecimalRate",
    "Pct",
    "Usd",
    "bps_to_rate",
    "pct_to_rate",
    "rate_to_pct",
]

Usd = NewType("Usd", float)
"""A US-dollar amount."""

Pct = NewType("Pct", float)
"""A percentage on the 0-100 scale (``4`` means 4%)."""

DecimalRate = NewType("DecimalRate", float)
"""A decimal fraction (``0.04`` means 4%) — the internal computation unit."""

Bps = NewType("Bps", int)
"""A basis-point count (``400`` means 4%)."""

Days = NewType("Days", float)
"""A duration in days."""


def pct_to_rate(value: Pct) -> DecimalRate:
    """Convert a percentage to the internal decimal rate.

    One of only three sanctioned unit conversions in the package.

    Args:
        value: A percentage on the 0-100 scale.

    Returns:
        The equivalent decimal fraction.

    Examples:
        >>> pct_to_rate(Pct(4.0))
        0.04

    """
    return DecimalRate(value / 100.0)


def rate_to_pct(value: DecimalRate) -> Pct:
    """Convert an internal decimal rate back to a percentage for publication.

    Args:
        value: A decimal fraction.

    Returns:
        The equivalent percentage on the 0-100 scale.

    Examples:
        >>> rate_to_pct(DecimalRate(0.04))
        4.0

    """
    return Pct(value * 100.0)


def bps_to_rate(value: Bps) -> DecimalRate:
    """Convert basis points to the internal decimal rate.

    Args:
        value: A basis-point count.

    Returns:
        The equivalent decimal fraction.

    Examples:
        >>> bps_to_rate(Bps(400))
        0.04

    """
    return DecimalRate(value / 10_000.0)
