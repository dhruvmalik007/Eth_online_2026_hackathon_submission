"""Golden tests for the deterministic scoring rubric.

Values are hand-computed from the documented weights in
:mod:`risk_pipeline.scoring`, so a change to a weight or a category mapping
fails here with an arithmetic difference rather than silently shifting every
chain's composite.
"""

from __future__ import annotations

import pytest

from risk_pipeline.models import (
    ChainDimensions,
    DataAvailabilityDimension,
    ExitWindowDimension,
    Proposal,
    ProposalStage,
    ProposalStatus,
    ProposerFailureDimension,
    SequencerFailureDimension,
    StateValidationDimension,
)
from risk_pipeline.scoring import (
    COMPOSITE_WEIGHTS,
    composite_chain_score,
    score_chain,
    score_data_availability,
    score_exit_window,
    score_governance,
    score_proposer_failure,
    score_sequencer_failure,
    score_state_validation,
)


def _dimensions(
    *,
    state_validation: str = "fraud-proofs",
    data_availability: str = "onchain",
    exit_window: str = "none",
    sequencer: str = "self-sequence",
    proposer: str = "self-propose",
) -> ChainDimensions:
    """Build a dimension set from categories, for scoring tests.

    Args:
        state_validation: Category for the state-validation dimension.
        data_availability: Category for the data-availability dimension.
        exit_window: Category for the exit-window dimension.
        sequencer: Category for the sequencer-failure dimension.
        proposer: Category for the proposer-failure dimension.

    Returns:
        A dimensions object carrying the given categories.
    """
    return ChainDimensions(
        state_validation=StateValidationDimension(
            raw="raw", category=state_validation, challenge_period_days=None
        ),
        data_availability=DataAvailabilityDimension(raw="raw", category=data_availability),
        exit_window=ExitWindowDimension(raw="raw", category=exit_window, days=None),
        sequencer_failure=SequencerFailureDimension(
            raw="raw", category=sequencer, delay_hours=None
        ),
        proposer_failure=ProposerFailureDimension(raw="raw", category=proposer),
    )


def _proposal(reply_count: int, title: str) -> Proposal:
    """Build a proposal with a given reply count and title.

    Args:
        reply_count: Replies on the thread.
        title: The topic title, used for risk-term matching.

    Returns:
        A proposal instance.
    """
    return Proposal(
        id=1,
        title=title,
        slug="slug",
        stage=ProposalStage.OTHER,
        status=ProposalStatus.OPEN,
        created_at="2026-01-01T00:00:00Z",
        last_posted_at="2026-01-01T00:00:00Z",
        posts_count=1,
        reply_count=reply_count,
        views=1,
        like_count=1,
        url="https://example.test/t/slug/1",
        excerpt=None,
    )


class TestWeights:
    """The composite weights themselves."""

    def test_weights_sum_to_one(self) -> None:
        # A convex combination is what guarantees the composite cannot fall
        # outside its inputs' range. If the weights stop summing to 1.0 that
        # property silently disappears.
        assert sum(COMPOSITE_WEIGHTS.values()) == pytest.approx(1.0)

    def test_state_validation_carries_the_most_weight(self) -> None:
        heaviest = max(COMPOSITE_WEIGHTS, key=lambda k: COMPOSITE_WEIGHTS[k])
        assert heaviest == "stateValidation"


class TestDimensionScores:
    """Category-to-score mappings."""

    @pytest.mark.parametrize(
        ("category", "expected"),
        [
            ("validity-proofs", 1.00),
            ("fraud-proofs", 0.70),
            ("optimistic", 0.50),
            ("none", 0.00),
            ("other", 0.30),
        ],
    )
    def test_state_validation_scores(self, category: str, expected: float) -> None:
        assert score_state_validation(category) == expected

    @pytest.mark.parametrize(
        ("category", "expected"),
        [("onchain", 1.00), ("onchain-sd", 0.90), ("self-custodied", 0.60), ("external", 0.30)],
    )
    def test_data_availability_scores(self, category: str, expected: float) -> None:
        assert score_data_availability(category) == expected

    @pytest.mark.parametrize(
        ("category", "expected"),
        [("infinite", 1.00), ("regular", 0.80), ("emergency-only", 0.40), ("none", 0.10)],
    )
    def test_exit_window_scores(self, category: str, expected: float) -> None:
        assert score_exit_window(category) == expected

    @pytest.mark.parametrize(
        ("category", "expected"),
        [("force-via-l1", 1.00), ("self-sequence", 0.80), ("no-mechanism", 0.10)],
    )
    def test_sequencer_scores(self, category: str, expected: float) -> None:
        assert score_sequencer_failure(category) == expected

    @pytest.mark.parametrize(
        ("category", "expected"),
        [("self-propose", 1.00), ("security-council", 0.50), ("cannot-withdraw", 0.10)],
    )
    def test_proposer_scores(self, category: str, expected: float) -> None:
        assert score_proposer_failure(category) == expected

    def test_unknown_category_falls_back_to_other(self) -> None:
        # A novel upstream category must not crash a sweep; the retained `raw`
        # text makes it visible for follow-up instead.
        assert score_state_validation("brand-new-category") == 0.30


