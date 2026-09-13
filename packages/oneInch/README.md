# `@ethonline2026/oneinch-aqua`

The 1inch **Aqua + SwapVM** execution layer for the Agentic EMS, and the submission for
ETHOnline 2026 **Track 5.1 — Build an Aqua App**.

It implements a fixed-income flight rule: when a strategy's realised yield falls under a
floor, or its realised volatility breaches a cap, the volatile leg is swapped into a
stablecoin through a **SwapVM program containing an instruction we define and deploy**,
and the stablecoin is deployed into a **Morpho vault**.

**Scope: Optimism and Polygon.** Those are the only chains expressible in
`@ethonline2026/execution-domain` (`CHAIN_KEYS = ["base", "polygon", "optimism"]`), whose
`IntentLeg`, `ExecutionStep` and `ExecutionRecord` all carry a `ChainKey`. Ethereum and Arbitrum
were verified during this work and are preserved in
[`docs/reference-verified-addresses.md`](./docs/reference-verified-addresses.md) rather than
carried as entries nothing downstream can address. `packages/bridges` already covers large-order
1inch routing on the wider chain set, so this is a complement to it.

---

## Status

Honest, because the gap between "written" and "verified" is the only thing that matters here.

| Piece | State | Evidence |
|---|---|---|
| Chain registry (Optimism + Polygon, every address with provenance) | **verified** | WETH `symbol()`/`decimals()` read on-chain on both; `test/chains.test.ts` (18) |
| Protocol registry (top 2 × 5 categories) | **verified** | drift-tested against `packages/the-graph`; `test/protocolRegistry.test.ts` (14) |
| Morpho vault layer (ERC-4626 read, judge, rank) | **verified** | `test/vaults.test.ts` (14) |
| Flight policy (yield floor, vol cap, drift, vault choice) | **verified** | `test/policy.test.ts` (23) |
| Capability port relocated from `packages/bridges` | **verified** | `bridges`' own 25 tests pass through the re-export shim |
| `YieldBandFlight` instruction (opcode `0xb3`) | **verified** | 9 unit + 6 invariant tests, exact clamped amounts |
| Custom router + opcode ownership | **verified** | our router runs it, canonical router reverts `UnknownOpcode(0xb3)` |
| `RiskSignalSource` | **verified** | exercised through the instruction tests |
| `StablecoinRefugeApp` | **verified** | 8 tests, including the relayer trust boundary |
| SwapVM order encoding (Aqua, maker side) | **verified** | traits word checked against the bit layout; hash checked against a hand-assembled `abi.encode` |
| `apps/fork-execution` — Anvil lifecycle, pinned forks, evidence writer, `deploy` | **verified** | `smoke` **17/17 on both chains**; `deploy` re-verifies each address from the broadcast artifact |
| The flight scenario | **verified** | 1 WETH → **exactly 3,400 USDC** (the band), `quote == swap`, real token deltas, real vault shares, on a live fork |
| Enablement at simulation and approval | **verified** | `assessEnablement` + 13 tests, `GET /aqua/enablement`, and `AquaFlightPanel` in `ux-workflow` |
| Registry verified against real chain state | **verified** | every address has code; USDC/WETH symbols match; the Optimism vault holds $833k of USDC |
| `MorphoVaultAdapter` (ERC-4626 deposit / redeem) | **verified** | 21 tests, incl. that its fee line is a `bound` so `sumWalletCost` stays 0 |
| `OneInchAquaAdapter` (`ExecutionAdapter`) | **verified** | 147 tests; `quote` / `buildPlan` / `submit` / `toRecord` |
| SwapVM program builder (`src/programs/builder.ts`) | **verified** | byte-for-byte against a Solidity-built program of the same instructions |
| Aqua + SwapVM clients (`src/aqua`, `src/swapvm`) | **verified** | calldata for ship/dock/pull/push, quote/hash reads, and log decoding |
| Receipt mapping (`src/adapter/receipt.ts`) | **verified** | our steps onto `ExecutionStep`/`ExecutionRecord`, with `status` derived rather than passed |
| Agent tools (`packages/langchain/src/tools/aqua`) | **verified** | 4 Aqua tools **registered in the agent**, plus `risk_chain_report` and the previously dead `createRiskTools` — 42 tools assembled, asserted by `test/agentToolRegistration.test.ts` |
| Wiring — `custody` kinds, `langchain` leg kinds, the `apps/execution` flag and enablement route | **partial** | kinds and the route are in; the executor routes still answer `UNAVAILABLE` |

