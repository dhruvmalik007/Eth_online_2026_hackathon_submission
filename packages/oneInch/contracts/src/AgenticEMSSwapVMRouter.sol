// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Context } from "@1inch/swap-vm/contracts/libs/VM.sol";
import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";

import { SwapVM } from "@1inch/swap-vm/contracts/SwapVM.sol";
import { AquaOpcodes } from "@1inch/swap-vm/contracts/opcodes/AquaOpcodes.sol";

import { YieldBandFlight } from "./instructions/YieldBandFlight.sol";

/// @title AgenticEMSSwapVMRouter
/// @notice The canonical Aqua router plus one instruction: `YieldBandFlight`.
///
/// @dev ## This is a *modification*, not a fork
///
/// SwapVM's dispatch is a single virtual function. `SwapVM` declares it with no
/// body; `AquaSwapVMRouter` overrides it to run the Aqua opcode set:
///
/// ```solidity
/// // AquaSwapVMRouter
/// function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
///     _runOpcode(ctx, opcode, args);
/// }
/// ```
///
/// This router does the same thing with one branch in front of it. Everything else —
/// the balances, the curves, the fees, the guards, the settlement, the accounting —
/// is upstream's code, unmodified, reached through the inherited `_runOpcode`. That
/// is the property the prize brief allows ("redeployments of a modified SwapVM
/// contract allowed") and the property that keeps this auditable: the diff against
/// the canonical router is the length of one `if`.
///
/// ## Why a superset matters
///
/// Because the Aqua instruction set is untouched, **every canonical Aqua program
/// still executes on this router at the same opcode**. A strategy shipped for
/// `AquaSwapVMRouter` can be taken against this one and settles identically — the
/// deployment is additive. So adopting the router is not a migration, and reverting
/// to the canonical one is a constructor argument rather than a rewrite.
///
/// ## The failure that has to be loud
///
/// Opcode `0xb3` is unallocated in upstream's `OpcodeList`. On the canonical router a
/// program using it reverts with `UnknownOpcode(0xb3)`; here it runs `YieldBandFlight`.
/// A guard a taker could bypass by pointing at a different router would be worth
/// nothing, so the two behaviours are asserted together in
/// `test/router/OpcodeOwnership.t.sol` — our router runs it, and the canonical router
/// refuses it. A silent fall-through is the one outcome that matters, and those two
/// tests are what rule it out.
contract AgenticEMSSwapVMRouter is Simulator, SwapVM, AquaOpcodes {
    /// @notice Deploy the router.
    /// @dev Constructor-identical to the canonical `AquaSwapVMRouter`, so the only
    ///      difference between the two deployments is the instruction set.
    ///
    ///      The constructor takes an `owner`, which the published SwapVM README
    ///      omits. `Rescuable(owner)` is upstream's safety valve for tokens sent to
    ///      the router by mistake, so leaving it unset would misaddress that role.
    ///      The EIP-712 `name`/`version` are what `packages/custody` signs against
    ///      when a Safe or Ledger owner authorises a *signature-mode* order, so they
    ///      are part of the wire contract rather than cosmetic.
    /// @param aqua The Aqua registry that holds the virtual balances.
    /// @param weth Wrapped native, for `shouldUnwrapWeth` support.
    /// @param owner The address able to rescue tokens sent to the router.
    /// @param name EIP-712 domain name.
    /// @param version EIP-712 domain version.
    constructor(
        address aqua,
        address weth,
        address owner,
        string memory name,
        string memory version
    ) SwapVM(aqua, weth, owner, name, version) {}

    /// @dev The one branch this router adds. Order matters: our opcode is checked
    ///      first, and everything else is delegated unchanged.
    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        if (opcode == uint256(YieldBandFlight.OPCODE)) {
            YieldBandFlight.exec(ctx, args);
            return;
        }
        _runOpcode(ctx, opcode, args);
    }

    /// @notice The opcode this router adds, exposed so a deployment can be verified
    ///         from outside without reading the source.
    /// @dev A view rather than a compile-time constant in the test, because the claim
    ///      being checked is about a *deployed* router, not about a literal.
    function flightOpcode() external pure returns (uint8) {
        return YieldBandFlight.OPCODE;
    }
}
