"""Golden tests for the deterministic classifiers.

Each case uses text copied from a real captured payload, so a classifier change
that breaks on genuine upstream phrasing fails here rather than in production.
"""

from __future__ import annotations

import pytest

from risk_pipeline.classify import (
    classify_data_availability,
    classify_exit_window,
    classify_proposal_stage,
    classify_proposer_failure,
    classify_sequencer_failure,
    classify_state_validation,
    parse_duration_days,
    parse_duration_hours,
)
from risk_pipeline.models import ProposalStage


class TestProposalStage:
    """The title-prefix classifier."""

    @pytest.mark.parametrize(
        ("title", "expected"),
        [
            ("[ARFC] Activate Aave Risk Stewards on Aave V4", ProposalStage.ARFC),
            ("[RFC] Rotate Sentinel Addresses on the DUNI-Owned Vaults", ProposalStage.RFC),
            ("[TEMP CHECK] Aave Will Win Framework", ProposalStage.TEMP_CHECK),
            ("[Temp Check] Activate v4 Protocol Fees", ProposalStage.TEMP_CHECK),
            ("[Direct-to-AIP] August 2026 - Funding Update", ProposalStage.AIP),
            ("[AIP] Safety Module Allowance Update", ProposalStage.AIP),
            ("[Discussion] Privacy-Preserving MiCA Compliance", ProposalStage.DISCUSSION),
            ("Random discussion thread", ProposalStage.OTHER),
            ("", ProposalStage.OTHER),
        ],
    )
    def test_classifies_observed_prefixes(self, title: str, expected: ProposalStage) -> None:
        assert classify_proposal_stage(title) == expected

    def test_direct_to_aip_is_not_misread_as_aip_only(self) -> None:
        # Ordering matters: "direct-to-aip" contains "aip", and the AIP branch
        # would also match. Both map to AIP, but the specific form must win so a
        # future refinement can distinguish them.
        assert classify_proposal_stage("[Direct-to-AIP] Something") == ProposalStage.AIP

    def test_is_case_insensitive(self) -> None:
        assert classify_proposal_stage("[arfc] lowercase") == ProposalStage.ARFC

    def test_accepts_a_bare_prefix_with_a_separator(self) -> None:
        # Not every forum brackets its labels.
        assert classify_proposal_stage("RFC: Deploy to a new chain") == ProposalStage.RFC
        assert classify_proposal_stage("AIP - Funding update") == ProposalStage.AIP

    def test_does_not_match_a_stage_word_merely_present_in_the_title(self) -> None:
        # The stage is declared by the *prefix*, not by the presence of a word.
        # An unanchored search would call these discussion-stage proposals.
        assert classify_proposal_stage("Some discussion about yields") == ProposalStage.OTHER
        assert classify_proposal_stage("AIP summary posted last week") == ProposalStage.OTHER

    def test_unknown_bracket_label_is_other(self) -> None:
        # Observed in the real Aave payload: "[Risk Stewards] August 2026 ...".
        # It is a real label but not a lifecycle stage, so it stays `other`
        # rather than being forced into a nearby category.
        assert (
            classify_proposal_stage("[Risk Stewards] August 2026 - Rate Adjustments")
            == ProposalStage.OTHER
        )


class TestChainDimensionClassifiers:
    """The L2Beat dimension classifiers, against verbatim cell text."""

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Fraud proofs (1R, ZK)", "fraud-proofs"),
            ("Fraud proofs (INT)", "fraud-proofs"),
            ("Validity proofs (ST, SN)", "validity-proofs"),
            ("None", "none"),
            ("Something novel", "other"),
        ],
    )
    def test_state_validation(self, raw: str, expected: str) -> None:
        assert classify_state_validation(raw) == expected

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Onchain", "onchain"),
            ("Onchain (SD)", "onchain-sd"),
            ("Self custodied", "self-custodied"),
            ("External", "external"),
            ("?", "other"),
        ],
    )
    def test_data_availability(self, raw: str, expected: str) -> None:
        assert classify_data_availability(raw) == expected

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("None", "none"),
            ("∞", "infinite"),
            ("Emergency: None", "emergency-only"),
            ("Regular: 10d", "regular"),
            ("Not applicable", "not-applicable"),
        ],
    )
    def test_exit_window(self, raw: str, expected: str) -> None:
        assert classify_exit_window(raw) == expected

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Self sequence", "self-sequence"),
            ("Force via L1", "force-via-l1"),
            ("Enqueue via L1", "enqueue-via-l1"),
            ("Log via L1", "log-via-l1"),
            ("Decentralized Sequencer Set", "decentralized-set"),
            ("No mechanism", "no-mechanism"),
        ],
    )
    def test_sequencer_failure(self, raw: str, expected: str) -> None:
        assert classify_sequencer_failure(raw) == expected

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Self propose", "self-propose"),
            ("Cannot withdraw", "cannot-withdraw"),
            ("Use escape hatch", "use-escape-hatch"),
            ("Replace proposer", "replace-proposer"),
            ("Security Council minority", "security-council"),
        ],
    )
    def test_proposer_failure(self, raw: str, expected: str) -> None:
        assert classify_proposer_failure(raw) == expected


class TestDurationParsing:
    """Duration extraction from the phrasings L2Beat actually uses."""

    def test_reads_days_from_a_challenge_period(self) -> None:
        assert parse_duration_days("Fraud proofs (INT) 6d 8h challenge period") == 6.0

    def test_reads_hours_from_a_sequencer_delay(self) -> None:
        # The fixture's verbatim prose, which carries the delay in the body text
        # rather than the cell.
        assert parse_duration_hours("Self sequence 12h delay") == 12.0

    def test_returns_none_when_no_duration_is_stated(self) -> None:
        # None must mean "not stated", never "zero": the two are different facts.
        assert parse_duration_days("None") is None
        assert parse_duration_hours("Self propose") is None

    def test_converts_hours_to_days(self) -> None:
        assert parse_duration_days("12h delay") == 0.5

    def test_converts_minutes_to_hours(self) -> None:
        assert parse_duration_hours("30min delay") == 0.5