class TestComposite:
    """The weighted composite against hand-computed values."""

    def test_all_perfect_scores_give_one(self) -> None:
        assert composite_chain_score(
            {
                "stateValidation": 1.0,
                "dataAvailability": 1.0,
                "exit": 1.0,
                "sequencer": 1.0,
                "proposer": 1.0,
            }
        ) == pytest.approx(1.0)

    def test_all_zero_scores_give_zero(self) -> None:
        assert (
            composite_chain_score(
                {
                    "stateValidation": 0.0,
                    "dataAvailability": 0.0,
                    "exit": 0.0,
                    "sequencer": 0.0,
                    "proposer": 0.0,
                }
            )
            == 0.0
        )

    def test_base_chain_golden_value(self) -> None:
        # Hand-computed from the real Base fixture categories:
        #   0.30(0.70) + 0.25(1.00) + 0.20(0.10) + 0.15(0.80) + 0.10(1.00)
        # = 0.210 + 0.250 + 0.020 + 0.120 + 0.100 = 0.700
        scored = score_chain(_dimensions())
        assert scored.state_validation == 0.70
        assert scored.data_availability == 1.00
        assert scored.exit == 0.10
        assert scored.sequencer == 0.80
        assert scored.proposer == 1.00
        assert scored.composite == pytest.approx(0.70)

    def test_composite_stays_within_its_inputs_range(self) -> None:
        # The convexity property: a composite can never be safer than its safest
        # dimension or less safe than its least safe one.
        scored = score_chain(
            _dimensions(state_validation="validity-proofs", exit_window="infinite")
        )
        inputs = [
            scored.state_validation,
            scored.data_availability,
            scored.exit,
            scored.sequencer,
            scored.proposer,
        ]
        assert min(inputs) <= scored.composite <= max(inputs)


class TestGovernanceScoring:
    """Governance activity, participation and risk-activity."""

    def test_empty_proposal_set_scores_zero(self) -> None:
        scored = score_governance([])
        assert scored.activity == 0.0
        assert scored.participation == 0.0
        assert scored.risk_activity == 0.0
        assert scored.composite == 0.0

    def test_activity_saturates_at_twenty_proposals(self) -> None:
        scored = score_governance([_proposal(0, f"Topic {i}") for i in range(20)])
        assert scored.activity == 1.0

    def test_activity_is_proportional_below_the_ceiling(self) -> None:
        scored = score_governance([_proposal(0, f"Topic {i}") for i in range(10)])
        assert scored.activity == pytest.approx(0.5)

    def test_participation_uses_the_median_not_the_mean(self) -> None:
        # One runaway thread must not dominate. With replies [0, 0, 1, 1, 100]
        # the median is 1 and the mean would be 20.4 — the median keeps the score
        # about typical deliberation.
        replies = [0, 0, 1, 1, 100]
        scored = score_governance([_proposal(r, f"Topic {i}") for i, r in enumerate(replies)])
        assert scored.participation == pytest.approx(1.0 / 25.0)

    def test_risk_activity_counts_risk_terms(self) -> None:
        proposals = [
            _proposal(0, "Adjust collateral factor for USDC"),
            _proposal(0, "Set borrow cap to 10M"),
            _proposal(0, "Marketing budget for Q3"),
            _proposal(0, "Rebrand the website"),
        ]
        scored = score_governance(proposals)
        assert scored.risk_activity == pytest.approx(0.5)

    def test_composite_is_the_equal_weight_mean(self) -> None:
        proposals = [_proposal(0, f"Topic {i}") for i in range(10)]
        scored = score_governance(proposals)
        expected = (scored.activity + scored.participation + scored.risk_activity) / 3.0
        assert scored.composite == pytest.approx(expected)
