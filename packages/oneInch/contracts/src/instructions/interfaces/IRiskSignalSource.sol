// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title IRiskSignalSource
/// @notice The on-chain half of the flight decision.
///
/// @dev ## Why the verdict lives on-chain at all
///
/// The policy that decides *whether* to flee runs off-chain: it needs trailing
/// mean yields, realised volatility and vault liquidity, none of which a contract
/// can compute. That is not a limitation to work around — it is the right split,
/// because a signal that expensive should be computed once per decision rather
/// than once per swap.
///
/// But a decision made entirely off-chain is a decision nobody can audit. Putting
/// the verdict on-chain buys three things that matter:
///
/// 1. **The instruction can refuse.** A taker who ignores the policy and calls
///    `swap()` directly still hits the guard, because the guard is in the
///    program's bytecode and reads this contract.
/// 2. **The band is enforced, not asserted.** `maxRateOut` is read at execution
///    time, so the price the maker actually gets is not a number that appeared in
///    a log.
/// 3. **The threshold desync is observable.** `floorApyBps` and `volCapBps` are
///    recorded here, so the off-chain policy can read them back and refuse to act
///    when its own thresholds disagree — the `signal_desync` case, which
///    otherwise fails silently as a reverted take.
interface IRiskSignalSource {
    /// @notice Whether this strategy should be fleeing to its stable leg right now.
    /// @param strategyHash The maker's order hash, which is the strategy identity.
    function flightRequested(bytes32 strategyHash) external view returns (bool);

    /// @notice The rate band the maker will honour during a flight.
    /// @dev 1e18-scaled ceiling on `stableOut / volatileIn` — the most stable token
    ///      the maker will release per unit of volatile token received. A **lower**
    ///      band is more protective of the maker, which is the direction a flight
    ///      should move: it stops the maker's stablecoin leaving cheaply while the
    ///      book is under stress.
    ///
    ///      Returning zero means "no opinion, use the band compiled into the
    ///      instruction args". That is distinct from "a band of zero", which would
    ///      be unenforceable and is rejected — so the sentinel cannot be confused
    ///      with a value.
    /// @param strategyHash The maker's order hash.
    function maxRateOut(bytes32 strategyHash) external view returns (uint256);

    /// @notice The thresholds the off-chain policy is currently using.
    /// @dev Read back by the policy so a mismatch with its own configuration is
    ///      detectable *before* a take is attempted. Without this the disagreement
    ///      surfaces as an unexplained revert at execution time.
    /// @param strategyHash The maker's order hash.
    /// @return floorApyBps The yield floor the guard was armed with.
    /// @return volCapBps The volatility cap the guard was armed with.
    function thresholds(bytes32 strategyHash) external view returns (uint32 floorApyBps, uint32 volCapBps);
}
