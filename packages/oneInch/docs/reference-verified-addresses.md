# Reference: verified addresses outside the active matrix

The package targets **Optimism and Polygon** only, because those are the only chains
expressible in `@ethonline2026/execution-domain` (`CHAIN_KEYS = ["base", "polygon",
"optimism"]`).

Ethereum and Arbitrum were verified during this work and are kept here rather than in the
registry: carrying entries nothing downstream can address would be dead weight, and
deleting the research would mean redoing it. Extending `CHAIN_KEYS` and copying these
across is the whole job of re-adding them — with one caveat noted at the bottom.

Everything below came from an issuer's own deployment table and, where marked, was
confirmed on-chain.

---

## Deterministic — identical on every chain

| Contract | Address |
|---|---|
| Aqua registry | `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` |
| AquaSwapVMRouter (canonical) | `0x111111338c5091e8440b67b168bae16a668ac0de` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

The Aqua address's checksummed form is `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a` — worth
knowing because **Solidity address literals reject the all-lowercase form**, while the
TypeScript registry stores lowercase for viem.

---

## Ethereum (chain id 1)

Tokens — WETH confirmed on-chain (`symbol() == "WETH"`, `decimals() == 18`):

| Token | Address |
|---|---|
| USDC (native) | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| WETH | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |

Uniswap v4 (per-chain — do not assume cross-chain sameness):

| Contract | Address |
|---|---|
| PoolManager | `0x000000000004444c5dc75cB358380D2e3dE08A90` |
| PositionManager | `0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e` |

Morpho (from `docs.morpho.org/developers/contracts/addresses/`):

| Contract | Address |
|---|---|
| VaultV2Factory | `0xA1D94F746dEfa1928926b84fB2596c06926C0405` |
| MorphoRegistry | `0x3696c5eAe4a7Ffd04Ea163564571E9CD8Ed9364e` |
| MorphoMarketV1AdapterV2Factory | `0x32BB1c0D48D8b1B3363e86eeB9A0300BAd61ccc1` |
| Blue | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` |
| **Midnight** (fixed rate) | `0x471686c42792F93528B000beF54bC10E3aa2045f` |
| MidnightBundlesV1 | `0x7c00dBB2b6b6b9B28745332e550dC8782Fcf77EC` |
| EcrecoverRatifier | `0xAC439c81CAA6ef4C7B7E8F0110F8CE63A4b6D43e` |
| EcrecoverAuthorizer | `0xfC3303119E46AF831CacdBDB6e1A04C9C369ffF7` |
| Mempool (offer log) | `0xde2d62449301a09A51EbF9326EA60d2e8BF4A8F7` |

Curated USDC vaults, from the Morpho API and filtered as the registry test does:

| Vault | Address | TVL | APY |
|---|---|---|---|
| Steakhouse USDC | `0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB` | $67.8M | 4.09% |
| Gauntlet USDC Prime | `0xdd0f28e19C1780eb6396170735D45153D261490d` | $27.8M | 4.10% |

Aave V4 — mainnet-only, live 2026-03-30. Hub-and-Spoke: liquidity in Hubs, markets in
Spokes. **The Lido and EtherFi spokes are why the staking category is signal-only**: their
duration exposure is already priced inside the lending leg.

| Contract | Address |
|---|---|
| Core Hub | `0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9` |
| Prime Hub | `0x943827DCA022D0F354a8a8c332dA1e5Eb9f9F931` |
| Plus Hub | `0x06002e9c4412CB7814a791eA3666D905871E536A` |
| Global Dollar Hub | `0x62d63197660c080236193CA60b70E49A08E90368` |
| Taker Position Manager | `0x6c044c0D3801499bCAbfAd458B70880bc518e9F7` |
| Lido eSpoke | `0xe1900480ac69f0B296841Cd01cC37546d92F35Cd` |
| EtherFi eSpoke | `0xbF10BDfE177dE0336aFD7fcCF80A904E15386219` |

---

## Arbitrum One (chain id 42161)

| Token / contract | Address |
|---|---|
| USDC (native) | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| WETH (confirmed on-chain) | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` |
| Uniswap v4 PoolManager | `0x360e68faccca8ca495c1b759fd9eee466db9fb32` |
| Uniswap v4 PositionManager | `0xd88f38f930b7952f2db2432cb002e7abbf3dd869` |
| Morpho VaultV2Factory | `0x6b46fa3cc9EBF8aB230aBAc664E37F2966Bf7971` |
| MorphoRegistry | `0xc00eb3c7aD1aE986A7f05F5A9d71aCa39c763C65` |
| MorphoMarketV1AdapterV2Factory | `0xeF84b1ecEbe43283ec5AF95D7a5c4D7dE0a9859b` |
| Blue | `0x6c247b1F6182318877311737BaC0844bAa518F5e` |

Curated USDC vaults:

