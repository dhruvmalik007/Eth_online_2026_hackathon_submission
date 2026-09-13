// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { AquaSwapVMRouter } from "@1inch/swap-vm/contracts/routers/AquaSwapVMRouter.sol";
import { SwapVM } from "@1inch/swap-vm/contracts/SwapVM.sol";
import { ISwapVM } from "@1inch/swap-vm/contracts/interfaces/ISwapVM.sol";
import { Salt } from "@1inch/swap-vm/contracts/instructions/Controls.sol";
import { XYCSwap } from "@1inch/swap-vm/contracts/instructions/XYCSwap.sol";
import { AquaOpcodes } from "@1inch/swap-vm/contracts/opcodes/AquaOpcodes.sol";

import { AquaSwapVMTest } from "@1inch/swap-vm/test/solidity/base/AquaSwapVMTest.sol";

import { AgenticEMSSwapVMRouter } from "../src/AgenticEMSSwapVMRouter.sol";
import { RiskSignalSource } from "../src/RiskSignalSource.sol";
import { YieldBandFlight } from "../src/instructions/YieldBandFlight.sol";

/// @notice The flight guard's behaviour, on the router that owns the opcode.
///
/// @dev The fixtures are chosen so the arithmetic is exact rather than approximate,
///      because an assertion like "the output went down" passes for a dozen wrong
///      implementations. With `balanceIn = 100e18`, `balanceOut = 200e18` and
///      `amountIn = 1e18`, the constant-product curve pays out just under `1.98e18`,
///      while a band of `1e18` caps it at exactly `1e18`. So a binding clamp shows up
///      as a precise number rather than as a direction.
contract YieldBandFlightTest is AquaSwapVMTest {
    /// Volatile leg balance shipped to the maker.
    uint256 internal constant BALANCE_IN = 100e18;
    /// Stable leg balance shipped to the maker.
    uint256 internal constant BALANCE_OUT = 200e18;
    /// A band of 1.0 stable per volatile — low enough to bind against the curve above.
    uint256 internal constant BINDING_BAND = 1e18;
    /// Minted generously to the taker so a wrong amount is an assertion failure rather
    /// than an out-of-tokens revert, which would hide the real cause.
    uint256 internal constant TAKER_FUNDING = 100e18;

    /// @dev Held as the concrete type rather than casting `address(swapVM)`, because the
    ///      router inherits a payable fallback and so cannot be converted from a plain
    ///      `address`. Keeping the reference also means the test names the deployment it
    ///      is actually talking to.
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
        // The test contract is the agent, so it can arm the guard directly.
        signalSource = new RiskSignalSource(address(this));
    }

    // ─── Fixtures ────────────────────────────────────────────────────────────

    /// @dev A program in the layout the instruction is built for: curve first, band
    ///      second. See the instruction's header for why the order is not cosmetic —
    ///      placing the band before the curve lets the curve overwrite the clamp.
    function _program(address riskSource, uint256 fallbackBand) internal view returns (bytes memory) {
        return bytes.concat(
            XYCSwap.build(),
            YieldBandFlight.build(YieldBandFlight.Args({ riskSource: riskSource, maxRateOut: fallbackBand })),
            Salt.build(abi.encodePacked(uint256(0xA9C0)))
        );
    }

    function _orderWith(address riskSource, uint256 fallbackBand) internal view returns (ISwapVM.Order memory) {
        return createStrategy(_program(riskSource, fallbackBand));
    }

    /// @dev Ships the strategy and funds the maker with the real tokens Aqua pulls at
    ///      settlement. Aqua holds no tokens itself — it holds the maker's allowance, so
    ///      the maker's wallet has to actually have the stable leg.
    function _ship(ISwapVM.Order memory order) internal returns (bytes32) {
        tokenA.mint(maker, BALANCE_IN);
        tokenB.mint(maker, BALANCE_OUT);
        return shipStrategy(swapVM, order, tokenA, tokenB, BALANCE_IN, BALANCE_OUT);
    }

    /// @dev tokenA is the volatile leg and tokenB the stable one, so `zeroForOne` true
    ///      means the taker sells volatile for stable — the flight direction.
    function _swapProgram(bool isExactIn, uint256 amount) internal view returns (SwapProgram memory) {
        return SwapProgram({
            amount: amount,
            taker: taker,
            tokenA: tokenA,
            tokenB: tokenB,
            zeroForOne: true,
            isExactIn: isExactIn
        });
    }

    function _run(
        ISwapVM.Order memory order,
        bool isExactIn,
        uint256 amount
    ) internal returns (uint256 amountIn, uint256 amountOut) {
        SwapProgram memory program = _swapProgram(isExactIn, amount);
        mintTokenInToTaker(program, TAKER_FUNDING);
        tokenB.mint(maker, 1_000_000e18);
        return swap(program, order);
    }

    // ─── No flight means no change ───────────────────────────────────────────

    function test_signalAbsent_leavesTheCurveUntouched() public {
        ISwapVM.Order memory order = _orderWith(address(signalSource), BINDING_BAND);
        _ship(order);

        (, uint256 amountOut) = _run(order, true, 1e18);

        // The guard is armed but not triggered, so the curve's own price applies, and the
        // constant-product payout is strictly above the band.
        assertGt(amountOut, BINDING_BAND, "a strategy that is not fleeing must trade at the curve price");
    }

    function test_bandOfZero_isANoOp() public {
        // Neither the source nor the args carry a band. An unconfigured guard must not
        // brick the order — it must simply not act.
        ISwapVM.Order memory order = _orderWith(address(signalSource), 0);
        _ship(order);
        signalSource.setSignal(swapVM.hash(order), true, 0, 250, 1_500);

        (, uint256 amountOut) = _run(order, true, 1e18);
        assertGt(amountOut, BINDING_BAND, "no band means no constraint");
    }

    // ─── The clamp ───────────────────────────────────────────────────────────

    function test_flightRequested_clampsExactInToTheBand() public {
        ISwapVM.Order memory order = _orderWith(address(signalSource), BINDING_BAND);
        _ship(order);
        signalSource.setSignal(swapVM.hash(order), true, BINDING_BAND, 250, 1_500);

        (, uint256 amountOut) = _run(order, true, 1e18);

        // amountIn * band / 1e18 = 1e18 * 1e18 / 1e18 = 1e18, exactly.
        assertEq(amountOut, BINDING_BAND, "the taker's stable output must be capped at the band");
    }

    function test_flightRequested_floorsExactOutAtTheBand() public {
        ISwapVM.Order memory order = _orderWith(address(signalSource), BINDING_BAND);
        _ship(order);
        signalSource.setSignal(swapVM.hash(order), true, BINDING_BAND, 250, 1_500);

        (uint256 amountIn, uint256 amountOut) = _run(order, false, 1e18);

        // The curve asks for roughly 0.5e18 volatile in exchange for 1e18 stable. The band
        // says the maker will not release stable that cheaply, so the input is raised to
        // ceil(1e18 * 1e18 / 1e18) = 1e18.
        assertEq(amountOut, 1e18, "exactOut fixes the stable amount");
        assertEq(amountIn, 1e18, "the required volatile input must be raised to the band");
    }

    function test_quoteAndSwapAgreeWhileTheGuardIsActive() public {
        // The strongest single signal that the instruction is correct: SwapVM's own
        // invariant is that a quote must equal the swap. An instruction that mutated
        // registers inconsistently between the static and stateful paths would break this
        // and only this.
        ISwapVM.Order memory order = _orderWith(address(signalSource), BINDING_BAND);
        _ship(order);
        signalSource.setSignal(swapVM.hash(order), true, BINDING_BAND, 250, 1_500);

        SwapProgram memory program = _swapProgram(true, 1e18);
        (uint256 quotedIn, uint256 quotedOut) = quote(program, order);

        mintTokenInToTaker(program, TAKER_FUNDING);
        tokenB.mint(maker, 1_000_000e18);
        (uint256 actualIn, uint256 actualOut) = swap(program, order);

        assertEq(actualIn, quotedIn, "quote and swap must agree on the input");
        assertEq(actualOut, quotedOut, "quote and swap must agree on the output");
    }

    // ─── Precedence between the source and the compiled band ─────────────────

    function test_sourceBandOverridesTheCompiledFallback() public {
        // The compiled band is deliberately the *looser* one. If precedence were backwards
        // the clamp would use 2e18 and not bind, so this test fails loudly rather than
        // passing by luck.
        ISwapVM.Order memory order = _orderWith(address(signalSource), 2e18);
        _ship(order);
        signalSource.setSignal(swapVM.hash(order), true, BINDING_BAND, 250, 1_500);

        (, uint256 amountOut) = _run(order, true, 1e18);
        assertEq(amountOut, BINDING_BAND, "the source's band must win over the compiled default");
    }

    function test_sourceWithoutABand_fallsBackToTheCompiledOne() public {
        ISwapVM.Order memory order = _orderWith(address(signalSource), BINDING_BAND);
        _ship(order);
        // Zero from the source means "no opinion", not "a band of zero".
        signalSource.setSignal(swapVM.hash(order), true, 0, 250, 1_500);

        (, uint256 amountOut) = _run(order, true, 1e18);
        assertEq(amountOut, BINDING_BAND, "the compiled band applies when the source has no opinion");
    }

    function test_noRiskSource_appliesTheCompiledBandUnconditionally() public {
        // The no-agent mode: a fixed policy compiled into the program, for a strategy that
        // does not want an off-chain process in the loop.
        ISwapVM.Order memory order = _orderWith(address(0), BINDING_BAND);
        _ship(order);

        (, uint256 amountOut) = _run(order, true, 1e18);
        assertEq(amountOut, BINDING_BAND, "with no source the compiled band is the policy");
    }

    function test_clearingTheFlightReturnsTheCurveToNormal() public {
        // The guard must be reversible within one program: a cancelled flight cannot leave
        // the order permanently worse than the curve.
        ISwapVM.Order memory order = _orderWith(address(signalSource), BINDING_BAND);
        bytes32 orderHash = _ship(order);

        signalSource.setSignal(orderHash, true, BINDING_BAND, 250, 1_500);
        (, uint256 clamped) = _run(order, true, 1e18);
        assertEq(clamped, BINDING_BAND, "clamped while fleeing");

        signalSource.clearSignal(orderHash);
        (, uint256 released) = _run(order, true, 1e18);
        assertGt(released, BINDING_BAND, "back to the curve price once the flight is cancelled");
    }
}

