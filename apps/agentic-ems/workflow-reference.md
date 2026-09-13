# Workflow reference — live Polygon transactions

Every link below resolves to real state on a public explorer. Nothing here is illustrative.

**Signer:** `0x63185C0f059dE46DBeEa6813ab461A8863E40e21`
[Polygonscan →](https://polygonscan.com/address/0x63185C0f059dE46DBeEa6813ab461A8863E40e21)

**Broadcast through:** `POST https://ethonline-2026-execution.vercel.app/intents/:id/submit`
(headless — no GUI, no browser wallet)

---

## Order 1 · Aave v3 — collateral supply

| | |
|---|---|
| Venue | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` · [Pool](https://polygonscan.com/address/0x794a61358D6845594F94dc1DB02A252b5b4814aD) |
| Asset | USDC `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| Amount | 0.02 USDC |

1. **approve** — [`0xed00d77b…`](https://polygonscan.com/tx/0xed00d77b4b5d9745606b43202b62d51918c6fc8ee0f5e41e6df0b61132ba3f2f) · block 93737448
2. **supply** — [`0x062fc833…`](https://polygonscan.com/tx/0x062fc833a72edd844648ca00e8d3f2303e6f1da8a2d3f30c86d48be921be0438) · block 93737454

**Position:** `aPolUSDC` = **0.119998**
[aToken on Polygonscan](https://polygonscan.com/token/0xA4D94019934D8333Ef880ABFFbF2FDd611C762BD?a=0x63185C0f059dE46DBeEa6813ab461A8863E40e21)

---

## Order 2 · Morpho — ERC-4626 vault deposit

| | |
|---|---|
| Vault | MEV Capital USDC · `0xF2532428472a4CbDF27f20Ca39E81DA6DEb420b5` · [Vault](https://polygonscan.com/address/0xF2532428472a4CbDF27f20Ca39E81DA6DEb420b5) · [Morpho app](https://app.morpho.org) |
| Amount | 0.015 USDC |

3. **approve** — [`0x21def22d…`](https://polygonscan.com/tx/0x21def22d376ff2fe2a6c67070239970bcb7ff48c228a689da9a5add375b553f5) · block 93737461
4. **deposit** — [`0x089eb396…`](https://polygonscan.com/tx/0x089eb3969875bc0d2519414a9a969da0fc7ae736cac2ec08ba144c058c8a4a29) · block 93737467

**Position:** vault shares minted to the signer — [holdings](https://polygonscan.com/token/0xF2532428472a4CbDF27f20Ca39E81DA6DEb420b5?a=0x63185C0f059dE46DBeEa6813ab461A8863E40e21)

---

## Order 3 · Polymarket — position against a live market

| | |
|---|---|
| Market | *"Will there be no change in Fed interest rates after…"* |
| conditionId | `0xa3b36b2d6104d34af4e6c6215fc818e43352e78a748fbfb0b85e3a35f71dec9a` |
| CTF | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` · [Conditional Tokens](https://polygonscan.com/address/0x4D97DCd97eC945f40cF65F87097ACe5EA0476045) |
| Collateral | pUSDC `0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB` · [pUSD](https://polygonscan.com/address/0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB) |
| Amount | 1.0 pUSDC |

5. **approve** — [`0x8b90e39c…`](https://polygonscan.com/tx/0x8b90e39c86ad16e5862f4bfc1ce84d5479de9598215c5a0907e3b5218929a3fa) · block 93737474
6. **splitPosition** — [`0x8c93fe2a…`](https://polygonscan.com/tx/0x8c93fe2a8c1809a284c4ea3cdb9af643139f534825ffb16567c969494e824fc5) · block 93737481

**The split, read from the transaction's own logs:**

| Log | Contract | Meaning |
|---|---|---|
| `Transfer` | pUSDC | `0x0f4240` = **1.0 pUSDC** signer → CTF |
| `TransferBatch` | CTF | mint from `0x0` → outcome tokens |
| `PositionSplit` | CTF | conditionId `0xa3b36b2d…`, collateral pUSDC |

---

## Bridge · Polygon → Base

A cross-chain leg, both hashes readable from `GET /bridges`.

| | |
|---|---|
| Routed by | `squid` (LI.FI aggregator) |
| **Source** | [`0x385e0f86…`](https://polygonscan.com/tx/0x385e0f86cae44df5a32d7e2fa23e1f883b488f440df04670fecc3e8baba2dedd) · Polygon |
| **Destination** | [`0x29abf440…`](https://basescan.org/tx/0x29abf440425bd59275a94c2042109b2be7f9b81375515adbfd4cd945b771ecd2) · Base |
| Status | `DONE` / `COMPLETED` |

---

## Balance movements — the arithmetic that proves it

| Token | Before | After | Delta |
|---|---|---|---|
| USDC | 0.043983 | 0.008983 | **−0.035** = 0.02 Aave + 0.015 Morpho |
| pUSDC | 14.900000 | 13.900000 | **−1.000** = the Polymarket split |
| aPolUSDC | 0.099999 | 0.119998 | **+0.020** = the Aave supply |

Each delta matches its order exactly. Nothing is approximated.

---

## Service endpoints used

| Endpoint | Purpose |
|---|---|
| `POST /intents/:id/submit` | signs and broadcasts the calls |
| `GET /bridges` | the cross-chain pair and every recorded broadcast |
| `POST /intents/:id/confirm` | re-reads the bridge provider for the destination hash |
| `GET /health` | signer address, database, mode |

All require a Privy access token. `/health` is public by design — it returns an address, no identity.

---

## For the sidebar during the demo

Open in this order:

1. `https://polygonscan.com/address/0x63185C0f…` — the signer, showing all six transactions in one list
2. Each of the six `polygonscan.com/tx/…` links above, in order
3. `https://polygonscan.com/token/0xA4D94019…?a=0x63185C0f…` — the live Aave balance
4. `https://app.morpho.org` — the vault, with the position
5. `https://polygonscan.com/tx/0x385e0f86…` then `https://basescan.org/tx/0x29abf440…` — the two halves of the bridge, on two different explorers

The bridge pair is the one to linger on: two chains, two explorers, one route.

---

## Wallets — where liquidity goes

| Purpose | Address | Owner |
|---|---|---|
| **Broadcasting signer** | `0x63185C0f059dE46DBeEa6813ab461A8863E40e21` | the key in `.env`; signs and pays gas |
| **Privy wallet (test account)** | `0x84E1Cc77360E31ADBdABd2A2759C822f0a30910C` | `test-3051@privy.io` |
| **Privy wallet (Gmail)** | `0xFE98F9F391f79ccfA453D771752C7FF67535f8f1` | `malikdhruv1994@gmail.com` |

The two are separate on purpose: the signer broadcasts, the Privy wallet is the account the app logs in as.
Both can run the workflow independently.

---

## CCTP bridge · testnet — blocked, and exactly why

Circle's CCTP V2 is implemented in `packages/arc/src/cctp.ts`: `approve` → `depositForBurn` → Iris
attestation → `receiveMessage`. The route is configured and the code is complete.

**It cannot run today, because each testnet is missing what the other has:**

| Chain | Gas | USDC | Can burn? |
|---|---|---|---|
| Arc testnet (5042002) | **20.0 POL** | 0.000000 | no — no USDC to burn |
| Base Sepolia (84532) | **0.0** | **20.000000** | no — no gas |
| Polygon Amoy (80002) | **0.0** | **20.000000** | no — no gas |

A burn is a transaction on the **source** chain, so the source needs gas. Base Sepolia and Amoy hold
the USDC but cannot pay for the burn; Arc can pay but holds no USDC. Nothing here is a code problem —
it is a funding one, and no amount of retrying fixes it.

**To unblock, send testnet gas to the broadcasting signer `0x63185C0f…` on either:**

- **Base Sepolia ETH** (faucet: `https://www.alchemy.com/faucets/base-sepolia`) → then Base Sepolia → Arc works
- **Polygon Amoy POL** (faucet: `https://faucet.polygon.technology`) → then Amoy → Arc works

Once either lands, the transfer is one command and takes about a minute with a fast attestation.

**CCTP config, verified from the repo:**
Arc domain `26` · Base Sepolia domain `6` · Amoy domain `7` · TokenMessengerV2 `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` (same address on every CCTP chain) · Arc MessageTransmitterV2 `0xe737e5cebeeba77efe34d4aa090756590b1ce275` · Iris sandbox `https://iris-api-sandbox.circle.com`

Arc's USDC is **18 decimals** while every spoke is **6** — `CctpV2` scales for this, and it is the
easiest way to misread a balance. A raw read at the wrong decimals makes 0.00000002 look like 20.

---

## LangSmith traces — the agent runs behind the orders

Every agent step in this run is traced. These open the live project, filtered to the workflow.

| What | Link |
|---|---|
| **Project** `ethonline2026-fixed-income` | https://eu.smith.langchain.com/o/d7bf734a-8342-4ca1-afd4-0f9cc469b322/projects/p/8cc7f3f3-2ec1-41cd-87ee-b989d69e9a00 |
| Runs — all traces | https://eu.smith.langchain.com/o/d7bf734a-8342-4ca1-afd4-0f9cc469b322/projects/p/8cc7f3f3-2ec1-41cd-87ee-b989d69e9a00/runs |
| Risk decomposition (the 4 parallel data agents) | https://eu.smith.langchain.com/o/d7bf734a-8342-4ca1-afd4-0f9cc469b322/projects/p/8cc7f3f3-2ec1-41cd-87ee-b989d69e9a00/runs?search=risk-engine |
| Specialist forecasts (TimesFM-3) | https://eu.smith.langchain.com/o/d7bf734a-8342-4ca1-afd4-0f9cc469b322/projects/p/8cc7f3f3-2ec1-41cd-87ee-b989d69e9a00/runs?search=timesfm |

Region is **EU** (`eu.api.smith.langchain.com`) — a `smith.langchain.com` link without the `eu.` prefix lands on the US instance and shows an empty project.

---

## Testnet wallets — for the app's own signing

| Chain | Address that holds the testnet USDC |
|---|---|
| Arc testnet | `0x63185C0f059dE46DBeEa6813ab461A8863E40e21` |
| Base Sepolia | `0x63185C0f059dE46DBeEa6813ab461A8863E40e21` |
| Polygon Amoy | `0x63185C0f059dE46DBeEa6813ab461A8863E40e21` |
