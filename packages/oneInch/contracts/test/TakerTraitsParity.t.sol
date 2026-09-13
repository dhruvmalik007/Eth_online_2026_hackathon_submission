// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { TakerTraitsLib } from "@1inch/swap-vm/contracts/libs/TakerTraits.sol";

/**
 * Pins the TypeScript taker-traits encoder against the contract's own.
 *
 * `packages/oneInch/src/swapvm/takerTraits.ts` reimplements `TakerTraitsLib.build` in TypeScript,
 * because the executor builds calldata off-chain and cannot call this library to do it. Two
 * implementations of one wire format is exactly the arrangement where a mutual misunderstanding
 * survives every test on both sides.
 *
 * So the two are pinned to the *same literal*: this test builds the bytes with the contract's
 * encoder and asserts them against a hex string assembled by hand from the layout, and
 * `test/takerTraits.test.ts` asserts the TypeScript encoder against that identical string. Neither
 * can drift without failing, and neither can pass by agreeing with the other's mistake.
 *
 * The canonical case is deliberately the one the flight needs: exactIn, `aToB`, a 32-byte threshold,
 * a recipient that is not the taker, and the pre-transfer-in callback that makes the Aqua push path
 * work.
 */
contract TakerTraitsParityTest is Test {
    address constant TAKER = 0x2222222222222222222222222222222222222222;
    address constant RECIPIENT = 0x1111111111111111111111111111111111111111;

    /**
     * The same literal as `EXPECTED` in `test/takerTraits.test.ts`.
     *
     * ```
     * 0034 x9 then 0020   slice end offsets: 32, then 52 nine times
     * 0085                flags: isExactIn | hasPreTransferInCallback | isAToB
     * 0000..0001          threshold = 1 as a 32-byte word
     * 1111..1111          recipient, 20 bytes
     * ```
     */
    string constant EXPECTED =
        "0x00340034003400340034003400340034003400200085"
        "0000000000000000000000000000000000000000000000000000000000000001"
        "1111111111111111111111111111111111111111";

    function test_contractEncoder_matchesTheSharedLiteral() public view {
        TakerTraitsLib.Args memory args;
        args.taker = TAKER;
        args.isExactIn = true;
        args.isAToB = true;
        args.threshold = abi.encodePacked(uint256(1));
        args.to = RECIPIENT;
        args.hasPreTransferInCallback = true;

        assertEq(TakerTraitsLib.build(args), vm.parseBytes(EXPECTED));
    }

    /// The header is 22 bytes whatever the slices are, which is what lets `parse` slice blindly.
    function test_headerIsAlways22Bytes() public view {
        TakerTraitsLib.Args memory args;
        args.taker = TAKER;
        args.isExactIn = true;

        bytes memory packed = TakerTraitsLib.build(args);
        assertEq(packed.length, 22);
    }

    /// The contract skips the recipient slice when it is the taker; the encoder must agree, because
    /// including it would shift every later offset by 20 bytes.
    function test_recipientEqualToTakerIsOmitted() public view {
        TakerTraitsLib.Args memory args;
        args.taker = TAKER;
        args.isExactIn = true;
        args.threshold = abi.encodePacked(uint256(1));
        args.to = TAKER;

        // 22 header + 32 threshold, and no recipient slice.
        assertEq(TakerTraitsLib.build(args).length, 54);
    }

    /// A zero deadline is the contract's sentinel for "no deadline", not a deadline of the epoch.
    function test_zeroDeadlineIsOmitted() public view {
        TakerTraitsLib.Args memory args;
        args.taker = TAKER;
        args.isExactIn = true;
        args.deadline = 0;

        assertEq(TakerTraitsLib.build(args).length, 22);

        args.deadline = 1_800_000_000;
        assertEq(TakerTraitsLib.build(args).length, 27);
    }
}
