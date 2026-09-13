// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { SwapVM } from "@1inch/swap-vm/contracts/SwapVM.sol";
import { AgenticEMSSwapVMRouter } from "../../src/AgenticEMSSwapVMRouter.sol";

/**
 * Pins the order typehash the custodian signs against, from the contract's own constant.
 *
 * `packages/custody/src/safe/swapVmOrder.ts` hardcodes a bytes32 rather than recomputing it, so that a
 * change to the struct upstream is a failing test rather than a silently different digest. This is the
 * other end of that pin: it reads the value off a deployed router, so the two must agree.
 *
 * A mismatch here would mean every signature-mode order the custodian produced was signed over a hash
 * the router never computes — which fails as `BadSignature`, naming neither the typehash nor the field
 * that differs.
 */
contract OrderTypehashTest is Test {
    /// @dev `keccak256("Order(address maker,uint256 traits,bytes data)")`.
    bytes32 internal constant EXPECTED_FROM_CUSTODY =
        0x4ff6e0f284e5bda3bffd2bfd3adc9a8f89d4c787c8be730b8c214c0e10bb3d40;

    function test_orderTypehash_matchesTheCustodyBuilder() public {
        SwapVM router = new AgenticEMSSwapVMRouter(
            address(0xA11CE),
            address(0xBEEF),
            address(this),
            "AgenticEMSSwapVMRouter",
            "1.0.0"
        );

        assertEq(router.ORDER_TYPEHASH(), EXPECTED_FROM_CUSTODY);
    }

    /// @dev The struct string is the source of the hash; a typo in it is the failure mode worth naming.
    function test_orderTypehash_isTheKeccakOfTheDeclaredStruct() public pure {
        assertEq(
            keccak256("Order(address maker,uint256 traits,bytes data)"),
            EXPECTED_FROM_CUSTODY,
            "the struct string changed upstream, so packages/custody's pinned typehash is now stale"
        );
    }
}
