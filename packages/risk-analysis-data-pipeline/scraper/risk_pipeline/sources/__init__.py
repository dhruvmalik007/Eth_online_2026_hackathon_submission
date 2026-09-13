"""Source adapters — one per upstream family.

Each module here implements :class:`risk_pipeline.sources.base.Source` for a
distinct upstream: L2Beat chain risk, Discourse governance forums, the DefiLlama
market-maker leaderboard, and the DefiLlama security-incident feed. Adding
another means adding a file and a registry row; nothing in ``base.py`` changes.

``defillama_detail`` is the exception to that shape: the per-maker detail lives
behind a DOM interaction rather than a URL, so it implements :class:`ModalSource`
instead. Both families delegate their containment to the same helper, so
"a broken upstream is recorded, not raised" is written once.
"""

from __future__ import annotations

from .base import Source, SourceOutcome

__all__ = ["Source", "SourceOutcome"]
