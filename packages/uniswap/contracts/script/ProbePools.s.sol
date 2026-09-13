// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console2 } from "forge-std/Script.sol";

/// @dev The v4 read path. `StateView` exists precisely so off-chain callers do not have to
///      hand-compute `extsload` slots, which differ by field width and are easy to get subtly wrong.
interface IStateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);

    function getLiquidity(bytes32 poolId) external view returns (uint128 liquidity);
}

/// @notice A PoolKey must match v4's struct exactly, field for field and width for width.
/// @dev `tickSpacing` is `int24`, not `uint24`. A key that differs in any field hashes to a
///      different id and reads as a pool that does not exist — which is indistinguishable from a
///      pool with no liquidity, unless you check `sqrtPriceX96` separately as this script does.
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

/**
 * Discovers which Uniswap v4 pools actually exist and hold liquidity on a chain.
 *
 * ## Why probe rather than look them up
 *
 * A v4 pool is identified by a `keccak256` of its `PoolKey`, and there is no on-chain enumeration —
 * unlike v3, where each pool is a deployed contract you can find. Published pool lists go stale, and
 * a stale key reads as an empty pool, which looks exactly like a pool with no depth.
 *
 * So this asks the chain. It walks the plausible keys for a pair and reports the ones that answer:
 * a non-zero `sqrtPriceX96` means the pool was initialised, and `getLiquidity` is its real depth.
 * The two are reported separately because "initialised but empty" is a common and misleading state.
 *
 * ## Why the hook is pinned to zero here
 *
 * `address(0)` is the only hook whose behaviour is knowable without reading its source: the
 * PoolManager makes no external call at all, so nothing can refuse, tax or gate the position. A
 * non-zero hook might be perfectly open, but proving that means reading its code, so discovery
 * starts from the set that needs no proof.
 *
 * Run: `forge script script/ProbePools.s.sol --fork-url $OPTIMISM_RPC_URL`
 */
contract ProbePools is Script {
    /// @dev Optimism. Polygon's is `0x5ea1bd7974c8a611cbab0bdcafcb1d9cc9b3ba5a`.
    address constant STATE_VIEW = 0xc18a3169788F4F75A170290584ECA6395C75Ecdb;

    address constant USDC = 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDT = 0x94b008aA00579c1307B0EF2c499aD98a8ce58e58;
    address constant DAI = 0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1;

    function run() external {
        _probe("USDC/WETH", USDC, WETH);
        _probe("USDC/USDT", USDC, USDT);
        _probe("USDC/DAI", USDC, DAI);
    }

    function _probe(string memory label, address a, address b) internal {
        (address c0, address c1) = a < b ? (a, b) : (b, a);

        // The fee/tickSpacing pairs v4 treats as conventional. A custom spacing requires the
        // pool's own fee flags, which a conventional key cannot express.
        uint24[4] memory fees = [uint24(100), 500, 3000, 10000];
        int24[4] memory spacings = [int24(1), 10, 60, 200];

        for (uint256 i = 0; i < 4; i++) {
            bytes32 poolId = _poolId(c0, c1, fees[i], spacings[i]);
            (uint160 sqrtPrice,,,) = IStateView(STATE_VIEW).getSlot0(poolId);

            // Reported separately from liquidity: an initialised pool with no liquidity is a very
            // different finding from a pool that was never created, and `getLiquidity` alone cannot
            // tell them apart.
            if (sqrtPrice == 0) continue;

            uint128 liquidity = IStateView(STATE_VIEW).getLiquidity(poolId);
            console2.log("FOUND", label);
            console2.log("  fee / spacing", uint256(fees[i]), uint256(uint24(spacings[i])));
            console2.log("  poolId   ", vm.toString(poolId));
            console2.log("  sqrtPrice", uint256(sqrtPrice));
            console2.log("  liquidity", uint256(liquidity));
            console2.log("  hooks    ", address(0));
        }
    }

    function _poolId(address c0, address c1, uint24 fee, int24 tickSpacing) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PoolKey({currency0: c0, currency1: c1, fee: fee, tickSpacing: tickSpacing, hooks: address(0)})
            )
        );
    }
}