| Vault | Address | TVL | APY |
|---|---|---|---|
| Gauntlet USDC Core | `0x7e97fa6893871A2751B5fE961978DCCb2c201E65` | $0.98M | 4.45% |
| Steakhouse High Yield USDC | `0x5c0C306Aaa9F877de636f4d5822cA9F2E81563BA` | $2.3M | 5.14% |

No `MidnightBundlesV1` on Arbitrum, so Midnight is not available there.

Aave V3 pool and addresses provider: **not yet verified.**
`https://assets.aave.com/address-book/releases/latest/modules/AaveV3Arbitrum.json`
(`POOL`, `POOL_ADDRESSES_PROVIDER`).

---

## Base (chain id 8453) — not in this package, but relevant to the domain

`execution-domain`'s `CHAIN_KEYS` includes `base`, which this package does not cover. If
Base is added later, these are already verified:

| Contract | Address |
|---|---|
| USDC (native) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Uniswap v4 PoolManager | `0x498581ff718922c3f8e6a244956af099b2652b2b` |
| Morpho VaultV2Factory | `0x4501125508079A99ebBebCE205DeC9593C2b5857` |
| MorphoRegistry | `0x5C2531Cbd2cf112Cf687da3Cd536708aDd7DB10a` |
| **Midnight** (fixed rate) | `0xAdedD8ab6dE832766Fedf0FaC4992E5C4D3EA18A` |
| MidnightBundlesV1 | `0x091183d729BE9f808c212b475E387A12E67850A7` |

---

## The caveat when re-adding a chain

Two of the values above are **version-specific in a way the types do not express**:

- **Aave**: V4 exists only on Ethereum, and its Hub/Spoke shape has no `POOL` address. This
  is why `AaveDeployment` is a discriminated union on `version` rather than one struct —
  a chain running V4 needs hubs and spokes, a chain running V3 needs a pool, and neither
  shape can hold the other's fields.
- **Morpho Midnight**: `midnight` is optional per chain because the venue is absent on
  Arbitrum, Optimism and Polygon. Its absence is a fact, not an unresolved value.

Adding Ethereum therefore also means exercising the V4 branch of `AaveDeployment`, which
no fork scenario currently does.

---

## Aave V4 — Ethereum mainnet only

Not in the active matrix: V4 launched on mainnet in March 2026 and had not reached Optimism or
Polygon. It is recorded here because the addresses are verified and the architecture is worth knowing
— V4 replaces the single Pool with a **Hub-and-Spoke** model, where liquidity sits in Hubs and
markets are Spokes.

Observed from <https://aave.com/docs/resources/addresses> and each address checked for code on
mainnet via `eth_getCode`.

| Role | Address | Code |
|---|---|---|
| Core Hub | `0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9` | 1419 bytes |
| Plus Hub | `0x06002e9c4412CB7814a791eA3666D905871E536A` | 1419 bytes |
| Prime Hub | `0x943827DCA022D0F354a8a8c332dA1e5Eb9f9F931` | 1419 bytes |
| Global Dollar Hub | `0x62d63197660c080236193CA60b70E49A08E90368` | 1419 bytes |
| Taker Position Manager | `0x6c044c0D3801499bCAbfAd458B70880bc518e9F7` | 12157 bytes |
| Lido eSpoke | `0xe1900480ac69f0B296841Cd01cC37546d92F35Cd` | 1419 bytes |
| EtherFi eSpoke | `0xbF10BDfE177dE0336aFD7fcCF80A904E15386219` | 1419 bytes |

Every Hub **and** every Spoke reports the same code size (1419 bytes), which suggests a shared
implementation deployed at distinct addresses rather than bespoke contracts per market. That is an
observation from code length, not a claim about the implementation — it would need the source to
confirm, and it matters because a shared implementation means a vulnerability in one is a
vulnerability in all.

The two eSpokes named here are also why staking stays a *signal* rather than an integration: Aave V4
spokes for Lido and EtherFi mean staking yield is reachable through the lending venue, so a separate
staking position would be a second exposure to the same risk.

## Tooling: is there an Aave skill or MCP?

**No official Aave skill or MCP exists.** Searched with `npx skills find`:

| Skill | Installs | Note |
|---|---|---|
| `franalgaba/grimoire@grimoire-aave` | 1.1K | Third-party; most-used |
| `teneoprotocolai/teneo-skills@aave-v3-liquidation-watcher-teneo` | 468 | Liquidations only |
| `starchild-ai-agent/official-skills@aave` | 300 | "official" in the owner's name, not Aave's |
| `okx/plugin-store@aave-v3-plugin` | 152 | Exchange plugin |

None is published by Aave, and none was installed: the addresses above come from Aave's own Address
Book, which is the primary source these skills would only restate. Adding a third-party dependency
between this repository and the addresses it calls would add a link that can go stale without the
underlying data changing.

**For the next person:** the Address Book is a keyless JSON API and needs no skill.

```bash
curl -s "https://assets.aave.com/address-book/releases/latest/modules/AaveV3Optimism.json" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['POOL']['address'])"
```

Substitute `AaveV3Polygon`, `AaveV3Arbitrum`, `AaveV3Ethereum` and so on.

