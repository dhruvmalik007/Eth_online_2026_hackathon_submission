# Scenarios

Every scenario runs against a **pinned fork** and writes an artifact to
`apps/fork-execution/evidence/`. Nothing is ever broadcast to a live network: the node is local, the
tokens are dealt, and the receipts are real but the state is a rehearsal.

```bash
cd apps/fork-execution
pnpm run doctor                          # no RPC needed — toolchain and configuration
pnpm run smoke    --chain optimism       # the registry, checked against a live chain
pnpm run flight   --chain optimism       # a rebalance, end to end
```

RPC comes from the chain's own `*_RPC_URL` or falls back to `ALCHEMY_API_KEY`. `doctor` reports which
one won, per chain, because "am I on the dedicated key or the shared one" is otherwise unanswerable.

## `doctor`

No RPC. Checks that `forge` and `anvil` are on PATH, which chains are configured, and lists the
registry's unresolved addresses. This is the first thing to run on a fresh clone, because it
distinguishes "nothing is configured" from "the RPC is wrong" — a distinction the other scenarios
cannot make, since both look like a connection error.

## `smoke` — the registry against a live chain

**What it proves:** the addresses in `chainRegistry` are real contracts on the chain they claim, and
the facts recorded beside them are true. This is the check that makes everything downstream trustworthy
— a wrong vault address is otherwise discovered when a deposit fails.

| Check group | What it asserts |
|---|---|
| Chain identity | The fork reports the chain id the registry claims |
| Code presence | Every pinned address has bytecode, at the pinned block |
| Deterministic addresses | Aqua and the router sit at the same address on every chain |
| Token metadata | USDC and WETH `symbol()` and `decimals()` match |
| Vault validity | Asset matches the curated USDC, `totalAssets > 0`, `convertToAssets > 0` |

**17 checks per chain.** A "verified" address in the registry means this scenario passed against it,
not that it was copied from documentation.

Last run: **17/17 on Optimism** (block 156825375) and **17/17 on Polygon** (block 93696437). The
Optimism vault held `833,152,026,043` of USDC — matching the `833,460` curated from the discovery
query, which is the check doing its job.

## `deploy` — our contracts on a local node

Boots a managed Anvil, runs `contracts/script/Deploy.s.sol`, then **reads the addresses back out of
the broadcast artifact** and re-verifies that each one has code. The write-then-read is the point: a
deploy script that reports success and produced nothing is the failure mode, and reading from the
artifact rather than from the script's own return value is what catches it.

## `flight` — a rebalance, end to end

**What it proves:** the whole path works on a live fork with real token movements — a strategy is
shipped into Aqua, a fill executes through our router with the clamp active, and the proceeds are
deployed into a real Morpho vault.

The strategy is `XYCSwap → YieldBandFlight → Salt`. The maker declares 10 WETH / 40,000 USDC of
virtual reserves; the band is `3_400_000_000`, so at an unclamped curve price of ~3,636 USDC the clamp
binds and the fill settles at exactly 3,400.

| Check | What it asserts |
|---|---|
| `quoteEqualsSwap` | Every amount the plan quoted is the amount the fill produced |
| `clampedToTheBand` | The output equals the band exactly, not merely near it |
| `inputUnchanged` | An `exactIn` clamp leaves the taker's input untouched |
| `routerEmitted` | The redeployed router emitted a fill event |
| `vaultSharesMinted` | The proceeds bought vault shares |
| `proceedsFullyDeployed` | Nothing was stranded between the two legs |

**8/8 on Optimism.** The run produces `1 WETH → exactly 3,400 USDC`, with real USDC and WETH balance
deltas and real vault shares.

There is also a **paired negative test**: with the signal disarmed, the same order trades at the curve
price. Without it, a clamp that always clamped would pass every positive test — which is the single
most likely way a guard like this ships broken.

## Why the flight runs in Foundry, not TypeScript

The taker side of a fill needs `takerTraitsAndData`: a 22-byte packed header plus ten length-prefixed
slices, where the header packs the indexes *above* the flags and each index is an **end offset** rather
than a start. Getting one of those wrong produces a header that is internally consistent and wrong.

So the scenario uses upstream's own `TakerTraitsLib` rather than a second implementation of it. The
TypeScript encoder in `src/swapvm/takerTraits.ts` exists for off-chain callers and is pinned against
the same hand-computed literal — but nothing in the demo path depends on it being right.

## Evidence

Artifacts land in `apps/fork-execution/evidence/<chain>-<scenario>-<block>.json`, validated against
`EvidenceSchema` before writing:

```json
{
  "schema": "fork-evidence/1",
  "scenario": "flight",
  "chain": "optimism",
  "chainId": 10,
  "rpcHost": "opt-mainnet.g.alchemy.com",
  "forkBlock": 156836785,
  "observedBlockNumber": 156836785,
  "checks": [{ "name": "clampedToTheBand", "ok": true, "detail": "output 3400000000 vs band 3400000000" }],
  "txs": []
}
```

Three properties make an artifact checkable rather than decorative:

- **The block is recorded.** A result is only meaningful at a block, and amounts move between them —
  a `vaultShares` figure differs between two runs of the same scenario purely because the fork moved.
- **Only the RPC host is stored**, never the URL. Providers put the key in the path, and evidence is
  meant to be committed.
- **Amounts are decimal strings, not JSON numbers.** `vaultShares` is around 3.3e21, well past 2^53,
  so a JSON number silently rounds it — and the rounding is invisible until two runs disagree by
  billions for no reason. This is the same rule the port applies to transaction values.

## Reproducing a result

```bash
OPTIMISM_RPC_URL=… pnpm run flight --chain optimism --block 156836785
```

Pin the block when comparing runs. Without it, the fork follows the chain head and two runs of the
same scenario will differ in every derived amount — which reads like nondeterminism in the code rather
than a moving input.
