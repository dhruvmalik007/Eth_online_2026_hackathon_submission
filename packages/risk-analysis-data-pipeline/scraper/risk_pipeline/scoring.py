"""Deterministic risk scoring — the documented formulas behind every score.

Each score is a pure function of classified dimensions. Nothing here consults a
model, a network, or the wall clock, so the same snapshot always yields the same
numbers and every figure is reproducible from the published `raw` text.

The rubric is written down rather than implied, because a score whose derivation
is undiscoverable is indistinguishable from an opinion. Every weight and every
mapping below is a stated choice, and :func:`composite_chain_score` notes why the
weights are shaped the way they are.

Scoring convention: **0-1, higher is safer.** A consumer combining these with a
risk premium subtracts them from 1; keeping a single direction across every
score avoids the sign errors that come from mixing "risk" and "safety".
"""

from __future__ import annotations

import statistics

from .models import ChainDimensions, ChainRiskScores, GovernanceScores, Proposal

__all__ = [
    "COMPOSITE_WEIGHTS",
    "score_chain",
    "score_data_availability",
    "score_exit_window",
    "score_governance",
    "score_proposer_failure",
    "score_sequencer_failure",
    "score_state_validation",
]

#: Relative weight of each dimension in the composite chain score.
#:
#: State validation dominates because it is the property that makes a rollup a
#: rollup: if state transitions are not soundly validated, no other dimension
#: rescues the chain. Data availability is next, since unavailable data means a
#: user cannot reconstruct their own position even with valid state. Exit,
#: sequencer and proposer failure follow, and are weighted lower because they
#: describe degraded-but-survivable modes rather than existential ones.
COMPOSITE_WEIGHTS: dict[str, float] = {
    "stateValidation": 0.30,
    "dataAvailability": 0.25,
    "exit": 0.20,
    "sequencer": 0.15,
    "proposer": 0.10,
}

_STATE_VALIDATION_SCORES: dict[str, float] = {
    "validity-proofs": 1.00,  # cryptographic; no challenge window can be missed
    "fraud-proofs": 0.70,  # sound, but only if someone actually challenges in time
    "optimistic": 0.50,  # trust that actors behave, with weak recourse
    "none": 0.00,  # no validation at all
    "other": 0.30,  # unrecognized: neutral-pessimistic, never neutral-optimistic
}

_DATA_AVAILABILITY_SCORES: dict[str, float] = {
    "onchain": 1.00,  # data on Ethereum; reconstructable unconditionally
    "onchain-sd": 0.90,  # on-chain via state diffs; reconstructable with more work
    "self-custodied": 0.60,  # user-held, so not reliant on an operator
    "external": 0.30,  # a third party must cooperate to reconstruct
    "other": 0.30,
}

_EXIT_WINDOW_SCORES: dict[str, float] = {
    "infinite": 1.00,  # permissionless exit, always available
    "regular": 0.80,  # bounded but routine
    "not-applicable": 0.50,  # no funds at risk of being trapped
    "emergency-only": 0.40,  # exit requires an operator to act
    "none": 0.10,  # no permissionless path out
    "other": 0.30,
}

_SEQUENCER_FAILURE_SCORES: dict[str, float] = {
    "force-via-l1": 1.00,  # anyone can force inclusion; censorship-resistant
    "enqueue-via-l1": 0.85,
    "self-sequence": 0.80,  # the chain keeps producing without the sequencer
    "decentralized-set": 0.75,  # no single sequencer to pressure
    "log-via-l1": 0.60,  # inclusion via L1 logging, weaker guarantee
    "other": 0.30,
    "no-mechanism": 0.10,  # sequencer stops, chain stops
}

_PROPOSER_FAILURE_SCORES: dict[str, float] = {
    "self-propose": 1.00,  # anyone can propose
    "replace-proposer": 0.70,
    "use-escape-hatch": 0.60,
    "security-council": 0.50,  # a council acts; better than nothing, not neutral
    "other": 0.30,
    "cannot-withdraw": 0.10,  # funds can be stranded outright
}

#: Governance terms that indicate a proposal touches risk parameters. A
#: governance profile where these dominate is one whose activity actually bears
#: on the risk inputs this package feeds, rather than on grants or marketing.
_RISK_TERMS: tuple[str, ...] = (
    "collateral",
    "liquidation",
    "ltv",
    "loan-to-value",
    "risk",
    "supply cap",
    "borrow cap",
    "debt ceiling",
    "interest rate",
    "irm",
    "oracle",
    "e-mode",
    "isolation mode",
    "parameter",
    "reserve factor",
)


def _lookup(table: dict[str, float], category: str) -> float:
    """Read a category's score, falling back to the neutral-pessimistic value.

    Args:
        table: The category-to-score mapping for one dimension.
        category: The classified category.

    Returns:
        The mapped score, or the table's ``other`` value when the category is
        unrecognized. Falling back rather than raising keeps a new upstream
        category from breaking a sweep, while the retained `raw` text still makes
        the novel input visible for follow-up.

    """
    return table.get(category, table.get("other", 0.30))


