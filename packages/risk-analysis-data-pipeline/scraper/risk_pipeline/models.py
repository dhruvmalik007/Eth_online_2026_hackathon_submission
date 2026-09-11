"""Pydantic mirror of the TypeScript snapshot contract (``src/types.ts``).

This is the Python half of the seam. Field names are snake_case internally —
idiomatic Python — and serialize to the camelCase the TypeScript schemas require,
via ``alias_generator=to_camel`` plus ``by_alias=True`` on dump.

**The two definitions must agree.** A fixture-based drift test (T1.2) asserts
that what these models emit validates against the zod schemas, so a field added
on one side and forgotten on the other fails the build rather than silently
dropping data at the boundary.

Retained-raw rule: every classification keeps the source text it was derived
from (``raw``), so a classifier change can always be audited against what the
site actually said.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

__all__ = [
    "ChainDimensionScores",
    "ChainDimensions",
    "ChainRiskProfile",
    "ChainRiskScores",
    "ChainStage",
    "DataAvailabilityDimension",
    "ExitWindowDimension",
    "GovernanceScores",
    "GovernanceSource",
    "Manifest",
    "ManifestSource",
    "ManifestTemporal",
    "MarketMakerDetail",
    "MarketMakerDetailBreakdowns",
    "MarketMakerDetailScores",
    "MarketMakerGrade",
    "MarketMakerLeader",
    "MarketMakerMetricRow",
    "MarketMakerMetrics",
    "MarketMakerProfile",
    "MarketMakerStanding",
    "MarketMakerStandings",
    "MarketMakerSubScores",
    "MarketMakerSummary",
    "Proposal",
    "ProposalStage",
    "ProposalStatus",
    "ProposerFailureDimension",
    "ProtocolGovernanceProfile",
    "Provenance",
    "SequencerFailureDimension",
    "SourceState",
    "StateValidationDimension",
]


class _Contract(BaseModel):
    """Base for every contract model: camelCase on the wire, strict otherwise.

    ``extra="forbid"`` is deliberate. A field the parser produces but the
    contract does not declare is a bug in exactly one of the two places, and
    silently dropping it would hide that until a consumer went looking for a
    number that never arrived.
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        frozen=True,
    )


# ── Shared primitives ────────────────────────────────────────────────────────


class SourceState(StrEnum):
    """Lifecycle state of a source, or of a record produced from one."""

    FRESH = "fresh"
    STALE = "stale"
    DEGRADED = "degraded"
    FAILED = "failed"
    SKIPPED = "skipped"


class Provenance(_Contract):
    """Where a record came from, and whether it can be trusted as current."""

    source: str
    source_url: str
    fetched_at: str
    state: SourceState


# ── Chain risk (L2Beat) ──────────────────────────────────────────────────────


class ChainStage(StrEnum):
    """L2Beat's Stages framework rating."""

    STAGE_0 = "stage-0"
    STAGE_1 = "stage-1"
    STAGE_2 = "stage-2"
    NOT_APPLICABLE = "not-applicable"


class StateValidationDimension(_Contract):
    """How state commitments are validated, and the challenge window."""

    raw: str
    category: str
    challenge_period_days: float | None = None


class DataAvailabilityDimension(_Contract):
    """Where transaction data lives."""

    raw: str
    category: str


class ExitWindowDimension(_Contract):
    """How long a user must wait to withdraw without permission."""

    raw: str
    category: str
    days: float | None = None


class SequencerFailureDimension(_Contract):
    """What a user can do if the sequencer stops cooperating."""

    raw: str
    category: str
    delay_hours: float | None = None


class ProposerFailureDimension(_Contract):
    """What happens when the proposer fails."""

    raw: str
    category: str


class ChainDimensions(_Contract):
    """The five L2Beat risk dimensions, in their published order."""

    state_validation: StateValidationDimension
    data_availability: DataAvailabilityDimension
    exit_window: ExitWindowDimension
    sequencer_failure: SequencerFailureDimension
    proposer_failure: ProposerFailureDimension


class ChainRiskScores(_Contract):
    """Per-dimension and composite safety scores, 0-1 with 1 safest."""

    state_validation: float = Field(ge=0.0, le=1.0)
    data_availability: float = Field(ge=0.0, le=1.0)
    exit: float = Field(ge=0.0, le=1.0)
    sequencer: float = Field(ge=0.0, le=1.0)
    proposer: float = Field(ge=0.0, le=1.0)
    composite: float = Field(ge=0.0, le=1.0)


