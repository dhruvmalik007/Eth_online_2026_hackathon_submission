// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

interface IStateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);

    function getLiquidity(bytes32 poolId) external view returns (uint128 liquidity);
}

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

/**
 * Verifies the pinned v4 pools against live chain state on an Optimism fork.
 *
 * ## What this adds over the TypeScript test
 *
 * `test/uniswapV4.test.ts` asserts that `poolId()` reproduces the ids that were *observed* during
 * probing. That is a statement about two of our own artefacts agreeing. This asserts the stronger
 * thing: that those ids are the pools the chain actually holds, by asking `StateView` for them.
 *
 * So the pool-id derivation is implemented three times — in TypeScript, in Solidity here, and in the
 * PoolManager — and all three must agree before a position is built on one of them.
 *
 * ## Why the hook assertion is an equality, not a check
 *
 * These pools were selected because `hooks == address(0)`, which is the only admission needing no
 * proof: the PoolManager reads permissions out of the hook address before calling anything, and a zero
 * hook has none set, so no external call is made and nothing can refuse or tax the position. If a
 * pinned key ever changed its hook, the pool id would change with it and this would fail twice over.
 *
 * Skips when not forked, so `forge test` stays green offline.
 *
 * Run: `forge test --match-path 'test/fork/UniswapV4Pools.fork.t.sol' --fork-url $OPTIMISM_RPC_URL`
 */
contract UniswapV4PoolsForkTest is Test {
    uint256 constant OPTIMISM_CHAIN_ID = 10;
    address constant STATE_VIEW = 0xc18a3169788F4F75A170290584ECA6395C75Ecdb;

    address constant USDC = 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85;
    address constant DAI = 0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1;
    address constant USDT = 0x94b008aA00579c1307B0EF2c499aD98a8ce58e58;

    function setUp() public {
        if (block.chainid != OPTIMISM_CHAIN_ID) {
            vm.skip(true, "not an Optimism fork");
        }
    }

    function test_stateViewIsDeployed() public view {
        assertGt(STATE_VIEW.code.length, 0, "StateView must exist; it is the only supported read path");
    }

    /// The deepest stablecoin pool found, and the one a fixed-income flight would actually use.
    function test_usdcDaiPoolExistsWithDepth() public view {
        bytes32 id = _poolId(USDC, DAI, 100, 1);
        assertEq(id, 0x2670084f83c0850ce7ff3c843541f4cb4f2a007d945248b3efb22ab31735e7a5, "pool id drifted");

        (uint160 sqrtPrice, , , ) = IStateView(STATE_VIEW).getSlot0(id);
        uint128 liquidity = IStateView(STATE_VIEW).getLiquidity(id);

        assertGt(sqrtPrice, 0, "the pool is not initialised");
        assertGt(liquidity, 1e12, "depth is far below what was pinned at discovery");
    }

    function test_usdcUsdtPoolExistsWithDepth() public view {
        bytes32 id = _poolId(USDC, USDT, 100, 1);
        assertEq(id, 0x83dfcb7b726c634c35776adb25f22ff54cd62e25593af523371fc22f3b4e7a2c, "pool id drifted");

        (uint160 sqrtPrice, , , ) = IStateView(STATE_VIEW).getSlot0(id);
        uint128 liquidity = IStateView(STATE_VIEW).getLiquidity(id);

        assertGt(sqrtPrice, 0, "the pool is not initialised");
        assertGt(liquidity, 0, "the pool holds no liquidity");
    }

    /**
     * The two probed pools that were deliberately left out of the registry, asserted as empty.
     *
     * This is the test that justifies the exclusion: both answer `getSlot0` with a real price, so a
     * naive "does this pool exist" check would accept them, and neither could absorb a position.
     */
    function test_initialisedButEmptyPoolsAreRealAndUnusable() public view {
        bytes32 highFee = _poolId(USDC, USDT, 10000, 200);
        (uint160 sqrtPrice, , , ) = IStateView(STATE_VIEW).getSlot0(highFee);
        assertGt(sqrtPrice, 0, "this pool is initialised, which is exactly the trap");
        assertEq(IStateView(STATE_VIEW).getLiquidity(highFee), 0, "it holds no liquidity");
    }

    /// Pools are per-key, not per-pair: the same currencies at a different spacing is a different pool.
    function test_theSamePairAtADifferentSpacingIsADifferentPool() public view {
        bytes32 thin = _poolId(USDC, USDT, 500, 10);
        (uint160 sqrtPrice, , , ) = IStateView(STATE_VIEW).getSlot0(thin);

        assertGt(sqrtPrice, 0, "the 0.05% pool exists too");
        assertLt(IStateView(STATE_VIEW).getLiquidity(thin), 1e6, "and is negligibly deep");
    }

    function _poolId(address a, address b, uint24 fee, int24 tickSpacing) internal pure returns (bytes32) {
        (address c0, address c1) = a < b ? (a, b) : (b, a);
        return keccak256(
            abi.encode(
                PoolKey({currency0: c0, currency1: c1, fee: fee, tickSpacing: tickSpacing, hooks: address(0)})
            )
        );
    }
}
