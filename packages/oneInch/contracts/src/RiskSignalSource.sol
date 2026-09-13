// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IRiskSignalSource } from "./instructions/interfaces/IRiskSignalSource.sol";

/// @title RiskSignalSource
/// @notice Stores the flight verdict, the rate band and the armed thresholds.
///
/// @dev ## Who writes, and why it is a single address
///
/// The writer is the agent — the process running the off-chain policy. It is a
/// single immutable address rather than an owner-controlled role, because the
/// verdict *is* the security-relevant state: whoever can set it controls whether a
/// strategy can be taken, and at what price. An upgradable writer would put that
/// behind a governance action mid-incident, which is the wrong latency for a risk
/// control.
///
/// Rotating the agent therefore means deploying a new source and shipping a new
/// program, which is the honest cost of not having a privileged upgrade path. The
/// alternative — a mutable writer — would make the guard only as trustworthy as the
/// least careful key holder.
///
/// ## Why `updatedAt` exists but is not on the interface
///
/// It is deliberately unexposed. A consumer that gated on staleness would need a
/// freshness policy, and a wrong one is worse than none: it either rejects a valid
/// verdict during a quiet period or accepts a stale one during a fast market.
/// Freshness is the off-chain policy's business — it knows when it last ran and what
/// it observed — so this contract records the timestamp for incident review and
/// deliberately holds no opinion about it.
contract RiskSignalSource is IRiskSignalSource {
    /// @notice A strategy's stored signal.
    struct Signal {
        bool flightRequested;
        uint256 maxRateOut;
        uint32 floorApyBps;
        uint32 volCapBps;
        uint64 updatedAt;
    }

    /// @notice Emitted on every write, so the flight history is reconstructable from
    ///         logs alone — which is what makes the demo's audit trail and the evidence
    ///         files verifiable rather than merely asserted.
    /// @dev Parameter names are `requested` and `band` rather than the interface's
    ///      `flightRequested`/`maxRateOut` on purpose: matching those exactly makes the
    ///      compiler warn that a parameter shares a name with a function, and the
    ///      warning is worth avoiding rather than muting — the two *are* different
    ///      things and reading them as one is a real mistake.
    event SignalUpdated(
        bytes32 indexed strategyHash,
        bool requested,
        uint256 band,
        uint32 floorApyBps,
        uint32 volCapBps
    );

    /// @notice The only address permitted to write a signal.
    /// @dev Lowercase by convention here rather than `SCREAMING_SNAKE_CASE`: it is an
    ///      immutably-set role, not a constant, and the linter's note is a style
    ///      preference we are choosing against. Read as state, not as a literal.
    address public immutable agent;

    /// @dev Private with a getter, so a reader cannot mistake the struct for four
    ///      independent storage slots.
    mapping(bytes32 strategyHash => Signal) private _signals;

    error NotAgent(address caller);
    error ZeroAgent();
    error BandWithoutFlight(bytes32 strategyHash);

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent(msg.sender);
        _;
    }

    /// @param agent_ The policy process's address. Zero is refused: it would make the
    ///        contract permanently unwritable, which is indistinguishable from a
    ///        misconfiguration and would freeze every armed band.
    constructor(address agent_) {
        if (agent_ == address(0)) revert ZeroAgent();
        agent = agent_;
    }

    /// @notice Arm the guard: request (or cancel) a flight and set the band.
    /// @param strategyHash The maker's order hash.
    /// @param requested Whether the strategy should flee.
    /// @param band 1e18-scaled ceiling on `stableOut / volatileIn`. Zero means "use
    ///        the band compiled into the instruction args". Must be zero when
    ///        cancelling, because a band with no flight is state that reads as armed
    ///        but does nothing — the kind of residue that makes an incident review
    ///        reach the wrong conclusion.
    /// @param floorApyBps The yield floor this decision was made against.
    /// @param volCapBps The volatility cap this decision was made against.
    function setSignal(
        bytes32 strategyHash,
        bool requested,
        uint256 band,
        uint32 floorApyBps,
        uint32 volCapBps
    ) external onlyAgent {
        // A band of exactly zero is unenforceable and would silently disable the
        // guard, so it is not a legal value — `band == 0` means "no opinion".
        if (!requested && band != 0) revert BandWithoutFlight(strategyHash);

        _signals[strategyHash] = Signal({
            flightRequested: requested,
            maxRateOut: band,
            floorApyBps: floorApyBps,
            volCapBps: volCapBps,
            updatedAt: uint64(block.timestamp)
        });

        emit SignalUpdated(strategyHash, requested, band, floorApyBps, volCapBps);
    }

    /// @notice Cancel a flight.
    /// @dev Its own function because cancelling is the common case and the one an
    ///      operator reaches for under pressure — it should not require remembering
    ///      three threshold arguments.
    function clearSignal(bytes32 strategyHash) external onlyAgent {
        Signal storage stored = _signals[strategyHash];
        stored.flightRequested = false;
        stored.maxRateOut = 0;
        stored.updatedAt = uint64(block.timestamp);
        emit SignalUpdated(strategyHash, false, 0, stored.floorApyBps, stored.volCapBps);
    }

    /// @inheritdoc IRiskSignalSource
    function flightRequested(bytes32 strategyHash) external view returns (bool) {
        return _signals[strategyHash].flightRequested;
    }

    /// @inheritdoc IRiskSignalSource
    function maxRateOut(bytes32 strategyHash) external view returns (uint256) {
        return _signals[strategyHash].maxRateOut;
    }

    /// @inheritdoc IRiskSignalSource
    function thresholds(bytes32 strategyHash) external view returns (uint32, uint32) {
        Signal storage stored = _signals[strategyHash];
        return (stored.floorApyBps, stored.volCapBps);
    }

    /// @notice The full record, for incident review and for the evidence writer.
    function signalOf(bytes32 strategyHash) external view returns (Signal memory) {
        return _signals[strategyHash];
    }
}
