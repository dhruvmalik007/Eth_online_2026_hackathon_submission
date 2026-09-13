// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { XYCSwap } from "@1inch/swap-vm/contracts/instructions/XYCSwap.sol";
import { Salt } from "@1inch/swap-vm/contracts/instructions/Controls.sol";
import { YieldBandFlight } from "../../src/instructions/YieldBandFlight.sol";

/**
 * Pins the TypeScript program builder against the contract libraries that build the same bytes.
 *
 * `packages/oneInch/src/programs/builder.ts` frames instructions as
 * `[opcode][argsLength][args]` so the TypeScript layer can produce a strategy without a Solidity
 * round trip. That makes two independent implementations of one wire format, which is exactly the
 * situation where a mutual misunderstanding survives every test on both sides — neither can fail,
 * because each agrees with the other's mistake.
 *
 * So both are asserted against the same literal, produced by hand rather than by either.
 *
 * A mismatch here would mean a program that executes correctly in a Foundry test and mis-executes when
 * a caller assembles it off-chain: the opcode boundary lands one byte out, and `runLoop` reads an
 * opcode that is really an argument.
 */
contract ProgramBuilderParityTest is Test {
    /// @dev The bytes `builder.ts` produces for `xycSwap ++ yieldBandFlight ++ salt(1)`.
    function _expected() internal pure returns (bytes memory) {
        return
            abi.encodePacked(
                // XYCSwap: opcode 0x50, no arguments.
                hex"5000",
                // YieldBandFlight: opcode 0xb3, 0x40 = 64 bytes of arguments.
                hex"b340",
                // abi.encode(address riskSource, uint256 maxRateOut = 3_400_000_000)
                hex"0000000000000000000000001111113ccf1426a8e30e2bff5e005d929bf6a90a",
                hex"00000000000000000000000000000000000000000000000000000000caa7e200",
                // Salt: opcode 0x02, 8 bytes of arguments.
                hex"0208",
                hex"0000000000000001"
            );
    }

    function test_programBytes_matchTheTypeScriptBuilder() public pure {
        bytes memory program = bytes.concat(
            XYCSwap.build(),
            YieldBandFlight.build(
                YieldBandFlight.Args({
                    riskSource: 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a,
                    maxRateOut: 3_400_000_000
                })
            ),
            Salt.build(uint64(1))
        );

        assertEq(program, _expected());
    }

    /// @dev Total length is the sum of the parts, which is what makes the boundaries land where the
    ///      TypeScript side assumes they do.
    function test_programBytes_areSeventyEightBytes() public pure {
        assertEq(_expected().length, 78);
    }

    /// @dev The clamp must follow the curve: a clamp placed before `XYCSwap` reads the taker's amounts,
    ///      not the curve's, so it would bound the input instead of the output.
    function test_instructionOrder_isCurveThenClamp() public pure {
        bytes memory program = bytes.concat(
            XYCSwap.build(),
            YieldBandFlight.build(
                YieldBandFlight.Args({
                    riskSource: 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a,
                    maxRateOut: 3_400_000_000
                })
            )
        );

        // First byte is the curve; the clamp's opcode appears after its two-byte header and no args.
        assertEq(uint8(program[0]), 0x50);
        assertEq(uint8(program[2]), 0xb3);
    }

    function test_saltOpcode_isTwo() public pure {
        bytes memory built = Salt.build(uint64(1));
        assertEq(uint8(built[0]), 0x02);
        assertEq(uint8(built[1]), 0x08);
    }
}
