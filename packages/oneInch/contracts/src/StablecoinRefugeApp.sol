// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { AquaApp } from "@1inch/aqua/src/AquaApp.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

/// @title StablecoinRefugeApp
/// @notice Holds a two-token Aqua position and can release it in one call, so a strategy
///         that has decided to flee is not stuck behind a two-step exit.
///
/// @dev ## Where this sits relative to the router, and why they are separate
///
/// These are two different Aqua apps, and conflating them is the easiest mistake to make:
///
/// - **`AgenticEMSSwapVMRouter`** is the app you ship to when you want a *SwapVM position*:
///   `aqua.ship(router, order.encode(), tokens, amounts)` gives the maker's liquidity a
///   program, and takers fill it. That is the Aqua app the SwapVM strategy lives in.
/// - **`StablecoinRefugeApp`** is the app you ship to when you want a *position that can
///   exit atomically*. It holds no pricing logic at all. Its job is that one call moves
///   both legs back to the maker.
///
/// The second exists because the flight is a two-step intent — swap the volatile leg,
/// then deploy the stable leg into a Morpho vault — and the swap is a SwapVM take that a
/// taker performs. If the position could only be released by the maker signing two
/// transactions, the window between them is a window of half-executed risk. Atomic
/// release removes it.
///
/// ## Why this contract does not offer `ship` or `dock`
///
/// This is the detail that decides whether the contract works at all, and it is worth
/// stating because the natural instinct is to add a convenience wrapper.
///
/// `Aqua.ship` credits **`msg.sender`** as the maker:
///
/// ```solidity
/// // Aqua.sol
/// function ship(address app, bytes calldata strategy, ...) external returns (bytes32) {
///     strategyHash = keccak256(strategy);
///     ...
///     Balance storage balance = _balances[msg.sender][app][strategyHash][tokens[i]];
/// ```
///
/// So if this app called `AQUA.ship(address(this), ...)` on the maker's behalf, `msg.sender`
/// would be *this contract* and the position would be recorded under the app's address.
/// Every later `pull` — which looks up `_balances[maker][msg.sender]` — would then find
/// nothing, and the failure would present as a zero balance rather than as an error. The
/// same applies to `dock`, which is also keyed on `msg.sender`.
///
/// The consequence is a deliberate asymmetry: **the maker ships and docks directly against
/// Aqua**, passing `address(this)` as the app, and this contract exposes only the part that
/// genuinely must be a contract — the atomic release, where `pull`'s `msg.sender` has to be
/// the app. `encodeStrategy` exists so the maker has the exact bytes to hand to Aqua,
/// since the position's identity is a hash of those bytes and a mismatch would be invisible
/// until the first pull.
///
/// ## The trust boundary, stated precisely
///
/// A maker names one `relayer` in the strategy. That address may **trigger** a release; it
/// may not **redirect** one, because the destination is hardcoded to `maker`. An unnamed
/// relayer (`address(0)`) means maker-only. Asserted as an explicit test rather than left
/// as an implication of the code, since this is exactly the property a later refactor
/// quietly widens by adding a recipient parameter.
///
/// ## Event names are prefixed on purpose
///
/// `IAqua` already declares `Shipped`, `Docked`, `Pushed` and `Pulled`. Reusing those names
/// with different parameters would put two incompatible shapes behind one topic, and an
/// indexer filtering on `Shipped` would silently get both. `Refuge*` keeps the two streams
/// distinguishable in a log.
contract StablecoinRefugeApp is AquaApp {
    /// @notice A maker's refuge position.
    /// @param maker The owner of the position, and the only permitted destination.
    /// @param relayer Address allowed to trigger a release. Zero means maker-only.
    /// @param volatileToken The leg that flees.
    /// @param stableToken The leg that stays.
    /// @param salt Distinguishes two otherwise-identical positions for one maker, since
    ///        `strategyHash` is the only identity a position has and re-shipping the same
    ///        parameters would be refused as a mutation of an immutable strategy.
    struct Strategy {
        address maker;
        address relayer;
        address volatileToken;
        address stableToken;
        bytes32 salt;
    }

    /// @notice A position was released back to its maker.
    event Refuged(
        address indexed maker,
        bytes32 indexed strategyHash,
        uint256 volatileReleased,
        uint256 stableReleased,
        address triggeredBy
    );

    /// @dev The caller is neither the maker nor the named relayer.
    error NotAuthorised(address caller, address maker, address relayer);

    /// @dev A caller asked for a release on a position whose maker is not itself, which
    ///      means the strategy bytes and the shipped bytes disagree.
    error StrategyMakerMismatch(address declared, address sent);

    constructor(IAqua aqua) AquaApp(aqua) {}

    /// @notice The bytes to hand to `Aqua.ship` as `strategy`.
    /// @dev Exposed rather than left to the caller to assemble, because `strategyHash` is
    ///      `keccak256` of exactly these bytes. A caller who encoded the struct differently
    ///      — field order, an extra wrapper — would ship a position this contract could
    ///      never hash back, and the symptom would be a silent zero balance.
    function encodeStrategy(Strategy calldata strategy) public pure returns (bytes memory) {
        return abi.encode(strategy);
    }

    /// @notice The identity of a position. Equals `keccak256(encodeStrategy(strategy))`.
    function hashStrategy(Strategy calldata strategy) public pure returns (bytes32) {
        return keccak256(abi.encode(strategy));
    }

    /// @notice Release both legs back to the maker, in one call.
    /// @dev The destination is `strategy.maker` and is not a parameter. That is the security
    ///      property of this contract: a relayer can trigger an exit but cannot choose where
    ///      the tokens go.
    ///
    ///      Amounts are read immediately before each pull rather than passed in, so a
    ///      concurrent change to the position cannot make this pull more than exists.
    /// @param strategy The position. Its maker and relayer are checked against the caller.
    /// @return volatileReleased The volatile amount released.
    /// @return stableReleased The stable amount released.
    function refuge(
        Strategy calldata strategy
    )
        external
        nonReentrantStrategy(strategy.maker, hashStrategy(strategy))
        returns (uint256 volatileReleased, uint256 stableReleased)
    {
        _requireAuthorised(strategy);

        bytes32 strategyHash = hashStrategy(strategy);
        address maker = strategy.maker;

        (volatileReleased, ) = AQUA.rawBalances(maker, address(this), strategyHash, strategy.volatileToken);
        (stableReleased, ) = AQUA.rawBalances(maker, address(this), strategyHash, strategy.stableToken);

        if (volatileReleased > 0) {
            AQUA.pull(maker, strategyHash, strategy.volatileToken, volatileReleased, maker);
        }
        if (stableReleased > 0) {
            AQUA.pull(maker, strategyHash, strategy.stableToken, stableReleased, maker);
        }

        emit Refuged(maker, strategyHash, volatileReleased, stableReleased, msg.sender);
    }

    /// @notice The position's live virtual balances.
    /// @dev `safeBalances` rather than `rawBalances`: it reverts when a token is not part of
    ///      the active strategy, which is precisely the check worth having here. A docked
    ///      position, or a token that was never in it, should be a loud failure rather than
    ///      a reported zero — a zero reads as "flat position", and an operator acting on
    ///      that would be misled.
    function positionState(
        address maker,
        bytes32 strategyHash,
        address volatileToken,
        address stableToken
    ) external view returns (uint256 volatileBalance, uint256 stableBalance) {
        return AQUA.safeBalances(maker, address(this), strategyHash, volatileToken, stableToken);
    }

    function _requireAuthorised(Strategy calldata strategy) private view {
        bool isMaker = msg.sender == strategy.maker;
        bool isRelayer = strategy.relayer != address(0) && msg.sender == strategy.relayer;
        if (!isMaker && !isRelayer) revert NotAuthorised(msg.sender, strategy.maker, strategy.relayer);
    }
}
