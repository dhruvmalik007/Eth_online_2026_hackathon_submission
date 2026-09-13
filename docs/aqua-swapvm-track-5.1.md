# Track 5.1 — Build an Aqua App

Submission notes for **ETHOnline 2026 · 1inch · Track 5.1** ($5,000), implemented in
[`packages/oneInch`](../packages/oneInch) and [`apps/fork-execution`](../apps/fork-execution).

## The app

A **fixed-income flight**. A strategy's yield falls under a floor, or its volatility breaches a cap,
and it flees: the volatile leg is swapped into a stablecoin through a **SwapVM program containing an
instruction we wrote**, and the proceeds are deployed into a **Morpho vault**.

**Two custom Aqua apps**, deliberately separate:

- **`AgenticEMSSwapVMRouter`** — a SwapVM position. The canonical `SwapVM` + `AquaOpcodes`
  instruction set, plus `YieldBandFlight` at opcode `0xb3`. The diff against the canonical router is
  the length of one `if`.
- **`StablecoinRefugeApp`** — a position that can exit atomically. It holds no pricing logic at all;
  its whole job is that one call moves both legs back to the maker, which removes the window of
  half-executed risk between the swap and the deposit.

## Requirement by requirement

### Official Aqua/SwapVM contracts must be used (redeployments of a modified SwapVM allowed)

- **Aqua is the canonical deployed registry**, not a copy. The fork scenario ships strategies to
  `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` — the protocol's own deterministic deployment —
  and reads its balances back through `IAqua`. Verified live on both chains by `smoke`.
- **`AgenticEMSSwapVMRouter`** is the permitted *modified* SwapVM: `contract ... is Simulator,
  SwapVM, AquaOpcodes`, overriding the single abstract `_dispatch` to check our opcode and delegate
  everything else to the inherited `_runOpcode`.
- **`YieldBandFlight`** is the new instruction. `0xb3` is the next free slot in SwapVM's
  **rates-tuning** bank (`0xb0-0xcf`, where `0xb0-b2` and `0xb4` are occupied), which is what
  `OpcodeList.sol`'s own guidance asks for. The reserved bank (`0xf0-0xff`) is avoided because
  upstream holds it for a possible two-byte escape prefix.
- **Verified against the real source, not the README.** The published docs are wrong in three places:
  `SwapRegisters` has four fields (no `amountNetPulled`), the `SwapVM` constructor takes an `owner`,
  and the deployed Aqua router runs only the Aqua opcode subset. See the package README's findings.

### Onchain execution of token transfers (local forks ok)

`apps/fork-execution` runs a pinned fork per chain and produces a committed evidence artifact.
`pnpm run flight --chain optimism` asserts, at a recorded block:

| Claim | Where it is checked |
|---|---|
| `quote(amountOut) === swap(amountOut)` | the fork test, and re-derived by the harness from the raw numbers |
| The fill landed **exactly on the band** (3,400 USDC for 1 WETH) | both |
| The taker's USDC balance rose by that amount | balance deltas in the test |
| The maker's WETH balance rose by the input amount | balance deltas in the test |
| The router emitted during the fill | log emitter count |
| The proceeds became a **real vault position** (non-zero shares) | `vault.deposit` + share balance |
| The guard is **inert when unarmed** | a paired negative test |

The smoke run separately verifies every registered address against live chain state — 17/17 on both
Optimism and Polygon — so the registry the flight reasons over is not taken on faith.

### Proper Git commit history (no single-commit entries)

⚠️ **Outstanding.** The work is complete and green on disk but **not yet committed** — everything
under `packages/oneInch/`, `apps/fork-execution/` and the wiring edits is untracked, by explicit
request pending a decision on the branch base. A single squashed commit on submission day would fail
this requirement, which is now a mechanical risk rather than an engineering one.

The commit sequence is planned in the approved plan (§11): 22 atomic commits, each green on
`pnpm turbo run typecheck test`, ordered so the capability port moves before anything is written
against it and the contracts land before the harness that exercises them.

### "Projects that utilize SwapVM will be scored higher"

SwapVM is load-bearing rather than wrapped:

- **Orders** are built as Aqua orders: a packed 256-bit `MakerTraits` word and a
  `tokenA ++ tokenB ++ program` data blob, with the hash `keccak256(abi.encode(order))` matching
  `SwapVM.hash` byte for byte (asserted against a hand-assembled `abi.encode`).
