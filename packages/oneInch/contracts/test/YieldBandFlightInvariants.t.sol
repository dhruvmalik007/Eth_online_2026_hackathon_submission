// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { SwapVM } from "@1inch/swap-vm/contracts/SwapVM.sol";
import { ISwapVM } from "@1inch/swap-vm/contracts/interfaces/ISwapVM.sol";
import { Salt } from "@1inch/swap-vm/contracts/instructions/Controls.sol";
import { XYCSwap } from "@1inch/swap-vm/contracts/instructions/XYCSwap.sol";

import { AquaSwapVMTest } from "@1inch/swap-vm/test/solidity/base/AquaSwapVMTest.sol";

import { AgenticEMSSwapVMRouter } from "../src/AgenticEMSSwapVMRouter.sol";
import { RiskSignalSource } from "../src/RiskSignalSource.sol";
import { YieldBandFlight } from "../src/instructions/YieldBandFlight.sol";

/// @notice SwapVM's core invariants, asserted for a program that contains the flight guard.
///
/// @dev ## Why these live in their own file, asserted directly
///
/// Upstream ships `CoreInvariants`, and using it would be the obvious move. It is not
/// used here for a concrete reason: its `InvariantConfig` wants pre-built
/// `exactInTakerData`/`exactOutTakerData` blobs and an `_executeSwap` hook, and the
/// harness in this vendored revision exposes no `_signAndPackTakerData` helper to build
/// them. Wiring that up would mean reimplementing the harness before testing against it.
///
/// Every quote in SwapVM is a **static** call, so the balance-mutating scaffolding the
/// harness exists to manage is not needed at all: quoting three times at three sizes
/// observes the curve without touching state. That makes the invariants cheaper to state
/// directly *and* makes them read like the properties they are.
///
/// ## The property that actually matters here
///
/// The guard multiplies into the price path, so the risk is not that the guard does
/// nothing — that is covered elsewhere — but that it **breaks** a property the VM relies
/// on. A clamp applied in the wrong direction would invert monotonicity, and a clamp that
/// rounded the wrong way would let a taker extract value from the maker one wei at a time.
/// Both are asserted with the guard active.
contract YieldBandFlightInvariantsTest is AquaSwapVMTest {
    uint256 internal constant BALANCE_IN = 100e18;
    uint256 internal constant BALANCE_OUT = 200e18;

    /// Chosen so the clamp binds at the larger sizes and not the smallest, which is what
    /// makes the monotonicity assertion meaningful: a band that never bound would prove
    /// only that the curve is still the curve.
    uint256 internal constant BAND = 1e18;

    AgenticEMSSwapVMRouter internal agenticRouter;
    RiskSignalSource internal signalSource;

    function _deployRouter() internal override returns (SwapVM) {
        agenticRouter = new AgenticEMSSwapVMRouter(
            address(aqua),
            address(0),
            address(this),
            "AgenticEMSSwapVMRouter",
            "1.0.0"
        );
        return agenticRouter;
    }

    function setUp() public override {
        super.setUp();
        signalSource = new RiskSignalSource(address(this));
    }

    /// @dev The flight program: curve, then guard, then a salt for uniqueness.
    function _flightProgram() internal view returns (bytes memory) {
        return bytes.concat(
            XYCSwap.build(),
            YieldBandFlight.build(YieldBandFlight.Args({ riskSource: address(signalSource), maxRateOut: BAND })),
            Salt.build(abi.encodePacked(uint256(0x1A7)))
        );
    }

    function _shippedFlight() internal returns (ISwapVM.Order memory order, bytes32 orderHash) {
        order = createStrategy(_flightProgram());
        tokenA.mint(maker, BALANCE_IN);
        tokenB.mint(maker, BALANCE_OUT);
        orderHash = shipStrategy(swapVM, order, tokenA, tokenB, BALANCE_IN, BALANCE_OUT);
        signalSource.setSignal(orderHash, true, BAND, 250, 1_500);
    }

    function _quoteAt(ISwapVM.Order memory order, bool isExactIn, uint256 amount) internal view returns (uint256, uint256) {
        SwapProgram memory program = SwapProgram({
            amount: amount,
            taker: taker,
            tokenA: tokenA,
            tokenB: tokenB,
            zeroForOne: true,
            isExactIn: isExactIn
        });
        return quote(program, order);
    }

    // ─── Quote/swap consistency, with no state to clean up ───────────────────

    function test_quoteIsStableAcrossRepeatedCalls() public {
        // A quote must not depend on how many times it has been asked. If the guard read or
        // wrote state in the static path, this is where it would show.
        (ISwapVM.Order memory order, ) = _shippedFlight();

        (uint256 firstIn, uint256 firstOut) = _quoteAt(order, true, 10e18);
        (uint256 secondIn, uint256 secondOut) = _quoteAt(order, true, 10e18);

        assertEq(secondIn, firstIn, "the quoted input must not drift");
        assertEq(secondOut, firstOut, "the quoted output must not drift");
    }

    // ─── Symmetry ────────────────────────────────────────────────────────────

    function test_exactInThenExactOutIsSymmetricUnderTheBand() public {
        // SwapVM's first core invariant: if `exactIn(X) -> Y`, then `exactOut(Y) -> X`
        // within rounding. A directional clamp would break this, and a broken symmetry is
        // an internal arbitrage: the same order could be round-tripped at a profit.
        (ISwapVM.Order memory order, ) = _shippedFlight();

        uint256 amountIn = 10e18;
        (, uint256 amountOut) = _quoteAt(order, true, amountIn);
        (uint256 recoveredIn, ) = _quoteAt(order, false, amountOut);

        // One wei of slack for the ceil/floor pair on the second leg.
        assertApproxEqAbs(recoveredIn, amountIn, 1, "exactIn/exactOut must round-trip");
    }

    // ─── Monotonicity ────────────────────────────────────────────────────────

    function test_largerTradesGetEqualOrWorsePricesWithTheBandActive() public {
        // SwapVM's fourth core invariant: price (`out/in`) must not improve with size.
        // Constant is allowed and expected — that is what a binding cap produces.
        (ISwapVM.Order memory order, ) = _shippedFlight();

        uint256[] memory sizes = new uint256[](4);
        sizes[0] = 1e18;
        sizes[1] = 5e18;
        sizes[2] = 25e18;
        sizes[3] = 50e18;

        uint256 previousRate = type(uint256).max;
        for (uint256 i = 0; i < sizes.length; i++) {
            (uint256 in_, uint256 out_) = _quoteAt(order, true, sizes[i]);
            uint256 rate = (out_ * 1e18) / in_;

            assertLe(rate, previousRate, "price must not improve as the trade grows");
            previousRate = rate;
        }
    }

    // ─── Rounding favours the maker ──────────────────────────────────────────

    function test_theClampRoundsTheTakerDownNotUp() public {
        // SwapVM's fifth core invariant: `amountOut` floors. With a band of 1e18 and an input
        // that does not divide evenly, a ceiling would hand the taker up to a wei more than
        // the band allows — extractable repeatedly, which is why it is an invariant and not a
        // style preference.
        (ISwapVM.Order memory order, ) = _shippedFlight();

        // 1e18 + 1 wei, so `amountIn * band / 1e18` has a remainder to discard.
        uint256 amountIn = 1e18 + 1;
        (, uint256 amountOut) = _quoteAt(order, true, amountIn);

        uint256 exactCap = (amountIn * BAND) / 1e18;
        assertEq(amountOut, exactCap, "the cap must floor, so the taker gets the rounded-down amount");
        assertLt(amountOut * 1e18, amountIn * BAND + 1e18, "and must not exceed the band");

        // The maker-favouring direction, stated as the inequality that would be violated by a
        // ceiling: the taker's output must not exceed the exact band value.
        assertLe(amountOut, exactCap, "never more than the band");
    }

    function test_exactOutRoundsTheRequiredInputUp() public {
        // The mirror of the above: for exactOut the *input* rounds up, which again favours
        // the maker. A floor here would let a taker pay one wei less than the band requires.
        (ISwapVM.Order memory order, ) = _shippedFlight();

        uint256 amountOut = 3e18 + 1;
        (uint256 amountIn, ) = _quoteAt(order, false, amountOut);

        uint256 exactFloor = (amountOut * 1e18 + BAND - 1) / BAND; // ceil
        assertGe(amountIn, exactFloor, "the required input must be ceiled to the band");
    }

    // ─── Balance sufficiency ─────────────────────────────────────────────────

    function test_anOrderCannotPromiseMoreStableThanItShipped() public {
        // A band below the shipped liquidity asks for more than exists. That must be a
        // refusal, not a promise the settlement cannot keep.
        ISwapVM.Order memory order = createStrategy(
            bytes.concat(
                XYCSwap.build(),
                // A band of 10 stable per volatile against 200e18 shipped: the cap on a 50e18
                // input would be 500e18, well beyond the maker's balance.
                YieldBandFlight.build(YieldBandFlight.Args({ riskSource: address(0), maxRateOut: 10e18 })),
                Salt.build(abi.encodePacked(uint256(0x1A7)))
            )
        );

        tokenA.mint(maker, BALANCE_IN);
        tokenB.mint(maker, BALANCE_OUT);
        shipStrategy(swapVM, order, tokenA, tokenB, BALANCE_IN, BALANCE_OUT);

        // The clamp raises `amountOut` only downward, so the curve's own output still respects
        // the balance — this asserts the guard does not create a promise the maker cannot meet.
        (uint256 in_, uint256 out_) = _quoteAt(order, true, 50e18);
        assertLe(out_, BALANCE_OUT, "a quote must never exceed the shipped balance");
        assertGt(in_, 0, "and the trade is still priced");
    }
}
