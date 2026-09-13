// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { Context } from "@1inch/swap-vm/contracts/libs/VM.sol";
import { IRiskSignalSource } from "./interfaces/IRiskSignalSource.sol";

/// @title YieldBandFlight — a rate-band guard for a strategy in flight
/// @notice When the risk signal says a strategy is fleeing to its stable leg, clamp
///         the rate to the band the maker is willing to honour. When it says
///         nothing, this instruction does nothing at all.
///
/// @dev ## What this instruction is, in one sentence
///
/// It is the on-chain half of a decision made off-chain: it takes a verdict that
/// lives in `IRiskSignalSource` and turns it into a *price constraint* that a taker
/// cannot route around, because it is in the program's bytecode.
///
/// ## Opcode 0xb3, and why that number
///
/// SwapVM's opcode space is banked by instruction family, and the layout is
/// documented in `contracts/libs/OpcodeList.sol`:
///
///   0x00-0x0f core control flow · 0x20-0x3f guards · 0x40-0x4f invalidators
///   0x50-0x6f swap curves · 0x70-0x8f fees · 0x90-0xaf balances tuning
///   0xb0-0xcf **rates tuning** · 0xd0-0xef unallocated · 0xf0-0xff reserved
///
/// An exchange-rate constraint belongs in the rates-tuning bank, whose occupied
/// slots are 0xb0 (`RequireMinRate`), 0xb1 (`AdjustMinRate`), 0xb2
/// (`OraclePriceAdjuster`) and 0xb4 (`BaseFeeAdjuster`). **0xb3** is the next free
/// slot in that family, which is what the file's own guidance asks for: "For new
/// instructions take the next free `_Ix` slots of their family bank."
///
/// The reserved bank (0xf0-0xff) is deliberately avoided — upstream holds those for
/// a possible two-byte opcode escape prefix, and a program that spent one would
/// break the day that lands.
///
/// **This opcode is only meaningful on `AgenticEMSSwapVMRouter`.** On the canonical
/// `AquaSwapVMRouter` it falls through to `UnknownOpcode(0xb3)` and reverts. That is
/// the failure we want: loud, specific, and impossible to mistake for a successful
/// swap at an unguarded price. A silently-ignored guard would be far worse than a
/// revert, because the whole point is that the taker cannot skip it.
///
/// ## Instruction order is security-critical, and this one must come last
///
/// The core warning in SwapVM's own README applies here with full force: *"the same
/// instructions in a different order can change strategy behavior"*. This
/// instruction **reads amounts that a swap curve produced and then writes them
/// back**, so placing it before `XYCSwap` would let the curve overwrite the clamp —
/// the guard would appear in the program, appear in the logs, and do nothing.
///
/// So the program layout this instruction is built for is:
///
///   [balances] → [swap curve: XYCSwap / concentrate] → [**YieldBandFlight**] → [invalidator]
///
/// `YieldBandFlightAfterCurve.t.sol` asserts that ordering rather than trusting this
/// comment, because the failure mode is invisible in a passing happy-path test.
///
/// ## Direction: a *lower* band protects the maker
///
/// `maxRateOut` is a 1e18-scaled ceiling on `stableOut / volatileIn`. A flight means
/// the maker's stablecoin should not leave cheaply, so the band is a ceiling on what
/// the taker may extract — not a floor on what the maker receives. Every rounding
/// step goes the maker's way:
///
/// - **exactIn** (taker fixes the volatile amount): `cap = ceil-free` division, i.e.
///   the cap rounds *down*, so the taker receives marginally less.
/// - **exactOut** (taker fixes the stable amount): the required volatile input rounds
///   *up*, so the taker pays marginally more.
///
/// That matches SwapVM's own invariant: "all rounding operations must favor Maker".
///
/// ## What it deliberately does not do
///
/// It does not read a price oracle, does not consult an AMM, and does not decide
/// anything about yield or volatility. Those are off-chain inputs. This instruction
/// does one thing — turn a verdict and a band into a bounded price — and it is small
/// enough to be read in full, which is the property that makes it auditable.
library YieldBandFlight {
    /// @dev See the header: next free slot in the rates-tuning bank (0xb0-0xcf).
    uint8 internal constant OPCODE = 0xb3;

    /// @dev The band is 1e18-scaled, matching SwapVM's own fixed-point convention
    ///      for rates (`RequireMinRate`, `PeggedSwap`).
    uint256 internal constant ONE = 1e18;

    /// @notice Compiled configuration.
    /// @param riskSource The signal contract. `address(0)` means "always apply the
    ///        band", which is the mode used when a strategy has a fixed policy and
    ///        no agent in the loop.
    /// @param maxRateOut The fallback band: a 1e18-scaled ceiling on
    ///        `stableOut / volatileIn`. Used when the source has no opinion. Zero
    ///        means "no band", so the instruction becomes a no-op rather than an
    ///        unenforceable constraint.
    struct Args {
        address riskSource;
        uint256 maxRateOut;
    }

    /// @notice The clamped output would exceed the maker's safe balance.
    /// @dev A named error, not a bare `require`, because this is the one failure a
    ///      taker can trigger legitimately — the maker's band is real and the
    ///      liquidity behind it is finite. An incident review needs to tell that
    ///      apart from a malformed order.
    error InsufficientSafeLiquidity(uint256 amountOut, uint256 balanceOut);

    /// @notice Encoded args must be exactly two words.
    error MalformedArgs(uint256 length);

    // ─── Encoding ────────────────────────────────────────────────────────────
    // The wire format is SwapVM's, and it is two bytes plus the payload:
    //
    //   [opcode: 1 byte][argsLength: 1 byte][args: argsLength bytes]
    //
    // `ContextLib.runLoop` reads those two header bytes with `shr(248, word)` and
    // `shr(240, word) & 0xff`, so getting them right is not optional. The payload is
    // plain `abi.encode` rather than upstream's `InstructionBuilder`/`InstructionArgs`
    // helpers: the header is two bytes of arithmetic, and owning it here means the
    // TypeScript coder in `packages/oneInch/src/instructions/` can be byte-compared
    // against this function without either side depending on a builder version.

    /// @notice Encoded size in bytes: the two-byte header plus two 32-byte words.
    function sizeOf() internal pure returns (uint256) {
        return 2 + 64;
    }

    /// @notice Compile args into program bytecode.
    function build(Args memory args) internal pure returns (bytes memory) {
        bytes memory payload = abi.encode(args);
        return abi.encodePacked(OPCODE, uint8(payload.length), payload);
    }

    /// @notice Decode the payload back into args.
    function parse(bytes calldata args) internal pure returns (Args memory) {
        return abi.decode(args, (Args));
    }

    // ─── Execution ───────────────────────────────────────────────────────────

    /// @notice Apply the band if the signal asks for it. Writes `ctx.swap` only.
    /// @dev Read-only with respect to `ctx.query`, as every instruction must be.
    function exec(Context memory ctx, bytes calldata args) internal view {
        if (args.length != 64) revert MalformedArgs(args.length);
        Args memory config = parse(args);

        uint256 band = _resolveBand(ctx, config);
        // No flight, or no band to enforce. Returning rather than reverting is
        // deliberate: this instruction sits in the program of an otherwise ordinary
        // AMM order, and a strategy that is not fleeing must keep trading normally.
        if (band == 0) return;

        if (ctx.query.isExactIn) {
            // The taker fixed the volatile input, so the band caps the stable output.
            // Division rounds down, which is the maker-favouring direction.
            uint256 cap = Math.mulDiv(ctx.swap.amountIn, band, ONE);
            if (ctx.swap.amountOut > cap) ctx.swap.amountOut = cap;
        } else {
            // The taker fixed the stable output, so the band sets the minimum volatile
            // input. `Math.Rounding.Ceil` makes that minimum round up, again favouring
            // the maker.
            uint256 requiredIn = Math.mulDiv(ctx.swap.amountOut, ONE, band, Math.Rounding.Ceil);
            if (ctx.swap.amountIn < requiredIn) ctx.swap.amountIn = requiredIn;
        }

        // The clamp only ever moves the output down, but a band below the curve's
        // implied rate can still ask for more liquidity than the maker shipped. That
        // is a real condition rather than a bug, so it fails with its own name.
        if (ctx.swap.amountOut > ctx.swap.balanceOut) {
            revert InsufficientSafeLiquidity(ctx.swap.amountOut, ctx.swap.balanceOut);
        }
    }

    /// @notice The band to enforce: the source's opinion first, the compiled fallback
    ///         otherwise, and nothing at all when neither has one.
    /// @dev A separate function so the precedence rule is testable in isolation —
    ///      it is the kind of rule that is easy to get subtly backwards, and a
    ///      backwards version would either ignore the agent or ignore the default.
    function _resolveBand(Context memory ctx, Args memory config) private view returns (uint256) {
        if (config.riskSource == address(0)) {
            // No source: the compiled band is the policy. An order with neither is a
            // no-op, which is the safe reading of an unconfigured guard.
            return config.maxRateOut;
        }

        IRiskSignalSource source = IRiskSignalSource(config.riskSource);
        if (!source.flightRequested(ctx.query.orderHash)) return 0;

        uint256 fromSource = source.maxRateOut(ctx.query.orderHash);
        // Zero from the source means "no opinion", so the compiled band applies. That
        // is why the interface documents zero as a sentinel rather than as a value:
        // a literal band of zero would be unenforceable and is refused at the writer.
        return fromSource == 0 ? config.maxRateOut : fromSource;
    }
}