/// @notice Proves opcode `0xb3` belongs to our router and fails loudly everywhere else.
///
/// @dev This is the test that makes the opcode choice defensible. The claim is not "0xb3
///      is unused upstream" — that is a fact about a file that can change. The claim is
///      the *behavioural* one: the same program runs on our router and reverts on the
///      canonical one. A guard a taker could sidestep by pointing at a different router
///      would be worth nothing, and a silent misinterpretation of an upstream opcode
///      would be worse than nothing, so both directions are asserted.
contract OpcodeOwnershipTest is AquaSwapVMTest {
    AgenticEMSSwapVMRouter internal agenticRouter;
    AquaSwapVMRouter internal canonicalRouter;

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
        canonicalRouter = new AquaSwapVMRouter(address(aqua), address(0), address(this), "AquaSwapVMRouter", "1.0.0");
    }

    /// @dev One program, containing opcode 0xb3, shared by both assertions.
    function _programWithOurOpcode() internal view returns (bytes memory) {
        return bytes.concat(
            XYCSwap.build(),
            YieldBandFlight.build(YieldBandFlight.Args({ riskSource: address(0), maxRateOut: 1e18 })),
            Salt.build(abi.encodePacked(uint256(0x0B3)))
        );
    }

    function _flightSwapProgram(uint256 amount) private view returns (SwapProgram memory) {
        return SwapProgram({
            amount: amount,
            taker: taker,
            tokenA: tokenA,
            tokenB: tokenB,
            zeroForOne: true,
            isExactIn: true
        });
    }

    function test_ourRouterRunsOpcode0xb3() public {
        assertEq(agenticRouter.flightOpcode(), YieldBandFlight.OPCODE, "the deployed router reports its opcode");
        assertEq(YieldBandFlight.OPCODE, 0xb3, "0xb3 is the next free slot in the rates-tuning bank");

        tokenA.mint(maker, 100e18);
        tokenB.mint(maker, 200e18);
        ISwapVM.Order memory order = createStrategy(_programWithOurOpcode());
        shipStrategy(swapVM, order, tokenA, tokenB, 100e18, 200e18);

        SwapProgram memory program = _flightSwapProgram(1e18);
        mintTokenInToTaker(program, 100e18);
        tokenB.mint(maker, 1_000_000e18);

        // Reaching a settled swap at all is the assertion: had the opcode not been ours,
        // the dispatch would have reverted before any amount was computed.
        (uint256 amountIn, uint256 amountOut) = swap(program, order);
        assertGt(amountIn, 0, "the guarded program executed");
        assertGt(amountOut, 0, "and produced an output");
    }

    function test_canonicalRouterRefusesOpcode0xb3() public {
        tokenA.mint(maker, 100e18);
        tokenB.mint(maker, 200e18);
        ISwapVM.Order memory order = createStrategy(_programWithOurOpcode());
        shipStrategy(canonicalRouter, order, tokenA, tokenB, 100e18, 200e18);

        bytes memory takerDataAndSignature = abi.encodePacked(takerData(address(taker), true, true));

        // Bind the view-typed handle *before* arming the expectation. `asView()` is itself
        // an external call, so arming first would let it consume the expectation and the
        // test would report "did not revert" while never checking the call that matters.
        ISwapVM viewRouter = canonicalRouter.asView();

        // A static quote is enough: the instruction set is resolved before any amount is
        // computed, so the refusal happens before pricing.
        vm.expectRevert(abi.encodeWithSelector(AquaOpcodes.UnknownOpcode.selector, uint256(YieldBandFlight.OPCODE)));
        viewRouter.quote(order, 1e18, takerDataAndSignature);
    }
}