- **The program is ours**, and the instruction is ours.
- **The router is ours**, and it is a superset: canonical Aqua programs still execute on it at the
  same opcode, which is why adopting it is not a migration.
- **The opcode claim is behavioural, not textual.** `0xb3` is not merely "unused upstream" — the same
  program runs on our router and reverts `UnknownOpcode(0xb3)` on the canonical one. A guard a taker
  could sidestep by pointing at a different router would be worth nothing, and a silent
  misinterpretation of an upstream opcode would be worse than nothing. Both directions are asserted.

## Where to look

| | |
|---|---|
| Package | [`packages/oneInch`](../packages/oneInch/README.md) — status, findings, opcode table |
| Architecture | [`packages/oneInch/docs/architecture.md`](../packages/oneInch/docs/architecture.md) |
| Opcode table and banks | the package README, "Opcode `0xb3`" |
| The instruction | `contracts/src/instructions/YieldBandFlight.sol` |
| The router | `contracts/src/AgenticEMSSwapVMRouter.sol` |
| The Aqua apps | `contracts/src/StablecoinRefugeApp.sol`, and the router above |
| Insurance against the opcode claim | `contracts/test/YieldBandFlight.t.sol` → `OpcodeOwnershipTest` |
| The flight | `contracts/test/fork/Flight.fork.t.sol` |
| Evidence | [`apps/fork-execution/evidence/`](../apps/fork-execution/evidence) |
| Verified addresses, incl. chains outside the matrix | `packages/oneInch/docs/reference-verified-addresses.md` |

## Reproducing

```bash
cd packages/oneInch/contracts && ./install-libs.sh && forge test    # 29 tests, no network

export OPTIMISM_RPC_URL=https://…        # any provider
cd apps/fork-execution
pnpm run doctor                          # no RPC needed
pnpm run smoke  --chain optimism         # 17/17 registry checks
pnpm run flight --chain optimism         # the flight, end to end
```

`FORK_EVIDENCE_DIR` selects where evidence lands; `OPTIMISM_FORK_BLOCK` pins the fork, which is
worth setting because the same scenario at a different block produces different numbers — the vault
share count shifts with every block.

## Known gaps, stated plainly

1. **Nothing is committed yet.** See the git requirement above. This is the most consequential item
   on the list and it is a process decision, not a code one.
2. **Intent persistence is missing.** `exec_intents` exists and carries `typed_data_hash` — the binding
   a signature needs to the payload an operator actually reviewed — but there is no repository for it,
   so `/intents` writes no row and `/intents/:id/sign` cannot look one up. `:id` is presently a
   correlation handle the caller supplies.
3. **The custody policy caps are not enforced.** `SigningIntentPolicySchema` (`perTxCapUsdc`,
   `dailyCapUsdc`, `allowlistOk`) exists in `custody` and nothing consults it. Enforcing a cap needs
   the intent's USD amount and a daily accumulator — the store in item 2.
4. **`PositionManager` position creation is not encoded.** The deployed entry point is
   `modifyLiquidities(bytes,uint256)`, an actions batch — neither `mint` nor `modifyLiquidity` exists
   on the Optimism deployment, established from the verified ABI committed at
   `packages/uniswap/abi/PositionManager.optimism.json`. The command bytes live in `Actions.sol`, which
   could not be retrieved; a wrong byte reverts or executes the neighbouring action, so it is left
   rather than guessed.
5. **Two UI components render nowhere.** `AquaFlightPanel` and `RiskNoticeCard` are exported from
   `ux-workflow` and mounted by no page; the app does mount `StepPill`, `ExecutionTimeline` and
   `FeeWaterfall`, so the pattern exists. The brief accepts test scripts *or* a UI, and the committed
   fork evidence is the demonstration — so this is presentation, not capability.

**Resolved since this file was written** — kept so the change of state is legible. The
`apps/execution` routes are wired behind `ONEINCH_AQUA_ENABLED`, with `/intents/:id/sign` and
`/submit` behind a configured signer. The TypeScript taker encoder is written, and pinned to the
contract's own encoder by `TakerTraitsParity.t.sol`. Aave V3 is pinned on both chains from the
Address Book JSON API and verified on-chain, so `smoke` now runs **21/21 on both chains**. The
`langchain` tools are registered in the agent, and `THIRD_PARTY_NOTICES.md` exists with the licence
texts committed.
