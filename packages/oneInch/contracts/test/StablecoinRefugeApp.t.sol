// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { AquaStrategyBuilders } from "@1inch/swap-vm/test/solidity/base/AquaStrategyBuilders.sol";

import { StablecoinRefugeApp } from "../src/StablecoinRefugeApp.sol";

/// @notice The refuge position's lifecycle and its trust boundary.
///
/// @dev Three properties here are the reason this file exists, and all three are asserted
///      rather than left to be inferred from the source:
///
///      1. **Aqua credits the caller as the maker.** This is the fact that caught a real bug
///         in the first draft of the app: a `ship` wrapper made the app the maker, and every
///         later `pull` silently found a zero balance. It is pinned as a test so a future
///         "convenience" wrapper fails here instead of in a demo.
///      2. `hashStrategy` agrees with what `Aqua.ship` returns. If it did not, every `pull`
///         would fail with "strategy not found" — a symptom pointing nowhere near the cause.
///      3. A relayer can **trigger** an exit but cannot **redirect** it. That is the
///         difference between a convenience and a drain, and it is exactly the property a
///         later refactor widens by adding a `recipient` parameter.
contract StablecoinRefugeAppTest is AquaStrategyBuilders {
    uint256 internal constant VOLATILE_AMOUNT = 10e18;
    uint256 internal constant STABLE_AMOUNT = 20_000e6;

    StablecoinRefugeApp internal app;
    address internal relayer;
    address internal stranger;

    function setUp() public override {
        super.setUp();
        app = new StablecoinRefugeApp(aqua);
        relayer = makeAddr("relayer");
        stranger = makeAddr("stranger");
    }

    function _strategy(address relayer_) internal view returns (StablecoinRefugeApp.Strategy memory) {
        return StablecoinRefugeApp.Strategy({
            maker: maker,
            relayer: relayer_,
            // tokenA is the volatile leg, tokenB the stable one — the flight direction.
            volatileToken: address(tokenA),
            stableToken: address(tokenB),
            salt: bytes32(uint256(0xA9C0))
        });
    }

    function _tokenPair() internal view returns (address[] memory tokens) {
        tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
    }

    /// @dev The maker ships **directly against Aqua**, passing the app as a parameter. See
    ///      the app's header: proxying this would make the app the maker.
    function _ship(
        StablecoinRefugeApp.Strategy memory strategy,
        uint256 volatileAmount,
        uint256 stableAmount
    ) internal returns (bytes32) {
        tokenA.mint(maker, volatileAmount);
        tokenB.mint(maker, stableAmount);

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = volatileAmount;
        amounts[1] = stableAmount;

        vm.startPrank(maker);
        tokenA.approve(address(aqua), type(uint256).max);
        tokenB.approve(address(aqua), type(uint256).max);
        bytes32 strategyHash = aqua.ship(address(app), app.encodeStrategy(strategy), _tokenPair(), amounts);
        vm.stopPrank();

        return strategyHash;
    }

    // ─── The fact that decides the design ────────────────────────────────────

    function test_aquaCreditsTheCallerAsMaker_notTheApp() public {
        StablecoinRefugeApp.Strategy memory strategy = _strategy(address(0));
        bytes32 strategyHash = _ship(strategy, VOLATILE_AMOUNT, STABLE_AMOUNT);

        (uint256 makerBalance, ) = aqua.rawBalances(maker, address(app), strategyHash, address(tokenA));
        (uint256 appBalance, ) = aqua.rawBalances(address(app), address(app), strategyHash, address(tokenA));

        assertEq(makerBalance, VOLATILE_AMOUNT, "the maker must hold the position");
        assertEq(appBalance, 0, "the app must hold nothing - it is not the maker");
    }

    function test_encodeStrategyIsExactlyWhatAquaHashes() public {
        StablecoinRefugeApp.Strategy memory strategy = _strategy(address(0));
        bytes32 strategyHash = _ship(strategy, VOLATILE_AMOUNT, STABLE_AMOUNT);

        // Aqua computes `keccak256(strategy)` over the bytes it receives, so this asserts
        // the app's encoder produces those exact bytes.
        assertEq(
            keccak256(app.encodeStrategy(strategy)),
            strategyHash,
            "the encoder must produce the bytes Aqua hashed"
        );
        assertEq(strategyHash, app.hashStrategy(strategy), "and the hash must agree too");
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    function test_positionState_reportsTheShippedBalances() public {
        StablecoinRefugeApp.Strategy memory strategy = _strategy(address(0));
        bytes32 strategyHash = _ship(strategy, VOLATILE_AMOUNT, STABLE_AMOUNT);

        (uint256 volatileBalance, uint256 stableBalance) =
            app.positionState(maker, strategyHash, address(tokenA), address(tokenB));

        assertEq(volatileBalance, VOLATILE_AMOUNT, "volatile leg");
        assertEq(stableBalance, STABLE_AMOUNT, "stable leg");
    }

    function test_refuge_byMaker_releasesBothLegs() public {
        StablecoinRefugeApp.Strategy memory strategy = _strategy(address(0));
        bytes32 strategyHash = _ship(strategy, VOLATILE_AMOUNT, STABLE_AMOUNT);

        vm.prank(maker);
        (uint256 volatileReleased, uint256 stableReleased) = app.refuge(strategy);

        assertEq(volatileReleased, VOLATILE_AMOUNT, "the volatile leg was released");
        assertEq(stableReleased, STABLE_AMOUNT, "the stable leg was released");

        (uint256 volatileLeft, uint256 stableLeft) =
            app.positionState(maker, strategyHash, address(tokenA), address(tokenB));
        assertEq(volatileLeft, 0, "nothing left on the volatile leg");
        assertEq(stableLeft, 0, "nothing left on the stable leg");
    }

    // ─── The trust boundary ──────────────────────────────────────────────────

    function test_relayer_canTriggerAnExitButCannotRedirectIt() public {
        StablecoinRefugeApp.Strategy memory strategy = _strategy(relayer);
        _ship(strategy, VOLATILE_AMOUNT, STABLE_AMOUNT);

        vm.prank(relayer);
        app.refuge(strategy);

        // The destination is the maker and is not a parameter, so a hostile relayer's worst
        // case is a redundant self-transfer.
        assertEq(tokenA.balanceOf(relayer), 0, "the relayer must receive nothing");
        assertEq(tokenB.balanceOf(relayer), 0, "the relayer must receive nothing");
        assertEq(tokenA.balanceOf(maker), VOLATILE_AMOUNT, "the maker keeps the volatile leg");
        assertEq(tokenB.balanceOf(maker), STABLE_AMOUNT, "the maker keeps the stable leg");
    }

    function test_stranger_cannotTriggerAnExit() public {
        StablecoinRefugeApp.Strategy memory strategy = _strategy(relayer);
        _ship(strategy, VOLATILE_AMOUNT, STABLE_AMOUNT);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(StablecoinRefugeApp.NotAuthorised.selector, stranger, maker, relayer));
        app.refuge(strategy);
    }

    function test_namedRelayerMustBeTheCaller() public {
        // A strategy naming someone else leaves the maker as the only trigger, so a stranger
        // cannot act even though *a* relayer is configured.
        address someoneElse = makeAddr("someone-else");
        StablecoinRefugeApp.Strategy memory strategy = _strategy(someoneElse);
        _ship(strategy, VOLATILE_AMOUNT, STABLE_AMOUNT);

        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(StablecoinRefugeApp.NotAuthorised.selector, relayer, maker, someoneElse)
        );
        app.refuge(strategy);
    }

    // ─── Teardown ────────────────────────────────────────────────────────────

    function test_dockingViaAquaDeactivatesThePosition() public {
        StablecoinRefugeApp.Strategy memory strategy = _strategy(address(0));
        bytes32 strategyHash = _ship(strategy, VOLATILE_AMOUNT, STABLE_AMOUNT);

        // `dock` is also keyed on `msg.sender`, so the maker calls Aqua directly here too.
        vm.prank(maker);
        aqua.dock(address(app), strategyHash, _tokenPair());

        // Once docked the strategy is no longer active, so `safeBalances` refuses rather than
        // reporting zero — a zero would read as "flat position", and an operator acting on
        // that would be misled.
        vm.expectRevert();
        app.positionState(maker, strategyHash, address(tokenA), address(tokenB));
    }
}