def score_state_validation(category: str) -> float:
    """Score a state-validation category.

    Args:
        category: A value from :func:`classify.classify_state_validation`.

    Returns:
        A safety score in 0-1.

    Examples:
        >>> score_state_validation("validity-proofs")
        1.0
        >>> score_state_validation("none")
        0.0

    """
    return _lookup(_STATE_VALIDATION_SCORES, category)


def score_data_availability(category: str) -> float:
    """Score a data-availability category.

    Args:
        category: A value from :func:`classify.classify_data_availability`.

    Returns:
        A safety score in 0-1.

    """
    return _lookup(_DATA_AVAILABILITY_SCORES, category)


def score_exit_window(category: str) -> float:
    """Score an exit-window category.

    Args:
        category: A value from :func:`classify.classify_exit_window`.

    Returns:
        A safety score in 0-1.

    """
    return _lookup(_EXIT_WINDOW_SCORES, category)


def score_sequencer_failure(category: str) -> float:
    """Score a sequencer-failure category.

    Args:
        category: A value from :func:`classify.classify_sequencer_failure`.

    Returns:
        A safety score in 0-1.

    """
    return _lookup(_SEQUENCER_FAILURE_SCORES, category)


def score_proposer_failure(category: str) -> float:
    """Score a proposer-failure category.

    Args:
        category: A value from :func:`classify.classify_proposer_failure`.

    Returns:
        A safety score in 0-1.

    """
    return _lookup(_PROPOSER_FAILURE_SCORES, category)


def composite_chain_score(scores: dict[str, float]) -> float:
    """Weight the five dimension scores into one composite.

    Args:
        scores: Per-dimension scores keyed by :data:`COMPOSITE_WEIGHTS` keys.

    Returns:
        The weighted mean in 0-1. Because the weights sum to 1.0 this is a convex
        combination, so the composite can never fall outside the range of its
        inputs — a property worth having, since a composite that exceeded its
        worst input would be indefensible.

    Examples:
        >>> composite_chain_score({
        ...     "stateValidation": 1.0, "dataAvailability": 1.0,
        ...     "exit": 1.0, "sequencer": 1.0, "proposer": 1.0,
        ... })
        1.0

    """
    return sum(scores[key] * weight for key, weight in COMPOSITE_WEIGHTS.items())


def score_chain(dimensions: ChainDimensions) -> ChainRiskScores:
    """Score every dimension of a chain and its weighted composite.

    Args:
        dimensions: The classified L2Beat dimensions.

    Returns:
        The per-dimension safety scores plus the composite.

    """
    state_validation = score_state_validation(dimensions.state_validation.category)
    data_availability = score_data_availability(dimensions.data_availability.category)
    exit_score = score_exit_window(dimensions.exit_window.category)
    sequencer = score_sequencer_failure(dimensions.sequencer_failure.category)
    proposer = score_proposer_failure(dimensions.proposer_failure.category)

    return ChainRiskScores(
        state_validation=state_validation,
        data_availability=data_availability,
        exit=exit_score,
        sequencer=sequencer,
        proposer=proposer,
        composite=composite_chain_score(
            {
                "stateValidation": state_validation,
                "dataAvailability": data_availability,
                "exit": exit_score,
                "sequencer": sequencer,
                "proposer": proposer,
            }
        ),
    )


def _normalize(value: float, ceiling: float) -> float:
    """Scale a raw count onto 0-1, saturating at the ceiling.

    Args:
        value: The observed count.
        ceiling: The count considered "fully saturated".

    Returns:
        ``min(value / ceiling, 1.0)``, or 0.0 when ``ceiling`` is non-positive.

    """
    if ceiling <= 0:
        return 0.0
    return min(value / ceiling, 1.0)


def score_governance(proposals: list[Proposal]) -> GovernanceScores:
    """Derive governance activity, participation and risk-activity scores.

    Three independent signals, each saturating at a documented ceiling:

    * **activity** — number of proposals, saturating at 20. A forum with 20+
      proposals in the fetched window is as active as the signal can usefully say;
      beyond that the count reflects history length, not liveness.
    * **participation** — median replies per proposal, saturating at 25. The
      median rather than the mean because a single 130-post controversy (Aave's
      "Aave Will Win Framework" is one) would otherwise dominate the score.
    * **riskActivity** — share of proposals whose title mentions a risk
      parameter. This is the one that matters most here: governance that never
      touches collateral or rate parameters tells us little about protocol risk.

    Args:
        proposals: The normalized proposal set for one protocol.

    Returns:
        The three component scores plus their equal-weight composite. Equal
        weighting is deliberate: none of the three is obviously more important,
        and a documented tie is more defensible than a made-up weighting.

    """
    if not proposals:
        return GovernanceScores(
            activity=0.0,
            participation=0.0,
            risk_activity=0.0,
            composite=0.0,
        )

    activity = _normalize(float(len(proposals)), 20.0)

    replies = [float(p.reply_count) for p in proposals]
    participation = _normalize(statistics.median(replies), 25.0)

    risk_hits = sum(1 for p in proposals if any(term in p.title.lower() for term in _RISK_TERMS))
    risk_activity = risk_hits / len(proposals)

    composite = (activity + participation + risk_activity) / 3.0

    return GovernanceScores(
        activity=activity,
        participation=participation,
        risk_activity=risk_activity,
        composite=composite,
    )
