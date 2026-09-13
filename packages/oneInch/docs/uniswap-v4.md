# Uniswap v4: pool admission, and what was verified

## The order of the questions

A v4 pool is a `PoolKey` — two currencies, a fee, a tick spacing, and a **hook**. The hook is the
only field that is arbitrary code the PoolManager calls, so it is the only field that can refuse us:
a hook can implement an allowlist, require KYC, reject a token, tax a swap, or simply revert.

The rest of the flight can survive a bad price. It cannot survive a pool that will not accept the
position. So admission is decided before a position is built, and the registry contains only pools
whose admission needs no argument.

## The one hook that needs no proof

`address(0)`.

The PoolManager reads the permission bits **out of the hook's own address** before making any call, so
a zero hook means no external call happens at all. Nothing can refuse, tax or gate — and that is a
property of the address rather than a claim about code that would have to be audited.

Every pool in `src/uniswap/v4.ts` is a zero-hook pool for that reason, and
`test/uniswapV4.test.ts` asserts it rather than trusting it.

## What "no blocking" has to be measured on

The official Uniswap hook registry describes each hook with a `swapAccess` field whose value `none`
reads like "unrestricted". **It is not.** It means no *access* restriction — no allowlist, no token
gate — while the hook may still be invoked on `beforeAddLiquidity` or `beforeSwap` and revert.

`BunniHook` (`0x000052423c1db6b7ff8641b85a7eefc7b2791888`) declares `swapAccess: "none"` and sets
`beforeAddLiquidity` and `beforeSwap`. So the decision here is made from the **permission bits**, which
say what will be *called*, and never from `swapAccess`.

### The bit layout is verified, not recalled

Its address ends `0x1888`, which is bits 12, 11, 7 and 3. Uniswap declares exactly `afterInitialize`,
`beforeAddLiquidity`, `beforeSwap`, `beforeSwapReturnsDelta` for it. A four-way match on a real hook,
so `HOOK_PERMISSION_BITS` is pinned against a declaration rather than against documentation.

### Admission is per operation, not per hook

A hook holding only `beforeSwap` is irrelevant to a position that is only added and removed, so
rejecting such a pool outright would be needlessly strict. `gatesOperation(hook, op)` answers for the
operation that matters, and returns `unproven` — not `rejected` — when a hook *is* reachable. An
unproven hook is a next step, not a verdict.

## Pools were discovered, not looked up

A v4 pool is identified by a hash of its key and there is no on-chain enumeration — unlike v3, where
each pool is a deployed contract. Published lists go stale, and **a stale key reads as an empty pool,
which looks exactly like a pool with no depth.**

So `script/ProbePools.s.sol` asks the chain: it walks the conventional fee/spacing pairs for a
currency pair and reports which exist. On Optimism it found:

| Pair | fee / spacing | Observed liquidity |
|---|---|---|
| **USDC/DAI** | 0.01% / 1 | 5,423,919,317,274 |
| **USDC/USDT** | 0.01% / 1 | 59,531,253,251 |
| USDC/WETH | 0.05% / 10 | 6,718,133,413,113 |
| USDC/USDT | 0.3% / 60 | 283,565,825 |
| USDC/USDT | 0.05% / 10 | 998 |
| USDC/USDT | 1% / 200 | **0** |

### Depth is not existence

The last two rows are the point. USDC/USDT at `1%/200` answers `getSlot0` with a **real price** and
reports `liquidity == 0`; at `0.05%/10` it reports `998`. Both are initialised, both would pass a
naive "does the pool exist" check, and neither could absorb a position. They are asserted as empty in
`test/fork/UniswapV4Pools.fork.t.sol` — that test is the reason they are excluded.

### A sanity check that the ids are real

USDC/DAI at `0.01%` reports `sqrtPriceX96 = 79254423044247656359974746969157469`. Accounting for
USDC's 6 decimals against DAI's 18, that is DAI ≈ **1.0012 USDC** — a plausible stablecoin price. A
key typed wrong would hash to a pool that does not exist and read as zero, so a sensible non-zero
price is evidence the key, the currency order and the widths are all right.

## The pool id is derived three times

| Where | What it proves |
|---|---|
| `poolId()` in TypeScript | reproduces the ids observed during probing |
| `_poolId()` in the fork test | recomputes them and compares to the pinned constants |
| the PoolManager | resolves those ids to pools that answer with real depth |

All three must agree before a position is built on one of them, and the first two are asserted in
tests while the third is asserted against a live fork.

## The testnet constraint

v4 **is** deployed on testnets; the problem is not availability. A flight's destination needs a
stablecoin market with depth, and testnet pools do not have it — so a testnet flight would produce a
swap with no meaningful counterparty and numbers that mean nothing.

That is why the wiring is verified on a **mainnet fork**, where depth is real, and why a live-testnet
demonstration is better shown as a simulation: quote, plan and calldata all produced and asserted,
with nothing broadcast.

The second difference from a vault: **a position is an NFT over a tick range, not a token**. The
existing `deposit`/`withdraw` hop kinds still describe it, so no new vocabulary, but the encoding is
`PositionManager.modifyLiquidity` with a `PoolKey` — a different path from ERC-4626.

## Not yet done

`PositionManager.modifyLiquidity` is **not** yet encoded, and adding liquidity has not been simulated
end to end. What is verified is everything admission depends on: the pool ids, the depth, and that no
hook can refuse. The remaining step needs real USDC/DAI balances on the fork and the `modifyLiquidity`
+ `mint` flow.
