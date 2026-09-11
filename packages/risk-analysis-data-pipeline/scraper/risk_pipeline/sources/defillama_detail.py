"""Market-maker detail collection — the per-maker "Details" drawer.

Where :class:`~risk_pipeline.sources.defillama_mm.MarketMakerSource` reads the
leaderboard table, this reads the drawer behind each row, which is where the
order-book substance lives: depth and volume broken out by band, spread, per-band
KPI adherence, and the venues the maker supports.

Two structural facts shape the design:

* **The detail has no URL.** It is a drawer opened by clicking a row's control,
  so this source depends on the :class:`DetailReader` port (a transport that can
  fetch *and* drive the DOM) and extends :class:`ModalSource` rather than
  :class:`Source`.
* **The drawer does not name its row.** The modal opens over the page, so the
  maker's identity comes from the tab's own row order, read first and used to
  label each drawer. Row index is authoritative; inferring identity from the
  drawer's prose would be fragile.

One click per maker yields all four KPI families at once, so the cost is one
drawer per maker rather than one per metric.
"""

from __future__ import annotations

from datetime import UTC, datetime

from ..browser import DetailReader
from ..detail import parse_market_maker_detail
from ..errors import RiskPipelineError, SourceError
from ..models import MarketMakerDetail
from ..parse import nonempty_lines
from .base import Collected, ModalSource
from .defillama_mm import parse_leaderboard_table
from .discourse import slugify

__all__ = ["DETAIL_TAB", "MarketMakerDetailSource"]

#: The tab whose rows carry the details control and list every maker.
DETAIL_TAB = "https://defillama.com/market-makers/depth"

#: Marker the collector looks for in a drawn drawer. Its presence confirms the
#: click opened a real drawer rather than landing on a row that has none.
_DRAWER_MARKER = "Depth KPIs, Detailed Breakdown"


class MarketMakerDetailSource(ModalSource[MarketMakerDetail]):
    """Collects the per-maker detail drawer for every maker on the leaderboard.

    Args:
        limit: Optional cap on how many makers to open, for a bounded smoke run.
            ``None`` collects every row.

    """

    source_id = "market-maker-detail"

    def __init__(self, limit: int | None = None) -> None:
        self._limit = limit

    @property
    def limit(self) -> int | None:
        """The configured cap, if any.

        Returns:
            The maximum number of makers to open, or ``None`` for all of them.

        """
        return self._limit

    def collect_records(self, reader: DetailReader) -> Collected[MarketMakerDetail]:
        """Open each maker's drawer and parse it.

        Args:
            reader: The transport that can fetch and drive drawers.

        Returns:
            The detail cards plus the tab URL they were read from.

        Raises:
            SourceError: When the tab cannot be read, or a drawer opens without
                the expected breakdown section — which means the click missed.

        """
        order = self._maker_order(reader)
        if not order:
            raise SourceError(
                self.source_id,
                f"no market maker rows found on {DETAIL_TAB}; cannot attribute drawers",
            )

        targets = order if self._limit is None else order[: self._limit]
        fetched_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")

        records: list[MarketMakerDetail] = []
        for row_index, (_rank, name, slug) in enumerate(targets):
            text = reader.read_detail_modal(DETAIL_TAB, row_index, source_id=self.source_id)
            if _DRAWER_MARKER not in text:
                raise SourceError(
                    self.source_id,
                    f"drawer for row {row_index} ({name}) carried no KPI breakdown; "
                    "the click likely missed its target",
                )
            try:
                records.append(
                    parse_market_maker_detail(
                        text,
                        slug=slug,
                        name=name,
                        source_url=DETAIL_TAB,
                        fetched_at=fetched_at,
                    )
                )
            except RiskPipelineError:
                # One malformed drawer must not cost every other maker's detail.
                continue

        return records, DETAIL_TAB

    def _maker_order(self, reader: DetailReader) -> list[tuple[int, str, str]]:
        """Read the ranked maker list from the tab.

        The tab's rows are the authority on identity and order: the drawer carries
        no row reference, so the index used to click is also the index used to
        label. Reading the order once, up front, keeps the two in step.

        Args:
            reader: The transport that can fetch and drive drawers.

        Returns:
            Tuples of ``(rank, name, slug)`` in rank order.

        """
        page = reader.fetch(DETAIL_TAB, source_id=self.source_id)
        rows = parse_leaderboard_table(nonempty_lines(page.text), self.source_id)
        return [(rank, name, slugify(name)) for rank, name, _, _, _ in rows]
