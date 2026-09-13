# Interoperating with v1

What this package promises the rest of the repo, what it deliberately did not touch, and what is
still open. Written as a contract rather than a summary, because the value is in the *negative*
claims: what did not change is what cannot break.

---

## What did not change, and now cannot break

| Surface | Why it is safe |
|---|---|
| `packages/execution-domain` — **untouched** | No new enum member, no new field, no changed schema. Every existing consumer compiles against exactly the types it did before. |
| `RouteHop.kind` — **did not grow** | The vault leg reuses `deposit`/`withdraw` and Aqua's `ship`/`dock` map onto the same two. Asserted in `test/port.test.ts`. |
| `exec_steps.kind`, all timeseries migrations — **untouched** | `'swap'` was already permitted and event payloads are `jsonb`, so nothing needed migrating. Zero migration risk. |
| `apps/execution` request/response bodies | The two routes this work fills currently throw `UNAVAILABLE`; `apps/execution`'s own tests pass unmodified. |
| `packages/bridges`' public barrel | `port.ts` became a re-export shim, so `apps/inferrence` and every existing import path still resolve. Its 25 tests pass through the shim unchanged. |

The `port.ts` move is worth calling out because it was a cross-package refactor that changed **no
call site**: the file's own header had said *"It moves when `packages/oneinch` needs the same
types"*, so the move was the plan rather than a detour.

---

## What was added, additively

| Addition | Shape | Risk |
|---|---|---|
| `SOURCE_IDS` gains `"morpho"` | one enum value | Every existing `SourceIdSchema` parse still succeeds. `"1inch"` was **already a member** — the port was designed for this work before it existed. |
| `SIGNING_INTENT_KINDS` gains 4 | `aqua-ship`, `swap-vm`, `aqua-flight`, `vault-deposit` | Producers choose the kind, so an unrecognised value can only come from a new producer. |
| `LegKind` gains 3 | `aqua-swap`, `aqua-ship`, `vault-deposit` | `executeLegs` dispatches by comparison, not by exhaustive switch, so an unhandled kind is a skipped leg rather than a compile error. |
| New optional env keys | `ONEINCH_*`, `MORPHO_VAULTS_OVERRIDE` | Every existing key keeps its default, so an existing deployment boots unchanged. |

---

## The chain restriction, as an interop decision

This package covers **Optimism and Polygon only**, because `execution-domain`'s
`CHAIN_KEYS = ["base", "polygon", "optimism"]` is what a leg, a step, a plan and a record can hold.

The consequence is the good kind: this package's `ChainKey` is a **subset** of the domain's, so
`domainChainKey()` is an identity and there is no translation table to get wrong. Ethereum and
Arbitrum were verified during this work and are preserved in
[`reference-verified-addresses.md`](./reference-verified-addresses.md); re-adding them is a matter of
widening `CHAIN_KEYS` once the domain can express them — with the caveat that Aave's
`AaveDeployment` is a discriminated union on `version` precisely because Ethereum runs V4 (hubs and
spokes) while the L2s run V3 (a pool), and no fork scenario currently exercises the V4 branch.

`packages/bridges` already covers large-order 1inch routing across the wider chain set, so this is a
complement to it rather than a replacement.

---

## One thing the plan got wrong

The plan specified a single class implementing both the domain's `ExecutionAdapter` and the port's
`QuoteSource`. That is not expressible in TypeScript:

```ts
ExecutionAdapter.quote(legs: IntentLeg[]): Promise<Quote[]>          // the domain's shape
QuoteSource<Req, Quote>.quote(request: Req): Promise<QuoteOutcome>   // the port's shape
```

Same name, incompatible signatures. A class cannot satisfy both, and an overload union would fail at
every call site. `OneInchAquaAdapter` therefore implements `ExecutionAdapter` — the interface the
dashboard and `apps/execution` are actually written against — and exposes the port-shaped call as
`quoteEnvelope`. A caller needing strict `QuoteSource` conformance wraps two methods; a signature
everybody trips over would be worse.

---

## What a v1 launch would change

**The flag.** `ONEINCH_AQUA_ENABLED`, default **off**, in `apps/execution`. With it off the routes
throw the same `UNAVAILABLE` they throw today, so the code can ship before the capability does and
roll forward per environment with an env var rather than a code change. The flag gates
*construction* only — never a shape — so removing it once the adapter passes a live suite is a
deletion, not a migration.

**Not yet built**, and therefore not yet promised:

**All three are now built**, and this list is kept rather than deleted so the change of state is
visible:

- the `apps/execution` **executor** routes — `/runs/:id/simulate` and `/intents` plan through the venue
  registry, and `/intents/:id/sign` and `/submit` sign and broadcast behind a configured signer;
- the `custody` EIP-712 typed-data builder (`swapVmOrder.ts`), with its typehash pinned against the
  deployed router by `OrderTypehash.t.sol`;
- the **`langchain` tools**, registered in the agent and asserted by `agentToolRegistration.test.ts`.

**Still open**, and named here because none is a build failure: intent persistence (`exec_intents` has
no repository, so `typed_data_hash` cannot yet be enforced), the custody policy caps, and the
`PositionManager` action command bytes.

**The adapter's injected ports are the v1 seams.** `AquaFillEncoder` and `TxSender` exist because a
second implementation of `takerTraitsAndData` could disagree with the contract about **direction and
slippage** — the two things that fail silently and expensively. The fork scenario sidesteps this by
running in Solidity against upstream's own `TakerTraitsLib`; when a TypeScript encoder is needed,
this is where it plugs in, and the adapter does not change.

**Two pre-existing duplications** worth resolving in v1 rather than now, because both are behaviour
changes:

- `apps/execution` has two signer ports — `EvmSigner` (`evmSigner.ts`) and `WalletSigner`
  (`privy.ts`). This work standardises on `EvmSigner`; the other should be folded in.
- `apps/execution` never depended on `packages/bridges`, though that package's header names it as
  the intended consumer. `apps/inferrence` is the actual consumer today.
