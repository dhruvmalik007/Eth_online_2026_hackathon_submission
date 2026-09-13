# Missing pieces — role map

Written after inspecting the installed packages rather than assuming, because the
previous estimate was wrong in a way worth recording: **the CCTP and LayerZero
ABIs are not missing.** They ship inside the dependencies we already have.

```bash
$ grep -l "depositForBurn" node_modules/@circle-fin/*/index.cjs
node_modules/@circle-fin/adapter-viem-v2/index.cjs
node_modules/@circle-fin/bridge-kit/index.cjs
node_modules/@circle-fin/provider-cctp-v2/index.cjs

$ # tooling names found in the same bundles
approve  approveCallData  approveEstimate  approveInputSchema  approveRequest …
```

So the bridge kit **already builds the approve call data**. Hand-writing the
`TokenMessengerV2` ABI would have been duplicated effort against a vendor that
ships the builders.

---

## A. I implement — no input needed

| # | Piece | Where it comes from |
|---|---|---|
| A1 | **CCTP approve + burn calldata** | `@circle-fin/bridge-kit` (`approveCallData`, `approveEstimate`) — not a hand-written ABI |
| A2 | **LayerZero `send` calldata** | `@layerzerolabs/lz-v2-utilities` carries `SendParamStruct` and `createOFTQuoteSendCall`, so the OFT path is available |
| A3 | **CCTP domains + tokens** | Circle's supported-chains doc; Arc is **domain 26** with USDC `0x3600…0000`, taken from your Arc repo |
| A4 | **LayerZero EIDs + endpoint** | `lz-address-book` — done, cited, and pinned by `test/addressBook.test.ts` |
| A5 | **Simulation blocks for both** | Mirroring the LI.FI one already working |

**Caveat on A1 and A2:** I have confirmed these *builders exist by name* in the
installed bundles, not their exact signatures. The next step is reading their type
declarations before calling them — the same read-before-write discipline that
turned the LI.FI adapter from eight errors into zero.

---

## B. You provide — only you can

| # | Piece | Why it's yours |
|---|---|---|
| B1 | **Arc testnet gas** | Arc settles gas in **USDC**, not ETH. A send from Arc needs USDC on Arc specifically — a faucet that gives ETH will not work |
| B2 | **Destination-chain USDC** | For a real send (not simulation), the source chain must hold the amount being bridged |
| B3 | **A working LI.FI key** *(optional)* | Requests are keyless today and that works. The key is only needed if we exceed 100 RPM and start getting throttled — which is how we currently use it |

---

## C. Verify — your judgement, not mine

| # | Piece | What to check |
|---|---|---|
| C1 | **Simulated calldata matches intent** | The built transaction is the one you would approve — especially the recipient and amount, which a simulation can get wrong silently |
| C2 | **The Stargate route** | The address book exposes Stargate USDC OFT addresses, which would give a second LayerZero path. Whether that is in scope is a product call |
| C3 | **Mainnet risk** | Small amounts on mainnet are still real money. Simulation sends nothing; the first `--send` will |

---

## D. Known-good, with evidence

| Adapter | Evidence |
|---|---|
| LI.FI | builds real transactions — `0x1231DEB6…` (Diamond), 1444 / 1924 bytes of calldata |
| CCTP | live quotes: `$0.0001` Ethereum→Polygon, `$0.00013` Base→Polygon, `$0.0001` → Arc (167s) |
| LayerZero | live quote, protocol fee `$0.2727`, GUID computed locally |
| Circle MCP | configured and `initialize` verified |
| Gate | 29/29 · bridges 14 tests |

---

## The short version

**Nothing needs to be copy-pasted from the web.** Every ABI and address is either
in an installed package or in a source we have already cited. The remaining work
is wiring calls to builders that already exist — which is mine — plus Arc gas and
destination tokens, which is yours.
