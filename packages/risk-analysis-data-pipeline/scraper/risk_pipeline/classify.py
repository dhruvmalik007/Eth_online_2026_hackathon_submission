"""Deterministic classifiers: verbatim source text → typed categories.

Every function here is pure and total. Given the same string it returns the same
category, and an unrecognized input returns ``"other"`` rather than raising or
guessing. That matters for two reasons:

* **Reproducibility.** A classification that depended on a model would make the
  snapshot unreproducible — the same page could score differently on two runs.
* **Testability.** Pure functions over captured real payloads are exactly what
  the golden tests assert, so a site change produces a failing test rather than
  a silently wrong score.

The verbatim input is always retained alongside the category in the snapshot, so
a classifier change can be audited against what the site actually said.
"""

from __future__ import annotations

import re

from .models import ProposalStage

__all__ = [
    "classify_data_availability",
    "classify_exit_window",
    "classify_proposal_stage",
    "classify_proposer_failure",
    "classify_sequencer_failure",
    "classify_state_validation",
    "parse_duration_days",
    "parse_duration_hours",
]


#: A bracketed stage label at the start of a title, e.g. ``[ARFC]`` or
#: ``[TEMP CHECK]``. This is where Discourse forums encode the lifecycle stage,
#: so the match is anchored rather than searching the whole title.
_BRACKET_PREFIX = re.compile(r"^\s*\[(?P<label>[^\]]{1,40})\]")

#: A bare label at the very start followed by a separator, e.g. ``RFC: ...``.
#: Some forums omit the brackets; requiring the separator keeps this from
#: matching a title that merely *contains* the word. The separator class includes
#: the en and em dashes because real titles use them ("Discussion — MiCA"), so
#: RUF001's ambiguity warning is suppressed deliberately, not by accident.
_BARE_PREFIX = re.compile(
    r"^\s*(?P<label>direct[- ]to[- ]aip|temperature check|temp check|arfc|rfc|aip|discussion)"
    r"\s*[:\-–—]",  # noqa: RUF001 - en/em dashes are intended separators
    re.IGNORECASE,
)

#: Label text → the stage it declares, checked most-specific first so that
#: ``direct-to-aip`` is not read as a plain ``aip``.
_LABEL_STAGES: tuple[tuple[str, ProposalStage], ...] = (
    ("direct-to-aip", ProposalStage.AIP),
    ("direct to aip", ProposalStage.AIP),
    ("temperature check", ProposalStage.TEMP_CHECK),
    ("temp check", ProposalStage.TEMP_CHECK),
    ("arfc", ProposalStage.ARFC),
    ("rfc", ProposalStage.RFC),
    ("aip", ProposalStage.AIP),
    ("discussion", ProposalStage.DISCUSSION),
)


def classify_proposal_stage(title: str) -> ProposalStage:
    """Classify a governance topic's lifecycle stage from its title prefix.

    Discourse forums encode the stage in the title — ``[RFC]``, ``[TEMP CHECK]``,
    ``[ARFC]``, ``[AIP]`` — so the match is anchored to the *prefix* rather than
    searching the whole string. That distinction is load-bearing: a title such as
    "Random discussion thread" contains the word "discussion" but declares no
    stage, and an unanchored search would misclassify it as one.

    A bare label followed by a separator (``RFC: ...``) is also accepted, since
    not every forum uses brackets.

    Args:
        title: The raw topic title.

    Returns:
        The classified stage, or :attr:`ProposalStage.OTHER` when no prefix
        declares one. ``other`` is a real answer, not a failure — it means the
        title follows no convention we recognize, and guessing would be worse.

    Examples:
        >>> classify_proposal_stage("[ARFC] Activate Aave Risk Stewards on Aave V4")
        <ProposalStage.ARFC: 'arfc'>
        >>> classify_proposal_stage("Random discussion thread")
        <ProposalStage.OTHER: 'other'>

    """
    bracket = _BRACKET_PREFIX.match(title)
    if bracket is not None:
        return _stage_for_label(bracket.group("label"))

    bare = _BARE_PREFIX.match(title)
    if bare is not None:
        return _stage_for_label(bare.group("label"))

    return ProposalStage.OTHER


def _stage_for_label(label: str) -> ProposalStage:
    """Map a declared stage label to its enum member.

    Args:
        label: The text inside the brackets, or the bare prefix.

    Returns:
        The matching stage, or :attr:`ProposalStage.OTHER` when the label is not
        a stage this classifier knows.

    """
    normalized = label.strip().lower()
    for needle, stage in _LABEL_STAGES:
        if needle in normalized:
            return stage
    return ProposalStage.OTHER


def classify_state_validation(raw: str) -> str:
    """Classify how a chain validates its state commitments.

    Args:
        raw: The L2Beat cell text, e.g. ``"Fraud proofs (1R, ZK)"``.

    Returns:
        One of ``fraud-proofs``, ``validity-proofs``, ``optimistic``, ``none``
        or ``other``.

    Examples:
        >>> classify_state_validation("Fraud proofs (INT)")
        'fraud-proofs'
        >>> classify_state_validation("Validity proofs (ST, SN)")
        'validity-proofs'

    """
    lowered = raw.lower()
    if "validity proof" in lowered or "zk proof" in lowered:
        return "validity-proofs"
    if "fraud proof" in lowered:
        return "fraud-proofs"
    if "optimistic" in lowered:
        return "optimistic"
    if lowered.strip() in {"none", "no mechanism", "not applicable"}:
        return "none"
    return "other"