class ChainRiskProfile(_Contract):
    """A chain's macro risk profile, published to ``risk/chains/{slug}.json``."""

    schema_version: str
    slug: str
    name: str
    # Explicit serialization alias: pydantic's `to_camel` capitalizes the letter
    # after a digit, producing `l2BeatUrl`, whereas the TypeScript contract
    # specifies `l2beatUrl`. Without this the emitted JSON would fail zod
    # validation on every chain. Only the serialization alias is set (not
    # `alias`), so the constructor stays idiomatic snake_case while the wire
    # format matches the contract. Caught by the drift test, not in production.
    l2beat_url: str = Field(serialization_alias="l2beatUrl")
    stage: ChainStage
    dimensions: ChainDimensions
    value_secured_usd: float | None = None
    risk_scores: ChainRiskScores
    provenance: Provenance


# Alias kept for readability in call sites that only need dimension scores.
ChainDimensionScores = ChainRiskScores


# ── Protocol governance (Discourse) ──────────────────────────────────────────


class ProposalStage(StrEnum):
    """Governance lifecycle stage, classified from the topic title prefix."""

    RFC = "rfc"
    TEMP_CHECK = "temp-check"
    ARFC = "arfc"
    AIP = "aip"
    DISCUSSION = "discussion"
    OTHER = "other"


class ProposalStatus(StrEnum):
    """Whether a proposal thread is still live."""

    OPEN = "open"
    CLOSED = "closed"
    ARCHIVED = "archived"


class Proposal(_Contract):
    """One governance topic, normalized from the Discourse payload."""

    # `id` and `url` are spelled out because pydantic-protected names need care,
    # not because they differ from camelCase.
    id: int
    title: str
    slug: str
    stage: ProposalStage
    status: ProposalStatus
    created_at: str
    last_posted_at: str
    posts_count: int = Field(ge=0)
    reply_count: int = Field(ge=0)
    views: int = Field(ge=0)
    like_count: int = Field(ge=0)
    url: str
    excerpt: str | None = None


class GovernanceSource(_Contract):
    """Where a protocol's governance lives."""

    forum_url: str
    platform: str
    json_api: str | None = None
    reachable: bool


class GovernanceScores(_Contract):
    """Participation and activity scores derived from the proposal set."""

    activity: float = Field(ge=0.0, le=1.0)
    participation: float = Field(ge=0.0, le=1.0)
    risk_activity: float = Field(ge=0.0, le=1.0)
    composite: float = Field(ge=0.0, le=1.0)


class ProtocolGovernanceProfile(_Contract):
    """A protocol's governance profile, published to ``risk/protocols/{slug}.json``."""

    schema_version: str
    slug: str
    name: str
    category: str
    governance: GovernanceSource
    proposals: list[Proposal]
    governance_scores: GovernanceScores
    provenance: Provenance


# ── Market makers (DefiLlama / Forgd) ────────────────────────────────────────


class MarketMakerGrade(StrEnum):
    """Forgd's letter grade, AAA (highest) through CCC (lowest)."""

    AAA = "AAA"
    AA = "AA"
    A = "A"
    BBB = "BBB"
    BB = "BB"
    CCC = "CCC"


class MarketMakerMetricRow(_Contract):
    """One row of a detailed KPI breakdown from the per-maker Details modal.

    The value is carried **both** raw and parsed. The raw string is what the page
    printed — including ``"N/A"``, which several loan-utilization metrics
    legitimately show — and ``value_numeric`` is ``None`` whenever the raw value
    is not a number. Storing only a number would force a choice between inventing
    a zero and dropping the row; both, with an explicit ``None``, is honest.
    """

    metric: str
    value_raw: str
    value_numeric: float | None = None
    percentile: float | None = None
    rank: int | None = None


class MarketMakerDetailBreakdowns(_Contract):
    """The four KPI families the Details modal breaks down."""

    depth: list[MarketMakerMetricRow]
    volume: list[MarketMakerMetricRow]
    spread: list[MarketMakerMetricRow]
    kpi_adherence: list[MarketMakerMetricRow]


class MarketMakerStanding(_Contract):
    """Where a maker placed on one leaderboard.

    The modal reports standings twice — once per metric family (depth, volume,
    spread, KPI adherence) and once aggregated — each as a percentile and a rank,
    accompanied by a prose sentence ("Outperformed 84% of their peers..."). The
    prose is derivable from the percentile, so only the numbers are modelled.
    """

    percentile: float | None = None
    rank: int | None = None


class MarketMakerStandings(_Contract):
    """A maker's placement across every leaderboard the modal reports."""

    aggregated: MarketMakerStanding | None = None
    depth: MarketMakerStanding | None = None
    volume: MarketMakerStanding | None = None
    spread: MarketMakerStanding | None = None
    kpi_adherence: MarketMakerStanding | None = None