Counts: **29 Foundry tests**, **131 TypeScript tests**, **25 bridge tests**, **24/24 packages
typecheck**, and two committed evidence artifacts from real forks.

---

## Running it

```bash
# contracts — no network needed
cd packages/oneInch/contracts
./install-libs.sh          # one-time, vendored from source; see lib.lock
forge test

# TypeScript
pnpm --filter @ethonline2026/oneinch-aqua test
pnpm --filter @ethonline2026/oneinch-aqua typecheck

# the fork harness — doctor needs no RPC, so it is safe on a fresh clone
cd apps/fork-execution
pnpm run doctor            # toolchain, which chains are configured, unresolved values

export OPTIMISM_RPC_URL=https://…        # any provider
export OPTIMISM_FORK_BLOCK=…             # optional but recommended: evidence records it
pnpm run smoke -- --chain optimism       # boots a pinned fork, verifies every registered
                                        # address, sends nothing, writes evidence/
```

`pnpm doctor` is pnpm's own built-in command — use `pnpm run doctor` for this one.

`install-libs.sh` downloads tarballs rather than using `forge install`, on purpose: forge's
installer writes git submodules, which would modify `.gitmodules` and the index of the
repository this work sits inside. The vendored trees carry no git metadata and `lib/` is
ignored.

---

## Architecture

Two Aqua apps, deliberately separate — conflating them is the easiest mistake to make:

```
                       ┌──────────────────────────────────────────┐
  maker ships ────────▶│ AgenticEMSSwapVMRouter                   │
  aqua.ship(router,    │   SwapVM + AquaOpcodes + YieldBandFlight │
    order.encode())    │   a SwapVM position                      │
                       └──────────────────────────────────────────┘
                                        ▲ taker fills via swap()

                       ┌──────────────────────────────────────────┐
  maker ships ────────▶│ StablecoinRefugeApp                      │
  aqua.ship(app, ...)  │   no pricing logic at all                │
                       │   one call releases both legs to maker   │
                       └──────────────────────────────────────────┘
```

- **`AgenticEMSSwapVMRouter`** is where the SwapVM strategy lives. In SwapVM's Aqua mode the
  app argument to `Aqua.ship` *is* the router.
- **`StablecoinRefugeApp`** exists so an exit is atomic. The flight is a two-step intent —
  swap, then deposit — and if the position could only be released by signing two
  transactions, the window between them is a window of half-executed risk.

### The flight

```
signals ──▶ decideFlight ──▶ HOLD | REBALANCE | FLIGHT_TO_STABLE
              (pure)                    │
                                        ├─ swapvm-take   → router.swap(order, …)
                                        └─ vault-deposit → vault.deposit(assets, maker)
```

`decideFlight` is pure: no client, no clock, no network. The order matters and each branch
carries a reason code, because *why* a book held changes what an operator does about it.

### The instruction

`YieldBandFlight` is the on-chain half of a decision made off-chain. It reads a verdict from
`IRiskSignalSource` and turns it into a **price constraint in the program's bytecode**, which
a taker cannot route around:

```
[balances] → [swap curve] → [YieldBandFlight] → [invalidator]
```

It must come **after** the curve: it reads amounts the curve produced and writes them back, so
placing it before would let the curve overwrite the clamp — a guard that appears in the program,
appears in the logs, and does nothing.

---

## Opcode `0xb3`

SwapVM's opcode space is banked by instruction family (`contracts/libs/OpcodeList.sol`):