def classify_data_availability(raw: str) -> str:
    """Classify where a chain keeps transaction data.

    Args:
        raw: The L2Beat cell text, e.g. ``"Onchain (SD)"``.

    Returns:
        One of ``onchain``, ``onchain-sd``, ``external``, ``self-custodied`` or
        ``other``.

    Examples:
        >>> classify_data_availability("Onchain (SD)")
        'onchain-sd'
        >>> classify_data_availability("Self custodied")
        'self-custodied'

    """
    lowered = raw.lower()
    if "self custodied" in lowered or "self-custodied" in lowered:
        return "self-custodied"
    if "onchain" in lowered or "on-chain" in lowered:
        # "(SD)" marks "state diffs" — still on-chain, but a distinct posting
        # mode worth preserving rather than flattening into plain "onchain".
        return "onchain-sd" if "(sd)" in lowered else "onchain"
    if "external" in lowered or "offchain" in lowered or "off-chain" in lowered:
        return "external"
    return "other"


def classify_exit_window(raw: str) -> str:
    """Classify a chain's exit-window posture.

    Args:
        raw: The L2Beat cell text, e.g. ``"Emergency: None / Regular: 10d"``.

    Returns:
        One of ``none``, ``emergency-only``, ``regular``, ``infinite``,
        ``not-applicable`` or ``other``.

    Examples:
        >>> classify_exit_window("Emergency: None")
        'emergency-only'
        >>> classify_exit_window("None")
        'none'

    """
    lowered = raw.lower()
    if "∞" in raw or "infinite" in lowered:
        return "infinite"
    if "not applicable" in lowered:
        return "not-applicable"
    if "emergency" in lowered:
        return "emergency-only"
    if "regular" in lowered:
        return "regular"
    if "none" in lowered:
        return "none"
    return "other"


def classify_sequencer_failure(raw: str) -> str:
    """Classify what a user can do when the sequencer stops cooperating.

    Args:
        raw: The L2Beat cell text, e.g. ``"Force via L1"``.

    Returns:
        One of ``self-sequence``, ``force-via-l1``, ``enqueue-via-l1``,
        ``log-via-l1``, ``decentralized-set``, ``no-mechanism`` or ``other``.

    Examples:
        >>> classify_sequencer_failure("Force via L1")
        'force-via-l1'
        >>> classify_sequencer_failure("Decentralized Sequencer Set")
        'decentralized-set'

    """
    lowered = raw.lower()
    if "decentralized" in lowered:
        return "decentralized-set"
    if "force via l1" in lowered:
        return "force-via-l1"
    if "enqueue via l1" in lowered:
        return "enqueue-via-l1"
    if "log via l1" in lowered:
        return "log-via-l1"
    if "self sequence" in lowered:
        return "self-sequence"
    if "no mechanism" in lowered:
        return "no-mechanism"
    return "other"


def classify_proposer_failure(raw: str) -> str:
    """Classify a chain's proposer-failure recourse.

    Args:
        raw: The L2Beat cell text, e.g. ``"Self propose"``.

    Returns:
        One of ``self-propose``, ``cannot-withdraw``, ``use-escape-hatch``,
        ``replace-proposer``, ``security-council`` or ``other``.

    Examples:
        >>> classify_proposer_failure("Self propose")
        'self-propose'
        >>> classify_proposer_failure("Cannot withdraw")
        'cannot-withdraw'

    """
    lowered = raw.lower()
    if "self propose" in lowered:
        return "self-propose"
    if "cannot withdraw" in lowered:
        return "cannot-withdraw"
    if "escape hatch" in lowered:
        return "use-escape-hatch"
    if "replace proposer" in lowered:
        return "replace-proposer"
    if "security council" in lowered:
        return "security-council"
    return "other"


_DURATION_PATTERN = re.compile(
    r"(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>d|h|day|days|hour|hours|min|mins|minutes)\b",
    re.IGNORECASE,
)


def _parse_duration(raw: str, *, unit: str) -> float | None:
    """Extract the first duration in the requested unit from free text.

    L2Beat writes durations inconsistently — ``"5d challenge period"``,
    ``"12h delay"``, ``"6d 8h challenge period + 2d execution delay"``. Rather
    than model each phrasing, this reads the first value whose unit matches what
    the caller wants, which is stable across the phrasings observed.

    Args:
        raw: The cell text to search.
        unit: Either ``"days"`` or ``"hours"``.

    Returns:
        The parsed value in the requested unit, or ``None`` when the text states
        no such duration. ``None`` means "not stated", never "zero" — those are
        different facts and the snapshot keeps them distinct.

    """
    for match in _DURATION_PATTERN.finditer(raw):
        observed = match.group("unit").lower()
        value = float(match.group("value"))
        is_hours = observed.startswith("h")
        is_minutes = observed.startswith("min")
        is_days = observed.startswith("d")

        if unit == "days" and is_days:
            return value
        if unit == "hours" and is_hours:
            return value
        if unit == "hours" and is_minutes:
            return value / 60.0
        if unit == "days" and is_hours:
            return value / 24.0
    return None


def parse_duration_days(raw: str) -> float | None:
    """Read a day-scale duration from free text.

    Args:
        raw: Text such as ``"5d challenge period"``.

    Returns:
        Days, or ``None`` when the text states none.

    Examples:
        >>> parse_duration_days("5d challenge period")
        5.0
        >>> parse_duration_days("None")

    """
    return _parse_duration(raw, unit="days")


def parse_duration_hours(raw: str) -> float | None:
    """Read an hour-scale duration from free text.

    Args:
        raw: Text such as ``"Self sequence 12h delay"``.

    Returns:
        Hours, or ``None`` when the text states none.

    Examples:
        >>> parse_duration_hours("Self sequence 12h delay")
        12.0
        >>> parse_duration_hours("Self propose")

    """
    return _parse_duration(raw, unit="hours")
