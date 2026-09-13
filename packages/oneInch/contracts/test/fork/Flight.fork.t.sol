// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { console2 } from "forge-std/console2.sol";
import { Vm } from "forge-std/Vm.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";

import { SwapVM } from "@1inch/swap-vm/contracts/SwapVM.sol";
import { ISwapVM } from "@1inch/swap-vm/contracts/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/contracts/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/contracts/libs/TakerTraits.sol";
import { Salt } from "@1inch/swap-vm/contracts/instructions/Controls.sol";
import { XYCSwap } from "@1inch/swap-vm/contracts/instructions/XYCSwap.sol";
import { MockTaker } from "@1inch/swap-vm/test/solidity/mocks/MockTaker.sol";

import { AgenticEMSSwapVMRouter } from "../../src/AgenticEMSSwapVMRouter.sol";
import { RiskSignalSource } from "../../src/RiskSignalSource.sol";
import { YieldBandFlight } from "../../src/instructions/YieldBandFlight.sol";

/// @dev The ERC-4626 slice the destination leg needs.
interface IERC4626Like {
    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
}

/// @title The flight, end to end, against a real Optimism fork.
///
/// @notice Ships a SwapVM strategy holding the **canonical Aqua registry**, arms the flight
///         guard, fills the order, converts the volatile leg into USDC, and deposits that USDC
///         into a real Morpho vault — then writes the facts to JSON for the harness to fold
///         into a committed evidence artifact.
///
/// @dev ## Why this runs in Foundry rather than from TypeScript
///
/// The taker side of a swap is `takerTraitsAndData`: a 176-bit header plus up to ten variable
/// slices. Reimplementing that in TypeScript would create a second encoder that can disagree
/// with the contract about **direction and slippage bound** — two things that fail silently and
/// expensively. Upstream ships `TakerTraitsLib` in Solidity, so the scenario uses it, and the
/// TypeScript harness orchestrates rather than re-encodes.
///
/// ## Orientation, because it is the easiest thing to get backwards
///
/// "Convert the volatile leg into USDC" means the taker **pays WETH and receives USDC**. In
/// SwapVM terms that is `tokenIn = WETH`, `tokenOut = USDC`, so `zeroForOne` is **false** when
/// `tokenA = USDC < tokenB = WETH`. The maker therefore provides USDC (`balanceOut`) and
/// receives WETH — which is what gives the guard something protective to do: `YieldBandFlight`
/// caps `amountOut / amountIn`, i.e. the USDC the taker may take per WETH offered.
///
/// ## Skipping without a fork
///
/// `vm.skip(true)` in `setUp` keeps a plain `forge test` green offline. A fork test that fails
/// without an RPC makes the whole suite unrunnable for anyone without one, which is how a test
/// suite stops being run.
contract FlightForkTest is Test {
    // ─── Canonical Optimism addresses, as pinned in the chain registry ───────
    // Checksummed, because Solidity address literals reject the all-lowercase form that the
    // TypeScript registry stores for viem.
    address internal constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address internal constant USDC = 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    /// The curated Gauntlet USDC Prime vault, verified live by `smoke`.
    address internal constant VAULT = 0xC30ce6A5758786e0F640cC5f881Dd96e9a1C5C59;

    uint256 internal constant OP_CHAIN_ID = 10;
    uint256 internal constant ONE = 1e18;

    // Reserves the maker posts. Both are virtual — Aqua holds no tokens — but only `balanceOut`
    // is actually pulled, so only the maker's USDC needs to exist.
    uint256 internal constant RESERVE_WETH = 10e18;
    uint256 internal constant RESERVE_USDC = 40_000e6;

    /// The band, and the reason it binds: the curve would pay ~3_636e6 USDC for 1 WETH, and this
    /// caps it at 3_400e6. A band that did not bind would prove nothing.
    uint256 internal constant BAND = 3_400e6;
    uint256 internal constant SWAP_AMOUNT = 1e18;

    Aqua internal aqua;
    AgenticEMSSwapVMRouter internal router;
    RiskSignalSource internal signalSource;
    MockTaker internal taker;

    address internal maker;
    /// @dev Set by the scenario so the JSON carries the real count, not a placeholder.
    uint256 private _routerLogCount;

    function setUp() public {
        if (block.chainid != OP_CHAIN_ID) {
            vm.skip(true, "not an Optimism fork: run with --fork-url $OPTIMISM_RPC_URL");
            return;
        }

        aqua = Aqua(AQUA);
        maker = makeAddr("maker");

        // Our redeployment: the canonical instruction set plus `YieldBandFlight`. The Aqua
        // registry it points at is the *deployed* one, which is what the track brief asks for.
        router = new AgenticEMSSwapVMRouter(AQUA, WETH, address(this), "AgenticEMSSwapVMRouter", "1.0.0");
        signalSource = new RiskSignalSource(address(this));
        // `SwapVM` inherits a payable fallback via OnlyWethReceiver, so the upcast has to go
        // through `payable` — the same reason the router cannot be cast from a plain address.
        taker = new MockTaker(aqua, SwapVM(payable(address(router))), address(this));
    }

    // ─── Fixtures ────────────────────────────────────────────────────────────

    /// @dev The flight program: curve, then guard, then a salt. The order matters — see the
    ///      instruction's header: the guard reads amounts the curve produced and writes them
    ///      back, so placing it first would let the curve overwrite the clamp.
    function _program(address riskSource, uint256 fallbackBand) internal view returns (bytes memory) {
        return bytes.concat(
            XYCSwap.build(),
            YieldBandFlight.build(YieldBandFlight.Args({ riskSource: riskSource, maxRateOut: fallbackBand })),
            Salt.build(abi.encodePacked(uint256(0xF119)))
        );
    }

    function _order(address riskSource, uint256 fallbackBand) internal view returns (ISwapVM.Order memory) {
        // tokenA must sort below tokenB, and USDC < WETH on Optimism.
        return MakerTraitsLib.build(
            MakerTraitsLib.Args({
                maker: maker,
                receiver: address(0),
                tokenA: USDC,
                tokenB: WETH,
                shouldUnwrapWeth: false,
                // Aqua mode: the authorisation is a balance in the registry, not a signature.
                useAquaInsteadOfSignature: true,
                allowZeroAmountIn: false,
                hasPreTransferInHook: false,
                hasPostTransferInHook: false,
                hasPreTransferOutHook: false,
                hasPostTransferOutHook: false,
                preTransferInTarget: address(0),
                preTransferInData: "",
                postTransferInTarget: address(0),
                postTransferInData: "",
                preTransferOutTarget: address(0),
                preTransferOutData: "",
                postTransferOutTarget: address(0),
                postTransferOutData: "",
                program: _program(riskSource, fallbackBand)
            })
        );
    }

    /// @dev Taker traits, built with upstream's own encoder. `to` is the test contract rather
    ///      than the MockTaker so the proceeds land somewhere that can deposit them.
    function _takerData(address recipient, bool isExactIn, bool isAToB, uint256 minOut) internal view returns (bytes memory) {
        return
            TakerTraitsLib.build(
                TakerTraitsLib.Args({
                    taker: address(taker),
                    isExactIn: isExactIn,
                    shouldUnwrapWeth: false,
                    // The MockTaker pushes the input into Aqua from this callback; without it the
                    // router reverts with `AquaBalanceInsufficientAfterTakerPush`.
                    hasPreTransferInCallback: true,
                    hasPreTransferOutCallback: false,
                    isStrictThresholdAmount: false,
                    isFirstTransferFromTaker: false,
                    useTransferFromAndAquaPush: false,
                    isAToB: isAToB,
                    allowPartialFill: false,
                    // A 32-byte minimum output, so the taker has its own slippage protection
                    // independent of the maker's band.
                    threshold: abi.encodePacked(minOut),
                    to: recipient,
                    deadline: 0,
                    preTransferInHookData: "",
                    postTransferInHookData: "",
                    preTransferOutHookData: "",
                    postTransferOutHookData: "",
                    preTransferInCallbackData: "",
                    preTransferOutCallbackData: "",
                    instructionsArgs: "",
                    signature: ""
                })
            );
    }

    /// @dev Ships the strategy to the canonical Aqua registry and funds the parties.
    function _shipAndFund(ISwapVM.Order memory order) internal returns (bytes32 strategyHash) {
        // The maker must hold the leg it is offering, because Aqua pulls it out of the maker's
        // wallet at settlement rather than out of a pool.
        deal(USDC, maker, RESERVE_USDC);
        vm.prank(maker);
        IERC20(USDC).approve(AQUA, type(uint256).max);

        // The taker pays WETH; the MockTaker approves and pushes it inside the callback.
        deal(WETH, address(taker), SWAP_AMOUNT * 2);

        address[] memory tokens = new address[](2);
        tokens[0] = USDC;
        tokens[1] = WETH;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = RESERVE_USDC;
        amounts[1] = RESERVE_WETH;

        // Called by the maker directly: `Aqua.ship` credits `msg.sender` as the maker, so
        // proxying this through a contract would record the wrong maker.
        vm.prank(maker);
        strategyHash = aqua.ship(address(router), abi.encode(order), tokens, amounts);
    }

    function _quote(ISwapVM.Order memory order, uint256 amount, uint256 minOut) internal view returns (uint256, uint256) {
        (uint256 amountIn, uint256 amountOut, ) = router.asView().quote(
            order,
            amount,
            abi.encodePacked(_takerData(address(this), true, false, minOut))
        );
        return (amountIn, amountOut);
    }

    // ─── The scenario ────────────────────────────────────────────────────────

    function test_flight_convertsTheVolatileLegIntoUsdcAndDepositsIt() public {
        ISwapVM.Order memory order = _order(address(signalSource), BAND);
        bytes32 strategyHash = _shipAndFund(order);

        uint256 takerUsdcBefore = IERC20(USDC).balanceOf(address(this));
        uint256 makerWethBefore = IERC20(WETH).balanceOf(maker);

        // ── While the strategy is not fleeing, the curve's own price applies ──
        (uint256 calmIn, uint256 calmOut) = _quote(order, SWAP_AMOUNT, 0);
        assertGt(calmOut, BAND, "an unarmed guard must leave the curve's price intact");

        // ── Arm the guard, and assert the contract agrees with what we are about to do ──
        signalSource.setSignal(strategyHash, true, BAND, 250, 1_500);
        assertTrue(signalSource.flightRequested(strategyHash), "the guard is armed");

        (uint256 quotedIn, uint256 quotedOut) = _quote(order, SWAP_AMOUNT, BAND);
        assertEq(quotedOut, BAND, "with the guard armed, the quote is clamped to the band");

        // ── Fill it ──
        vm.recordLogs();
        (uint256 actualIn, uint256 actualOut) = taker.swap(
            order,
            SWAP_AMOUNT,
            abi.encodePacked(_takerData(address(this), true, false, BAND))
        );

        // The invariant that matters most: a quote must equal the swap.
        assertEq(actualIn, quotedIn, "quote and swap must agree on the input");
        assertEq(actualOut, quotedOut, "quote and swap must agree on the output");
        assertEq(actualOut, BAND, "the fill landed exactly on the band");

        // ── Real token movement, not just register arithmetic ──
        assertEq(
            IERC20(USDC).balanceOf(address(this)) - takerUsdcBefore,
            BAND,
            "the taker received the USDC the flight was meant to produce"
        );
        assertEq(
            IERC20(WETH).balanceOf(maker) - makerWethBefore,
            SWAP_AMOUNT,
            "the maker received the volatile leg it gave up stablecoin for"
        );

        // The router spoke during the fill. Asserted as a log from its address rather than by
        // decoding `Swapped`'s fields, because the balance deltas above already prove the
        // amounts and decoding would only re-assert them.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 routerLogs = 0;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(router)) routerLogs++;
        }
        assertGt(routerLogs, 0, "our router emitted during the fill");
        _routerLogCount = routerLogs;

        // ── The destination leg: a real Morpho vault ──
        uint256 received = IERC20(USDC).balanceOf(address(this));
        assertEq(IERC4626Like(VAULT).asset(), USDC, "the curated vault holds the asset we are deploying");
        IERC20(USDC).approve(VAULT, received);
        uint256 shares = IERC4626Like(VAULT).deposit(received, address(this));
        assertGt(shares, 0, "the flight's proceeds became a real vault position");

        // ── Facts for the harness ──
        _writeFacts(strategyHash, quotedIn, quotedOut, actualIn, actualOut, received, shares);
    }

    function test_flight_isInertUntilTheSignalSaysOtherwise() public {
        // The paired negative: the same program, the same order, no verdict — and the guard must
        // not touch a thing. Without this, a guard that always clamped would pass the test above.
        ISwapVM.Order memory order = _order(address(signalSource), BAND);
        bytes32 strategyHash = _shipAndFund(order);

        assertFalse(signalSource.flightRequested(strategyHash), "nothing is armed yet");

        (uint256 amountIn, uint256 amountOut) = _quote(order, SWAP_AMOUNT, 0);
        assertGt(amountOut, BAND, "the curve's price stands while the strategy is calm");
        assertEq(amountIn, SWAP_AMOUNT, "and the taker's input is unchanged");
    }

    // ─── Facts ───────────────────────────────────────────────────────────────

    /// @dev Writes the observed values where the TypeScript harness reads them. `out/evidence`
    ///      is the one path `foundry.toml` grants write access to.
    function _writeFacts(
        bytes32 strategyHash,
        uint256 quotedIn,
        uint256 quotedOut,
        uint256 actualIn,
        uint256 actualOut,
        uint256 deposited,
        uint256 shares
    ) private {
        string memory json = "flight";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeUint(json, "forkBlock", block.number);
        vm.serializeString(json, "router", vm.toString(address(router)));
        vm.serializeString(json, "signalSource", vm.toString(address(signalSource)));
        vm.serializeString(json, "strategyHash", vm.toString(strategyHash));
        vm.serializeString(json, "usdc", vm.toString(USDC));
        vm.serializeString(json, "weth", vm.toString(WETH));
        vm.serializeString(json, "vault", vm.toString(VAULT));
        vm.serializeString(json, "taker", vm.toString(address(this)));
        vm.serializeString(json, "maker", vm.toString(maker));
        // Amounts are written as **decimal strings**, not JSON numbers. `vaultShares` is ~3.3e21,
        // well past the 2^53 a JSON number can hold, so a numeric field would round silently and
        // the harness would compare numbers that are not the ones observed. This is the same rule
        // the capability port already enforces for `UnsignedTransaction.value`.
        vm.serializeString(json, "band", vm.toString(BAND));
        vm.serializeString(json, "swapAmount", vm.toString(SWAP_AMOUNT));
        vm.serializeString(json, "quotedIn", vm.toString(quotedIn));
        vm.serializeString(json, "quotedOut", vm.toString(quotedOut));
        vm.serializeString(json, "actualIn", vm.toString(actualIn));
        vm.serializeString(json, "actualOut", vm.toString(actualOut));
        vm.serializeString(json, "depositedUsdc", vm.toString(deposited));
        vm.serializeString(json, "vaultShares", vm.toString(shares));
        string memory output = vm.serializeUint(json, "routerLogCount", _routerLogCount);

        // `writeJson` does not create parent directories, and `out/` is cleaned by `forge clean`,
        // so the directory is created here rather than assumed. `recursive` because neither
        // component is guaranteed to exist on a fresh checkout.
        vm.createDir("out/evidence", true);

        string memory path = string.concat("out/evidence/flight-", vm.toString(block.chainid), ".json");
        vm.writeJson(output, path);
        console2.log("flight facts written to", path);
        console2.log("clamped USDC out", actualOut);
        console2.log("vault shares", shares);
    }
}
