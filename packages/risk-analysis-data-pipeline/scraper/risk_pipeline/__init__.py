"""The risk-analysis data pipeline worker.

A Camoufox-driven ETL that collects macro chain risk (L2Beat), protocol
governance (Discourse) and market-maker liquidity (DefiLlama), derives
deterministic scores, and publishes both a current snapshot (GCS) and temporal
history (TimescaleDB) for TimesFM-3 forecast covariates.

The TypeScript half of this package owns the published contract; ``models.py``
mirrors it and a drift test keeps the two honest.
"""

from __future__ import annotations

__version__ = "0.1.0"

__all__ = ["__version__"]
