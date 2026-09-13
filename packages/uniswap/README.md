# `@ethonline2026/uniswap`

The Uniswap adapter for the Agentic EMS. It answers one question before anything else: **can this
pool refuse us?**

---

## Where this lives, and why not elsewhere

This was a deliberate placement decision, because the obvious answers are all wrong.

### Not `packages/bridges`

`bridges` moves value **between chains** — CCTP, LayerZero, LI.FI. Its whole vocabulary is a transfer
in flight: `QuoteSource` produces an envelope, `StatusReader` reports whether the value has arrived,
`SOURCE_IDS` is a list of bridge providers. An LP position has no status and is not in flight. Putting
Uniswap there would mean an adapter whose `StatusReader` could never be implemented honestly.

The one shared thing — quoting and building an un-signed transaction — is shared by importing a
protocol-neutral port, which is a different fix from sharing a package.

### Not `packages/execution-domain`

That package is **vocabulary only**: `IntentLeg`, `ExecutionStep`, `ExecutionPlan`, `FeeLine`,
`ExecutionRecord`, and the `ExecutionAdapter` interface itself. It is the contract every venue
implements and contains no venue. Adding Uniswap to it would make every consumer — the indexer, the
dashboard, the agent — depend on Uniswap's ABIs and tick maths to keep compiling, and would break the
"one vocabulary, N implementers" property that makes adding a venue a small change.

### Not inside `packages/oneInch`

This is where the code first went, and moving it out was the point of this exercise. Three reasons:

1. A Uniswap adapter would depend on a **1inch** SDK package to obtain shared types — the coupling
   that makes a package impossible to reuse, or to credit.
2. `@ethonline2026/oneinch-aqua` would carry Uniswap's ABI and tick-math weight under a name that
   says it does not.
3. Discoverability. A Uniswap engineer looking for the Uniswap integration finds
   `@ethonline2026/uniswap`. They do not find a file inside the 1inch package.

### The precedent is already in the repository

`packages/arc` is published as `@ethonline2026/arc-client` — a **protocol-named package for a
protocol integration**. Uniswap follows the same rule.

### What about `packages/order-execution-layer`?

It exists as an empty placeholder, and a generic "execution adapters live here" layer is a coherent
idea. It is not the right choice *here* because it is unrealised and unnamed, and because burying the
Uniswap adapter inside a generic layer forfeits exactly the discoverability that matters for a
protocol integration. If that layer is ever built, it should **host** protocol packages like this one,
not absorb them.

---

## The design: admission before anything else

A v4 pool is a `PoolKey` — two currencies, a fee, a tick spacing, and a **hook**. The hook is the only
field that is arbitrary code the PoolManager calls, and therefore the only field that can say *no*. A
hook can implement an allowlist, require KYC, reject a token, tax a swap, or simply revert.

The rest of a strategy can survive a bad price. It cannot survive a pool that will not accept the
position. So admission is decided before a position is built.

### `address(0)` is the only hook that needs no proof

The PoolManager reads permission bits **out of the hook's own address** before making any call. A zero
hook has none set, so **no external call happens at all** — nothing can refuse, tax or gate. That is a
property of the address, not a claim about code that would have to be audited first. Every pool in the
registry is a zero-hook pool for this reason, and the test asserts it rather than trusting it.

### `swapAccess: "none"` does not mean "cannot block"

Uniswap's official hook registry describes each hook with a `swapAccess` field whose value `none` reads
like "unrestricted". It is not. It means no **access** restriction — no allowlist, no token gate —
while the hook may still be invoked on `beforeAddLiquidity` or `beforeSwap` and revert.

`BunniHook` (`0x000052423c1db6b7ff8641b85a7eefc7b2791888`) declares `swapAccess: "none"` **and** sets
`beforeAddLiquidity` and `beforeSwap`. So admission is decided from the **permission bits**, which say
what will be *called*, and never from `swapAccess`.

### The bit layout is verified against a real hook

`BunniHook`'s address ends `0x1888` = bits 12, 11, 7 and 3. Uniswap declares exactly `afterInitialize`,
`beforeAddLiquidity`, `beforeSwap` and `beforeSwapReturnsDelta` for it — a four-way match, so
`HOOK_PERMISSION_BITS` is pinned against a declaration rather than against documentation.

### Admission is per operation, and "unproven" is not "rejected"

A hook holding only `beforeSwap` is irrelevant to a position that is only added and removed.
`gatesOperation(hook, op)` answers for the operation that matters. When a hook *is* reachable the
verdict is **`unproven`** — meaning the next step is a fork simulation, not a refusal. A hook is not
guilty of gating; it is merely unexamined.

---

## Pools were discovered, not looked up

A v4 pool is identified by a hash of its key, with **no on-chain enumeration** — unlike v3, where each
pool is a deployed contract. Published lists go stale, and a stale key reads as an empty pool, which
is indistinguishable from a pool with no depth.

So `contracts/script/ProbePools.s.sol` asks the chain. It walks the conventional fee/spacing pairs and
reports what answers. On Optimism:

| Pair | fee / spacing | Observed liquidity |
|---|---|---|
| **USDC/DAI** | 0.01% / 1 | 5,423,919,317,274 |
| **USDC/USDT** | 0.01% / 1 | 59,531,253,251 |
| USDC/WETH | 0.05% / 10 | 6,718,133,413,113 |
| USDC/USDT | 0.3% / 60 | 283,565,825 |
| USDC/USDT | 0.05% / 10 | 998 |
| USDC/USDT | 1% / 200 | **0** |

