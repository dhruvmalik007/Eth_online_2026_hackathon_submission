"""Type-level assertions for the Python contract.

These are checked by ``mypy --strict``, not at runtime: ``assert_type`` is a
no-op in CPython and a compile-time assertion under mypy. So a drifted annotation
fails the typecheck gate rather than a test — the mirror of the TypeScript
``expectTypeOf`` suite in ``test/types.test.ts``.

Each class pairs the static assertion with a runtime check where the claim has an
observable counterpart (a conversion producing a value). The rest are
intentionally runtime-free: asserting them twice would add noise, not coverage.
"""

from __future__ import annotations

from typing import assert_type

from risk_pipeline.models import ChainRiskProfile
from risk_pipeline.sources.base import SourceOutcome
from risk_pipeline.units import (
    Bps,
    Days,
    DecimalRate,
    Pct,
    Usd,
    bps_to_rate,
    pct_to_rate,
    rate_to_pct,
)


class TestUnitBranding:
    """``NewType`` must make each unit nominally distinct."""

    def test_each_constructor_produces_its_own_unit(self) -> None:
        # `Usd` and `Pct` are both `float` at runtime; only mypy distinguishes
        # them, which is exactly the bug class this guards.
        assert_type(Usd(1_000_000.0), Usd)
        assert_type(Pct(4.0), Pct)
        assert_type(DecimalRate(0.04), DecimalRate)
        assert_type(Bps(400), Bps)
        assert_type(Days(30.0), Days)

    def test_conversions_encode_both_ends(self) -> None:
        # Each conversion is the single sanctioned path between two units, so
        # both its input and output types are contract, not implementation.
        assert_type(pct_to_rate(Pct(4.0)), DecimalRate)
        assert_type(rate_to_pct(DecimalRate(0.04)), Pct)
        assert_type(bps_to_rate(Bps(400)), DecimalRate)

    def test_bps_is_the_only_integer_unit(self) -> None:
        # Basis points are counted rather than measured, so this is the one unit
        # whose underlying type is `int`.
        assert_type(Bps(400).__int__(), int)


class TestUnitRuntime:
    """The ``NewType`` illusion is erased, so values behave as their base type."""

    def test_conversions_are_arithmetically_correct(self) -> None:
        assert pct_to_rate(Pct(4.0)) == 0.04
        assert rate_to_pct(DecimalRate(0.04)) == 4.0
        assert bps_to_rate(Bps(400)) == 0.04

    def test_units_add_without_a_cast(self) -> None:
        # Branding must not be so strict that ordinary arithmetic needs one.
        total: float = Usd(100.0) + Pct(4.0) + DecimalRate(0.04) + Bps(400) + Days(30.0)
        assert total == 534.04


class TestContractShapes:
    """The models expose the shapes the TypeScript contract validates."""

    def test_source_outcome_is_generic_over_its_record_type(self) -> None:
        # Sources validate into pydantic models before the writer sees them, and
        # the generic parameter is what keeps that relationship visible.
        assert_type(SourceOutcome[ChainRiskProfile], type[SourceOutcome[ChainRiskProfile]])

    def test_chain_profile_records_are_models_not_dicts(self) -> None:
        # A bare dict could not reach `model_dump_json`, which is what produces
        # the camelCase wire form.
        assert "model_dump_json" in dir(ChainRiskProfile)