| Bank | Family | Occupied |
|---|---|---|
| `0x00-0x0f` | core control flow | Stop, Revert, Salt, Jump, Extruction |
| `0x20-0x3f` | conditions and guards | Deadline, balance validators, conditional jumps |
| `0x40-0x4f` | invalidators | InvalidateBit / TokenIn / TokenOut |
| `0x50-0x6f` | swap curves | XYCSwap, XYCConcentrateSwap, LimitSwap, PeggedSwap |
| `0x70-0x8f` | fees | FeeFlatIn / Out, FeeProtocol |
| `0x90-0xaf` | balances tuning | StaticBalances, DynamicBalances, Decay |
| `0xb0-0xcf` | **rates tuning** | `0xb0` RequireMinRate · `0xb1` AdjustMinRate · `0xb2` OraclePriceAdjuster · **`0xb3` ours** · `0xb4` BaseFeeAdjuster |
| `0xd0-0xef` | unallocated | — |
| `0xf0-0xff` | **reserved** | deliberately avoided — upstream holds it for a possible two-byte escape prefix |

`0xb3` is the next free slot in the family an exchange-rate constraint belongs to, which is what
the file's own guidance asks for.

**Only our router dispatches it.** On the canonical `AquaSwapVMRouter` the same program reverts
`UnknownOpcode(0xb3)`. That is the failure we want, and it is asserted in both directions —
`test_ourRouterRunsOpcode0xb3` and `test_canonicalRouterRefusesOpcode0xb3` — because a guard a
taker could sidestep by pointing at a different router would be worth nothing, and a silent
misinterpretation of an upstream opcode would be worse than nothing.

### Rounding favours the maker

`maxRateOut` is a 1e18-scaled **ceiling** on `stableOut / volatileIn`. A flight means the maker's
stablecoin should not leave cheaply, so the band caps what a taker may extract:

| Direction | Operation | Rounding |
|---|---|---|
| `exactIn` | `amountOut = min(amountOut, amountIn × band / 1e18)` | floor — taker gets marginally less |
| `exactOut` | `amountIn = max(amountIn, ceil(amountOut × 1e18 / band))` | ceil — taker pays marginally more |

Both directions are asserted with values that do not divide evenly, because a ceiling in the
first case is extractable one wei at a time.

### Precedence

The source's band wins; the compiled band applies when the source has no opinion; nothing is
enforced when neither has one. `maxRateOut == 0` is the "no opinion" sentinel, which is why
`RiskSignalSource.setSignal` refuses to store a band behind a cancelled flight.

---

## Findings worth knowing

These are things the code disagrees with the docs about, or that cost real debugging time.

1. **`@1inch/swap-vm` and `@1inch/aqua` are not on npm** (the registry 404s), despite npm badges
   and `npm install` instructions in both READMEs. The Solidity must come from source. The
   *TypeScript* SDKs do exist (`@1inch/swap-vm-sdk`, `@1inch/aqua-sdk`).
2. **The published README is wrong in three places**: `SwapRegisters` has four fields, not the
   five the README describes (no `amountNetPulled`); the `SwapVM` constructor takes an `owner`
   (five arguments, not four); and the deployed Aqua router supports only the Aqua opcode subset.
3. **`Aqua.ship` and `Aqua.dock` credit `msg.sender` as the maker.** An app that proxies either
   call records *itself* as the maker, and every later `pull` silently finds a zero balance. This
   is why `StablecoinRefugeApp` exposes no `ship`/`dock` wrapper, and it is pinned as
   `test_aquaCreditsTheCallerAsMaker_notTheApp`.
4. **Foundry drops a `test/=` remapping** — it collides with the project's own `test/`
   directory. Upstream's harness is reachable through `@1inch/swap-vm/test/…` instead, which works
   because nothing in the vendored tree imports a bare `test/` path.
5. **`CoreInvariants` has an abstract `_executeSwap` hook** and, in this revision, no
   `_signAndPackTakerData` helper — so its config wants taker-data blobs it cannot build. The
   invariants are therefore asserted directly (`test/YieldBandFlightInvariants.t.sol`), which is
   cheaper anyway because every SwapVM quote is a static call.
