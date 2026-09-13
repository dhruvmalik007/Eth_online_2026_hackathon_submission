// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

// The upstream entry points everything else in this project builds on.
// Compiling them here is the vendoring check: if the remappings, the pinned solc
// version or the via_ir setting were wrong, this file would not build, and no
// amount of correct code in `src/` would matter.
import { AquaSwapVMRouter } from "@1inch/swap-vm/contracts/routers/AquaSwapVMRouter.sol";
import { SwapVM } from "@1inch/swap-vm/contracts/SwapVM.sol";
import { ISwapVM } from "@1inch/swap-vm/contracts/interfaces/ISwapVM.sol";
import { Context } from "@1inch/swap-vm/contracts/libs/VM.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { AquaApp } from "@1inch/aqua/src/AquaApp.sol";

// Upstream's invariant harness, reached through the `@1inch/swap-vm/` remapping.
// A bare `test/…` import does NOT work here: Foundry drops a `test/=` remapping
// because it collides with this project's own test directory. That is fine —
// nothing in the vendored tree imports a bare `test/` path; every internal import
// is relative, so the prefix form reaches the same file.
import { CoreInvariants } from "@1inch/swap-vm/test/solidity/invariants/CoreInvariants.t.sol";

/// @dev Concretising an abstract upstream base is the honest proof it resolved —
///      `type(X).creationCode` does not exist for an abstract contract.
contract AquaAppProbe is AquaApp {
    constructor(IAqua aqua) AquaApp(aqua) {}
}

/// @dev Pins the exact shape of the one hook `CoreInvariants` leaves open. The
///      real invariant suite implements this against our router; if upstream
///      changed the signature, that suite would fail in a much less obvious way,
///      so the signature is asserted here where the error names itself.
contract CoreInvariantsProbe is CoreInvariants {
    function _executeSwap(
        SwapVM,
        ISwapVM.Order memory,
        address,
        address,
        uint256,
        bytes memory
    ) internal pure override returns (uint256, uint256) {
        revert("CoreInvariantsProbe._executeSwap is never called; it exists to pin the hook signature");
    }
}

/// @notice Proves the vendored dependency tree compiles, links and is inheritable.
/// @dev Deliberately tiny. Its value is that it fails loudly when a dependency is
///      missing, mis-remapped or pinned to the wrong version — a failure that
///      would otherwise surface as a confusing error inside our own contracts.
contract VendoredTest is Test {
    function test_canonicalRouterConstructs() public {
        // The canonical constructor takes an *owner*, which the published README
        // omits — worth pinning, because a redeployment with the wrong arity is
        // the first thing that breaks.
        AquaSwapVMRouter router =
            new AquaSwapVMRouter(makeAddr("aqua"), makeAddr("weth"), address(this), "AgenticEMSSwapVMRouter", "1.0.0");
        assertTrue(address(router) != address(0));
    }

    function test_abstractUpstreamBasesAreInheritable() public {
        // The pattern our own router and Aqua app use, so a change in it should
        // break here rather than inside a contract that matters.
        AquaAppProbe app = new AquaAppProbe(IAqua(makeAddr("aqua")));
        assertEq(address(app.AQUA()), makeAddr("aqua"));
    }

    function test_swapVmContextHasTheRegistersWeComputeAgainst() public pure {
        // `SwapRegisters` has exactly four fields. The published README also
        // mentions an `amountNetPulled`, which does not exist in the code — a
        // reminder to read the source rather than the prose.
        Context memory ctx;
        ctx.swap.balanceIn = 1_000;
        ctx.swap.balanceOut = 2_000;
        ctx.swap.amountIn = 10;
        ctx.swap.amountOut = 20;
        assertEq(ctx.swap.balanceIn + ctx.swap.balanceOut, 3_000);
        assertEq(ctx.swap.amountIn + ctx.swap.amountOut, 30);
    }

    function test_coreInvariantsExposesTheConfigWeWillUse() public pure {
        // `skipMonotonicity` is the escape hatch a fixed-band order needs, so the
        // field's existence is part of what we are vendoring for.
        CoreInvariants.InvariantConfig memory config;
        config.skipMonotonicity = true;
        assertTrue(config.skipMonotonicity);

        assertTrue(type(IAqua).interfaceId != bytes4(0));
    }
}