### Depth is not existence

The last two rows are why the probe reports `getSlot0` and `getLiquidity` **separately**. USDC/USDT at
`1%/200` answers with a real price and holds `liquidity == 0`. It is initialised, it would pass a naive
"does this pool exist" check, and it could not absorb a position. Both are asserted as empty in the
fork test, which is the reason they are excluded from the registry.

### A check that the keys are right

USDC/DAI at `0.01%` reports `sqrtPriceX96 = 79254423044247656359974746969157469`. Accounting for
USDC's 6 decimals against DAI's 18, that is DAI ≈ **1.0012 USDC**. A key typed wrong hashes to a pool
that does not exist and reads as zero, so a sensible non-zero price is evidence that the currency
order and the `int24` tick-spacing width are both right.

### The pool id is derived three times

| Where | What it proves |
|---|---|
| `poolId()` in TypeScript | reproduces the ids observed during probing |
| `_poolId()` in the fork test | recomputes them against the pinned constants |
| the PoolManager | resolves those ids to pools holding real depth |

All three must agree before a position is built on one of them.

---

## How it integrates

### Into the execution layer

The package exposes adapters implementing the domain's `ExecutionAdapter`, so `apps/execution` reaches
it the same way it reaches every other venue — through `ExecutionRuntime`, never by a route importing
the adapter directly (that service's own rule).

```
apps/execution
  └─ ExecutionRuntime ── ExecutionAdapter ─┬─ OneInchAquaAdapter   (swap + Aqua/SwapVM order)
                                           ├─ MorphoVaultAdapter    (the stablecoin destination)
                                           └─ UniswapAdapter        (the LP origin leg)   ← this
```

Two roles for the Uniswap adapter, and they are different legs of the same rebalance:

- **Origin.** A strategy earning LP fees holds a v4 position. `V4PositionAdapter` quotes and builds the
  `removeLiquidity` for the flight's first leg.
- **Venue.** The swap that converts the withdrawn assets into a stablecoin can route through a v4 pool,
  which is where `hookAdmission` matters a second time — a swap reaches `beforeSwap`, so a pool that is
  fine to hold may still be unproven to trade through.

Behind a flag, `UNISWAP_ENABLED`, default **off**, mirroring `ONEINCH_AQUA_ENABLED`. Off is a complete
configuration: the service behaves exactly as it did before this venue existed.

### Into the agent

`packages/langchain` gains a `createUniswapTools()` alongside the existing venue tools: read a pool,
check admission, quote `removeLiquidity`, quote the swap. The agent asks "can we enter this pool" and
gets a verdict with a reason, not a boolean.

### Into the `apps/agentic-ems` UI

`packages/ux-workflow` already owns the execution vocabulary — `StepPill` is the single source of the
step states, and `AquaFlightPanel` added the venue panel pattern. The Uniswap surface adds one
component rather than a new vocabulary:

**`UniswapPositionCard`** — pool label, fee tier, tick range, observed depth, and the **admission
verdict** with its reason. The verdict is what is worth showing: "no external call can refuse this
position" is the single most useful sentence a fixed-income operator can read about a v4 pool, and no
existing DEX UI states it. It reuses `StepPill` for leg state and `FeeWaterfall` for the cost split,
so the timeline, the dock and the receipt cannot disagree with it.

---

## Verified

**17 TypeScript tests** — the pool-id derivation against ids observed on-chain, the `BunniHook` bit
layout, per-operation admission, and the registry's exclusion of empty pools.

**5 Foundry fork tests** (`contracts/test/fork/`), green on a live Optimism fork and skipped offline:
the pinned ids resolve to real pools with real depth, the two initialised-but-empty pools are asserted
as empty, and the same currency pair at a different spacing is a different pool.

```
cd contracts && ./install-libs.sh
forge test                                                     # skips, no network
forge test --fork-url $OPTIMISM_RPC_URL                        # 5 pass
```

The Foundry project is deliberately separate from `packages/oneInch/contracts`. That one vendors Aqua
and SwapVM to compile a SwapVM instruction; this one needs only forge-std, because every v4 type it
touches is a stable ABI rather than a dependency. Sharing one project would mean a Uniswap test that
cannot run until a 1inch toolchain is installed.

---

## One thing that should move further

The shared port — `QuoteSource`, `TransactionBuilder`, `UnsignedTransaction`, `RouteHop` — currently
lives in `packages/oneInch/src/port.ts` with `packages/bridges` re-exporting it. That was defensible
when one 1inch adapter existed.

It is not any more. `bridges`, `oneInch` and now `uniswap` all need it, and a Uniswap package that
imports a 1inch package to obtain a protocol-neutral type has the coupling this document argues
against.

The fix is to move it into `packages/execution-domain` as a **new module** — additive, so the existing
vocabulary is unchanged and no consumer breaks — and make both current homes re-export shims, the same
pattern already used for `bridges/src/port.ts`. Its original comment set the condition: *"It moves when
`packages/oneinch` needs the same types."* The condition has been met twice over.

## Not yet built

- `PositionManager.modifyLiquidity` is not encoded, and adding liquidity is not yet simulated end to
  end. Everything admission depends on is verified; the remaining step needs real USDC/DAI balances on
  a fork plus the `modifyLiquidity` + `mint` flow.
- No v3 adapter. v3 positions are ERC-721s behind a per-pool contract with no hook field, so the
  admission problem does not arise; it is a smaller and independent piece of work.
- No signal reader for v4 LP fee yield, which the rebalance policy needs to treat an LP position as a
  yield source rather than only a destination.