class MarketMakerDetailScores(_Contract):
    """The six scores the modal restates, each on a 0-10 scale.

    The modal prints these as strings like ``"9.10/10.00"``; the parser keeps the
    numeric numerator. They duplicate the leaderboard table's values and are
    captured anyway because the modal is the only place that states the scale
    explicitly.
    """

    composite: float | None = None
    trading_kpis: float | None = None
    trust: float | None = None
    coverage_capabilities: float | None = None
    uptime: float | None = None
    integration_level: float | None = None


class MarketMakerDetail(_Contract):
    """A market maker's full detail card — the drill-down behind ``Details``.

    This is the artifact with the order-book substance: per-band depth at 50/100/
    200 bps, maker-versus-taker fill volume, volume-weighted spread, KPI adherence
    per band, and the venues the maker supports.

    ``cex_supported`` / ``dex_supported`` answer "which major venues does this
    maker cover". They exist only here — the summary leaderboard rolls coverage
    into a single score and publishes no venue list.
    """

    schema_version: str
    slug: str
    name: str
    window: str
    description: str | None = None
    integration_label: str | None = None
    scores: MarketMakerDetailScores
    standings: MarketMakerStandings
    active_engagements: int | None = None
    avg_fdv_usd: float | None = None
    breakdowns: MarketMakerDetailBreakdowns
    engagement_options: list[str]
    cex_supported: list[str]
    dex_supported: list[str]
    ancillary_services: list[str]
    provenance: Provenance


class MarketMakerMetrics(_Contract):
    """The 30-day trading metrics the leaderboard publishes.

    These appear only on the three hero cards, not in the full 44-row table, so
    the block is nullable on the profile. There is deliberately no ``tvl_usd``:
    the leaderboard does not publish a per-market-maker TVL figure, and inventing
    one under that name would be worse than omitting it.
    """

    depth_usd: float
    depth_rank: int | None = None
    spread_pct: float
    spread_rank: int | None = None
    volume_usd: float
    volume_rank: int | None = None


class MarketMakerSubScores(_Contract):
    r"""The weighted sub-scores behind the composite.

    ``integration_level`` is nullable because the leaderboard renders that column
    empty for many rows — verified against the captured payload, where a row ends
    ``\\tAA\\t9.40\\t10.00\\t8.50\\t8.75\\t9.30\\t`` with nothing after the final
    tab. ``None`` is the honest value; a zero would be a fabricated figure.
    """

    trading_kpis: float
    trust: float
    coverage_capabilities: float
    uptime: float
    integration_level: float | None = None


class MarketMakerProfile(_Contract):
    """One market maker, published to ``risk/market-makers/{slug}.json``."""

    schema_version: str
    slug: str
    name: str
    rank: int = Field(ge=1)
    grade: MarketMakerGrade
    composite_score: float
    sub_scores: MarketMakerSubScores
    metrics: MarketMakerMetrics | None = None
    active_engagements: int | None = Field(default=None, ge=0)
    fdv_usd: float | None = None
    window: str
    provider: str
    provenance: Provenance


class MarketMakerLeader(_Contract):
    """A named leader in one market-maker metric.

    Public rather than module-private because the market-maker source builds
    these when parsing the summary strip.
    """

    name: str
    value: float


class MarketMakerSummary(_Contract):
    """Headline aggregates across all market makers."""

    schema_version: str
    generated_at: str
    maker_count: int = Field(ge=0)
    top_depth: MarketMakerLeader | None = None
    top_volume: MarketMakerLeader | None = None
    top_spread: MarketMakerLeader | None = None
    top_uptime: MarketMakerLeader | None = None
    provenance: Provenance


# ── Manifest ─────────────────────────────────────────────────────────────────


class ManifestSource(_Contract):
    """Per-source outcome recorded in the manifest."""

    state: SourceState
    fetched_at: str | None = None
    latency_ms: float | None = None
    records: int = Field(ge=0)
    content_hash: str | None = None
    error: str | None = None


class ManifestTemporal(_Contract):
    """Rows written per temporal table during the sweep."""

    chain_risk_history: int = Field(ge=0)
    protocol_governance_history: int = Field(ge=0)
    market_maker_metrics: int = Field(ge=0)
    embeddings: int = Field(ge=0)


class Manifest(_Contract):
    """The run manifest — the artifact an operator reads first."""

    schema_version: str
    generated_at: str
    cadence_hours: float
    sources: dict[str, ManifestSource]
    temporal: ManifestTemporal
    notes: list[str]
