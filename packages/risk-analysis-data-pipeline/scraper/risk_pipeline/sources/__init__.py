"""Source adapters — one per upstream family.

Each module here implements :class:`risk_pipeline.sources.base.Source` for a
distinct upstream: L2Beat chain risk, Discourse governance forums, and the
DefiLlama market-maker leaderboard. Adding a fourth means adding a file and a
registry row; nothing in ``base.py`` changes.
"""

from __future__ import annotations

from .base import Source, SourceOutcome

__all__ = ["Source", "SourceOutcome"]
