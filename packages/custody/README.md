# `@ethonline2026/custody`

Custody middleware for the Agentic EMS: the trust layer between LangChain agents
and the trader's **Safe** smart account.

> **Agents propose. The device approves.**

An agent never holds a signing key. It can build a transaction (a *proposal*) and
encode it, but moving funds requires a signature from an owner device — the human
confirms on the Ledger. This package is deliberately standalone: it depends on no
other EMS package, so any app can integrate it.

---

## The trust model

A **Safe** holds the treasury. Its owners are **configured, not assumed** — a
Privy-derived EOA, the user's Ledger EOA, or both — and the Safe's `threshold`
decides how many must sign.

This package knows nothing about *who* an owner is, which is the point: adding a
new kind of owner is a config change, never a code change.

```
agent ──proposes──▶ SafeClient ──▶ Safe transaction + calldata
                                        │
                          owner device ─┴─▶ signature (EIP-712, on-device)
                                        │
                                        ▼
                              Safe.execTransaction
```

Only signature bytes ever reach the host process. No private key is read, stored
or passed anywhere in this package.

---

## Modes

| Mode | Device | RPC | What it does |
|---|---|---|---|
| `dry` (default) | not touched | **required** | Builds proposals, hashes and calldata. Never signs. |
| `live` | required | required | Additionally signs the EIP-712 digest on the Ledger. |

**On the RPC requirement.** Dry mode means "no device", not "no network":
protocol-kit reads the chain id when it initialises, so it needs a reachable
endpoint even to build an unsigned proposal. This was measured, not assumed —
pointing at an unreachable endpoint fails on `eth_chainId` during construction.

---

## Configuration

No secrets live in env. Agent keys and API keys belong in the Ledger Key Ring
(see `KeyRingClient`); the ring password is injected from the OS keychain via
`WALLET_PASS`.

| Variable | Default | Purpose |
|---|---|---|
| `CUSTODY_MODE` | `dry` | `dry` or `live` |
| `CUSTODY_SAFE_ADDRESS` | — | An existing deployed Safe |
| `CUSTODY_SAFE_OWNERS` | — | Comma-separated owner addresses. Unset means "the resolved owner alone" |
| `CUSTODY_SAFE_THRESHOLD` | `1` | How many owners must sign |
| `CUSTODY_SAFE_CHAIN` | `sepolia` | One of `CUSTODY_CHAINS` |
| `ETHEREUM_SEPOLIA_RPC_URL` | — | RPC endpoint |
| `CUSTODY_LOG_PATH` | `./custody-audit.jsonl` | Append-only audit log |

See [`.env.example`](./.env.example).

---

## Usage

### Build a proposal (dry — no device)

```ts
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { SafeClient } from "@ethonline2026/custody";

const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

const client = new SafeClient({
  publicClient,
  ownerAddress: "0x…",                 // dry: identity from config
  predictedSafe: { owners: ["0x…"], threshold: 1, safeVersion: "1.3.0" },
  nonce: 0,                            // so no nonce read is needed
});

const proposal = await client.buildProposal([
  { to: recipient, value: "0", data: "0x" },
]);
// → { safeAddress, safeTxHash, calldata, nonce, legs }
```

`calldata` is real `execTransaction` calldata (selector `0x6a761202`), ready to
submit once an owner has signed.

### Sign on the device (live)

```ts
const client = new SafeClient({ publicClient, ledger });   // live mode
const tx = await client.createTransaction(legs);
const signed = await client.signWithLedger(tx);            // human confirms on-device
await client.attachSignature(signed);                      // packed signatures
```

The two modes are a discriminated union: supplying both `ledger` and
`ownerAddress` — or neither — is a compile error.

### Deploy

protocol-kit v6 has no `deploySafe`, so `deploymentRequest()` returns the
transaction instead of sending it. Deployment is paid for by an owner EOA, and
this middleware holds no key:

```ts
const { to, value, data, predictedAddress } = await client.deploymentRequest();
```

---

## Integrating an account provider (Privy, and others)

A hardware device cannot sign for a TEE-held embedded EOA, and Privy's key
quorums are made of Privy users and P-256 server keys — not ECDSA devices. So an
embedded wallet and a Ledger meet at the **Safe's ownership layer**, as
independent owners:

| Owner | Confirms |
|---|---|
| Provider EOA (e.g. a Privy embedded wallet) | the account/agent path |
| Ledger EOA | the irreversible-action gate |

Configure both via `CUSTODY_SAFE_OWNERS` with the matching
`CUSTODY_SAFE_THRESHOLD`. This package needs **no change** to accept either.

> A Safe has a single threshold, so "one signature normally, device required
> above $X" cannot be expressed by ownership alone — that needs a Safe guard or
> module.

---

## Other modules

| Module | Responsibility |
|---|---|
| `SafeClient` | Safe proposals, EIP-712 digest, deployment request |
| `LedgerSignerAdapter` | Device-backed owner signing (never holds a key) |
| `PolicyGate` | Pre-proposal policy enforcement and daily spend limits |
| `ScopedCapability` | Ring-encrypted agent capabilities (proposer role) |
| `KeyRingClient` | Encrypted key storage |
| `CustodyLog` | Append-only audit trail |

---

## Verification

```sh
pnpm --filter @ethonline2026/custody build      # tsc
pnpm --filter @ethonline2026/custody typecheck  # tsc --noEmit
pnpm --filter @ethonline2026/custody test       # vitest
pnpm --filter @ethonline2026/custody smoke:dry  # end-to-end dry proposal
```

`smoke:dry` builds a real proposal for a counterfactual Safe on Sepolia with no
device attached. It honours `ETHEREUM_SEPOLIA_RPC_URL`.

---

## Known gaps

- **The signer is not DMK.** `LedgerSignerAdapter` uses `@ledgerhq/hw-app-eth`
  (the legacy SDK) although this package's own docstrings reference the DMK
  skill. Migrating to `@ledgerhq/device-management-kit` and its chain signer
  kits — with pre-flight device gates and Clear Signing — is a separate piece of
  work.
- **`cli demo` and `cli safe deploy` are advertised but unimplemented.**
  `package.json` declares a `demo` script and `env.ts` tells you to run
  `cli safe deploy`; neither exists in the CLI's switch.
- **Live signing is unverified end-to-end.** No device is available in CI, so
  `signWithLedger` → `attachSignature` is type-checked and unit-tested but has
  not been exercised against hardware.