6. **`execution-domain`'s `CHAIN_KEYS` is `["base", "polygon", "optimism"]`**, so only
   **optimism and polygon** intersect this package's four chains. `ethereum` and `arbitrum` cannot
   be expressed in an `IntentLeg`, an `ExecutionStep` or an `ExecutionRecord`. This is a
   constraint of the existing domain, not of this package, and it decides which chains can be
   demoed through the service.
7. **A Morpho `totalAssets`-ordered query is not safe to consume.** The top USDC vaults include
   entries named `Test`, `usdc staging` and `Duplicated Key`, vaults holding zero assets, and
   vaults reporting **297,995% APY**. That is why vaults are curated and then verified, and why
   the plausibility bound is load-bearing rather than defensive.
8. **`abi.encode` of a single dynamic tuple starts with an outer offset word.** Hand-assembling
   the encoding one word short is easy; the order-hash test caught exactly that.
9. **viem decodes an `address` to its checksummed form** while the registry stores lower-case.
   Comparing the two without normalising is the classic "same address, not equal" bug.

---

## Remaining

1. **Intent persistence.** `exec_intents` exists in `timeseries` and carries `typed_data_hash` — the
   binding a signature needs to the payload an operator actually reviewed. There is no repository for
   it and the routes are stateless, so `/intents` creates no row and `/intents/:id/sign` cannot look
   one up: `:id` is currently a correlation handle the caller supplies. Wiring this is what makes
   `typed_data_hash` enforceable rather than aspirational.
2. **The custody signing-policy caps are not enforced.** `SigningIntentPolicySchema` (`perTxCapUsdc`,
   `dailyCapUsdc`, `allowlistOk`) exists in `custody` and nothing consults it, because enforcing a cap
   needs the intent's USD amount and a daily accumulator — the same store as item 1.
3. **`PositionManager` action command bytes.** The deployed entry point is
   `modifyLiquidities(bytes,uint256)` — an actions batch. **Neither `mint` nor `modifyLiquidity` exists
   on the Optimism deployment**, established from the verified ABI committed at
   `packages/uniswap/abi/PositionManager.optimism.json`; the earlier note here said `mint`'s shape
   differed between revisions, which understated it. The missing piece is the command bytes from
   `Actions.sol`, which could not be retrieved and are not guessable — a wrong byte either reverts or
   executes the neighbouring action. See `packages/uniswap/docs/position-manager.md`.
4. **Two UI components are exported but mounted nowhere.** `AquaFlightPanel` and `RiskNoticeCard`
   render nothing today. The app already mounts `StepPill`, `ExecutionTimeline` and `FeeWaterfall`, so
   the pattern exists; the brief allows test scripts *or* a UI, so this is presentation rather than
   capability.

**Out of scope, deliberately:** deploying our router to other chains. Aqua and the canonical
SwapVM router are already deployed at the same deterministic addresses everywhere, so there is
nothing to deploy for them; `AgenticEMSSwapVMRouter` is the only new contract, and it is currently
deployed per-fork inside the scenario.

---

## Licences

Aqua and SwapVM are **source-available, not OSI open source**
(`LicenseRef-Degensoft-Aqua-Source-1.1`, `LicenseRef-Degensoft-SwapVM-1.1`). The Track 5.1 brief
explicitly permits redeploying a modified SwapVM. The vendored trees keep their own SPDX headers
and their `LICENSES/` directories. `THIRD_PARTY_NOTICES.md` is written and the licence texts are
copied into a committed `licenses/` — because `contracts/lib/` is gitignored, texts left there would
not ship with a clone, which would satisfy nothing.

Morpho Midnight is BUSL-1.1 for the core and GPL-2.0-or-later for `src/interfaces`,
`src/libraries`, `src/ratifiers` and `src/periphery`. No Morpho code is vendored, so this is a
documentation note.
