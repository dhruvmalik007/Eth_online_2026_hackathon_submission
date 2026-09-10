# Messari-Standard DeFi Derivatives Subgraph — Technical Specification & Roadmap

> ETH Online 2026 Hackathon — F&O (perpetual futures + options), liquidity, FDV and trading metrics for the Agentic Fixed Income EMS.
> Target location: `the-graph/` in this repo. Status: spec (nothing implemented yet).
> Written: 2026-09-03. All The Graph facts below were verified against live docs/CLI source on this date.

---

## 1. Purpose & Scope

Build and deploy a **Messari-standardized subgraph** that turns raw on-chain events from a derivatives protocol (perp futures first, options second) into normalized, queryable GraphQL entities:

- **F&O trading data**: open interest (long/short/notional), leverage, funding rates, liquidations, collateral flows, realized PnL per position
- **Liquidity**: pool TVL, input token balances/weights, LP deposits/withdrawals, revenue split (supply-side / protocol-side / stake-side)
- **FDV / valuation**: per-token price, total supply, fully diluted valuation, circulating market cap (custom extension — not in the base Messari schema)
- **Real-time**: event → queryable in seconds; historical sync fast enough to demo on testnet within a hackathon build session

The subgraph becomes the **GraphQL source inside the DATA INFRASTRUCTURE layer** of the EMS (`SYSTEM_DESIGN.md` §2): the FastAPI market-data endpoints (`/api/v1/market/*`) and the risk engine (VaR, greeks, liquidity score) read from it via a poller → TimescaleDB pipeline.

**Out of scope (this doc):** CEX adapters, order routing, publishing to the decentralized network as a business action (publishing is only touched as an optional hackathon-bounty step).

---

## 2. Verified Environment Facts (as of 2026-09-03)

These are load-bearing facts — the testnet workflow depends on them. Re-verify if >2 months old.

| Fact | Value | Source |
|---|---|---|
| graph-cli latest | `@graphprotocol/graph-cli@0.98.1`, requires Node ≥ 20.18.1 | npm registry |
| Deploy target | Subgraph Studio is the **default**; `graph deploy` posts to `https://api.studio.thegraph.com/deploy/` | graph-tooling `node.ts` |
| `--studio` flag | **Dead.** `graph auth <KEY>` / `graph deploy <slug>` take no `--studio` flag (older tutorials are wrong) | graph-tooling `auth.ts` |
| Testnets with Studio deploy | `sepolia`, `arbitrum-sepolia`, `base-sepolia`, `optimism-sepolia`, `polygon-amoy` + ~20 more (Holesky is gone; Hoodi replaced it) | networks-registry JSONs |
| Substreams endpoint (Sepolia) | `sepolia.substreams.pinax.network:443` | networks-registry `sepolia.json` |
| Studio free tier | Deployed subgraphs are **free**, rate-limited, private; **Free Plan = 100k queries/month**; dev query URL capped at **3,000 queries/day** | Studio docs |
| Account limit | **3 deployed (unpublished) subgraphs** per account — plan slots accordingly | Studio docs |
| Publishing to network | `graph publish` → onchain (Arbitrum One / Arbitrum Sepolia only, via `cli.thegraph.com/publish`). **Not needed for testing** | quick-start docs |
| Query URL (dev) | `https://api.studio.thegraph.com/query/<ID>/<SUBGRAPH_NAME>/<VERSION>` | "Querying from an app" docs |
| Query URL (network) | `https://gateway.thegraph.com/api/subgraphs/id/<SUBGRAPH_ID>` (Authorization: `Bearer <API_KEY>`) | same |
| Indexing status | `_meta { block { number hash timestamp } deployment hasIndexingErrors }` | GraphQL API docs |
| Messari repo state | **Dormant** — last push 2025-03-25, 121 open issues, hosted-service endpoints dead since The Graph hosted-service shutdown (issue #2563). Use as **schema/template reference only** | GitHub |
| Substreams speed | Parallelized sync, official 2022 claim: "some subgraphs could sync more than 100x faster" (PancakeSwap-scale: weeks → ~6h). No newer official SPS benchmark | The Graph blog |
| SPS caveat | Substreams-powered subgraphs deploy to **Studio** (verified via official example), but decentralized-network SPS publishing is unverified (`services.sps` empty in registry; `/sps/` docs section mid-migration) | networks-registry schema |

Key links:

- Standardized subgraphs overview: <https://thegraph.com/docs/en/subgraphs/existing-subgraphs/standard-subgraphs/>
- Quick start: <https://thegraph.com/docs/en/subgraphs/quick-start/>
- Studio deploy: <https://thegraph.com/docs/en/subgraphs/developing/deploying-publishing/using-subgraph-studio/>
- Supported networks: <https://thegraph.com/docs/en/supported-networks/> (toggle "Show Testnets")
- GraphQL API (filters, pagination, time-travel, `_meta`): <https://thegraph.com/docs/en/subgraphs/querying/graphql-api/>
- Unit testing (matchstick): <https://thegraph.com/docs/en/subgraphs/tooling/unit-testing-framework/>
- Messari schemas: <https://github.com/messari/subgraphs> (`schema-derivatives-perpfutures.graphql`, `schema-derivatives-options.graphql`, `docs/SCHEMA.md`)

---

## 3. Requirements

### 3.1 Functional

| ID | Requirement |
|---|---|
| FR-1 | Index a perpetual-futures protocol on an Ethereum-family **testnet**, implementing Messari **Derivatives Perpetual Futures schema v1.3.4** |
| FR-2 | Expose `DerivPerpProtocol`, `LiquidityPool`, `Position`, `Account` and all `Event` types (Deposit, Withdraw, Borrow, CollateralIn, CollateralOut, Swap, Liquidate) with Messari field semantics |
| FR-3 | Emit `UsageMetricsDailySnapshot`, `UsageMetricsHourlySnapshot`, `FinancialsDailySnapshot`, `LiquidityPoolDailySnapshot`, `LiquidityPoolHourlySnapshot`, `PositionSnapshot` |
| FR-4 | Track per-token USD price (`lastPriceUSD`) from an on-chain oracle (Chainlink aggregator or protocol oracle events) |
| FR-5 | Compute **FDV** per asset: `fdvUSD = priceUSD × maxSupply`, plus circulating market cap `= priceUSD × totalSupply` (custom `Token` extension) |
| FR-6 | Correctly split revenue into supply-side / protocol-side / stake-side and roll up pool → protocol |
| FR-7 | Expose incrementally-pollable queries (cursor pagination, `_change_block`) so the EMS poller can pull only deltas |
| FR-8 | (Phase 6) Second subgraph implementing Messari **Derivatives Options schema v1.3.2** (`Option` with call/put typing) to complete F&O coverage |

### 3.2 Non-functional

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Freshness: emitted event → queryable | p95 ≤ 15 s on Studio (Upgrade Indexer); measured via `_meta.block.number` vs chain head |
| NFR-2 | Testnet historical sync | Minutes, not hours — achieved by accurate `startBlock` (deploy-at-head) + no per-block handlers; Substreams path optional |
| NFR-3 | Query cost | Stay inside Studio Free Plan (100k queries/month, 3k/day on dev URL) → single poller, 5–10 s cadence, incremental `where` filters |
| NFR-4 | Determinism / reproducibility | `graph codegen && graph build` clean; matchstick unit tests for money-math (fee splits, OI rollups, FDV) |
| NFR-5 | Idempotent restarts | All aggregates recomputable from events; no state depending on handler execution order across blocks |

### 3.3 Success criteria (hackathon demo)

1. A Studio subgraph on Sepolia (or Arbitrum Sepolia) whose `_meta` shows `hasIndexingErrors: false` and head-lag ≤ ~5 blocks.
2. A single GraphQL query returning protocol TVL, long/short OI, funding rate, top open positions, and per-asset FDV.
3. The EMS dashboard/risk endpoint rendering numbers sourced from the subgraph (screenshot-able for judges).
4. A 60-second recorded or live demo: trade on the testnet protocol → subgraph reflects OI/funding change within one poll cycle.

---

## 4. Architecture: Options Considered & Decision

| Option | Description | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. Standard subgraph** (AssemblyScript mappings, event handlers) | The classic path; Messari schema + own mappings | Battle-tested pattern; all tooling works on Studio; hackathon-realistic | Sync is linear over history; handler code verbose | ✅ **Phase 1–5** |
| **B. Fork Messari monorepo per-protocol folder** | Copy `subgraphs/<protocol>/`, re-render `subgraph.yaml` via mustache, point at testnet addresses | Schema correctness for free | Repo is **dormant**; its build scripts target old CLI flows; heavy multi-chain config machinery to prune | ⚠️ Use as *reference*, not a fork |
| **C. Substreams-powered subgraph** (Rust `graph_out` module → `.spkg`) | Parallelized extraction; big sync speedups on long histories | 100x-class sync on deep history; composable modules | Rust toolchain + `substreams` CLI + spkg pipeline; SPS publishing to network unverified; overkill when testnet history is short | 🔶 **Phase 7 (optional)** |

**Decision:** Option A with disciplined performance hygiene (§7), heavily borrowing schema correctness from Option B's reference code, keeping C as an escalation path if (and only if) historical sync becomes the bottleneck. This is the minimal-change solution that meets every FR.

**Protocol/venue choice (must be verified before P0):** pick a derivatives protocol with **deployed, verified testnet contracts** on one of the five supported testnets (GMX-family on Arbitrum testnets is the classic candidate; your own mock perp market is the most controllable fallback). Deliverable of P0 includes a `config/testnet.<network>.json` with contract addresses + `startBlock` for: factory/router, vault, position/keeper contracts, oracle (e.g. Sepolia Chainlink ETH/USD aggregator), and ERC20s.

---

## 5. Data Model

### 5.1 Base: Messari Derivatives Perpetual Futures v1.3.4

Start from `schema-derivatives-perpfutures.graphql` (v1.3.4) verbatim. Core entities (full field list is in the upstream schema file — do not trim fields, downstream EMS queries rely on them):

- `DerivPerpProtocol` (implements `Protocol`) — TVL, cumulative/daily volume, OI (long/short/total), position counts, revenue splits, premium paid (entry/exit/deposit/withdraw), user counts, `schemaVersion`/`subgraphVersion`/`methodologyVersion`
- `LiquidityPool` + `LiquidityPoolDailySnapshot` / `LiquidityPoolHourlySnapshot` — `fundingrate: [BigDecimal!]!`, `inputTokenBalances`, `inputTokenWeights`, OI per pool, volume by token
- `Position` + `PositionSnapshot` — `{account}-{pool}-{asset}-{side}-{counter}` ID, `side: LONG|SHORT`, `leverage`, `collateralBalance`, `balanceUSD`, `realisedPnlUSD`, `fundingrateOpen/Closed`, open/close tx hashes
- Events: `Deposit`, `Withdraw`, `Borrow`, `CollateralIn`, `CollateralOut`, `Swap`, `Liquidate` (all implement `Event`)
- `Account` — per-address rollups; `ActiveAccount` helper for DAU; `_ActivityHelper`, `_PositionCounter` internal helpers

**Required schema deviations for testnet (document them in the file header):**

1. Extend the `Network` enum with `SEPOLIA`, `ARBITRUM_SEPOLIA`, `BASE_SEPOLIA`, `OPTIMISM_SEPOLIA`, `POLYGON_AMOY` (additive change → keep `schemaVersion: 1.3.4`, bump `subgraphVersion`).
2. Extend `Token` (below) for FDV — additive fields only.
3. Replace `MAINNET` etc. in configs with the testnet value; the subgraph's `network` field in `subgraph.yaml` must be the registry identifier (`sepolia`, `arbitrum-sepolia`, …), not the GraphQL enum.

### 5.2 Custom extension: FDV & valuation (additive)

```graphql
type Token @entity {
  " Smart contract address of the token "
  id: Bytes!
  name: String!
  symbol: String!
  decimals: Int!
  lastPriceUSD: BigDecimal
  lastPriceBlockNumber: BigInt

  # --- EMS extension (FDV / valuation) ---
  " Total supply, event-derived (Transfer mint/burn accounting) in native units "
  totalSupply: BigInt!
  " Maximum supply parsed from config at init (constructor/immutable cap); fallback = totalSupply "
  maxSupply: BigInt!
  " Fully diluted valuation: lastPriceUSD * maxSupply (scaled by decimals) "
  fdvUSD: BigDecimal
  " Circulating market cap: lastPriceUSD * totalSupply "
  circulatingMarketCapUSD: BigDecimal
  " Block number of the last supply recompute "
  lastSupplyBlockNumber: BigInt
}
```

Methodology notes (also encode in `methodologyVersion: 1.0.0` comments):

- **Price** comes from an on-chain source only — subgraphs cannot ingest off-chain data. Priority: (1) protocol's own oracle events (the schema's `LiquidityPool.oracle` field names the source), (2) a Chainlink aggregator `AnswerUpdated`/`NewRound` handler on a well-known feed (e.g. Sepolia ETH/USD — verify the address at data.chain.link before hardcoding), (3) last swap price from indexed pools. Never mix sources mid-stream without bumping `methodologyVersion`.
- **Supply** must be event-derived: accumulate from ERC20 `Transfer` where `from == address(0)` (mint) / `to == address(0)` (burn), or from protocol mint events. Subgraphs **cannot call arbitrary view functions** like `totalSupply()` on demand — do not plan around that.
- `fdvUSD` recomputes on every price update for all tokens with a non-null price (maintain a token registry `_TokenRegistry` helper list to iterate).

### 5.3 Options (Phase 6)

Second subgraph package, `schema-derivatives-options.graphql` v1.3.2: same backbone (`Token`, `Protocol`, `LiquidityPool`, snapshots) plus `Option` and `Position` with call/put typing. Keep the two subgraphs separate (separate Studio slots — remember the 3-slot account cap; options can share the slot freed after archiving the perp one if needed).

---

## 6. Project Layout (to create under `the-graph/`)

```
the-graph/
├── SUBGRAPH_SPEC.md                  # this document
├── deriv-perp/                       # P0–P5: perp futures subgraph
│   ├── package.json                  # deps: @graphprotocol/graph-cli, graph-ts, matchstick-as (dev)
│   ├── subgraph.yaml                 # dataSources: factory, vault, oracle, router (+ templates for pools)
│   ├── schema.graphql                # Messari v1.3.4 + Network enum + Token FDV extension
│   ├── networks.json                 # multi-network deploy config (P5+)
│   ├── config/
│   │   └── testnet.sepolia.json      # addresses + startBlocks + fee splits (single source of truth)
│   ├── abis/
│   │   ├── Factory.json  Vault.json  Router.json  PositionRouter.json
│   │   ├── Oracle.json   ChainlinkAggregatorV2.json  ERC20.json
│   ├── src/
│   │   ├── constants.ts              # from config/: NETWORK, PROTOCOL_ID, FEE_SPLIT, MAX_SUPPLY map
│   │   ├── factory.ts                # PoolCreated → LiquidityPool + templates
│   │   ├── pool.ts                   # deposits/withdraws/funding/TVL/revenue
│   │   ├── position.ts               # open/close/increase/decrease, CollateralIn/Out, leverage, OI rollups
│   │   ├── liquidation.ts            # Liquidate + liquidator/liquidatee counts
│   │   ├── oracle.ts                 # price updates → Token.lastPriceUSD + FDV recompute
│   │   ├── helpers/
│   │   │   ├── entity.ts             # getOrCreateProtocol/Pool/Account/Position (id conventions)
│   │   │   ├── prices.ts             # price math, BigDecimal scaling by token decimals
│   │   │   └── snapshots.ts          # lazy daily/hourly snapshot emission (event-driven)
│   │   └── token.ts                  # supply accounting → totalSupply/fdvUSD
│   └── tests/
│       ├── pool.test.ts  position.test.ts  fdv.test.ts   # matchstick
├── deriv-options/                    # P6 (same structure, options schema v1.3.2)
├── queries/                          # EMS integration queries (§9)
│   ├── protocol_snapshot.graphql  open_interest.graphql
│   ├── funding_rates.graphql  fdv_tokens.graphql  deltas.graphql
└── scripts/
    ├── poll_indexer_status.py        # _meta head-lag monitor → logs/alert
    └── sync_to_timescale.py          # EMS poller: subgraph → TimescaleDB (matches SYSTEM_DESIGN.md)
```

---

## 7. Indexing Performance Strategy ("real-time, as fast as possible")

Subgraphs are event-driven; the sync cost is dominated by history length and per-event handler cost. On a testnet where you control `startBlock`, this is mostly free. Levers, in the order to apply them:

1. **`startBlock` = contract deployment block (or later).** The single biggest lever. For a hackathon demo, deploy/index from a recent block; testnet history before your contracts is worthless. Never use the default (0/genesis).
2. **No `blockHandler` polling.** Do snapshotting lazily inside event handlers (compare `dayID`/`hourID`, roll the snapshot when the boundary crosses) — the Messari reference implementation pattern. A per-block handler on Sepolia (12 s blocks) is harmless on sync but a per-event-handler design is what survives mainnet and Substreams ports.
3. **O(1) handler work.** No full-collection scans (`pool.pools` derivedFrom arrays), no nested `load` cascades in hot paths; cache `Protocol` in a module-level get-or-create; avoid recomputing snapshots for pools unaffected by the event.
4. **Manifest-level event filtering** where the ABI allows (signature/topic filters in the data source), so irrelevant logs never enter mapping execution.
5. **Static `event.signature` + indexed params** in the ABI file; trim unused ABI entries.
6. **Grafting** (`graft` base in manifest) when re-deploying with mapping-only changes mid-hackathon, to avoid re-syncing from `startBlock`. Schema must stay compatible with the graft base.
7. **Substreams-powered subgraph (Phase 7)** only if historical depth (e.g. months of mainnet data) makes linear sync the bottleneck: Rust map module emitting `sf.substreams.entity.v1.EntityChanges` from a `graph_out` module, packed via `substreams pack` into `.spkg`, `graph init --protocol substreams --spkg <file>`, manifest `kind: substreams` + `source.package.moduleName: graph_out`. Official example: graph-tooling `examples/substreams-powered-subgraph`. Requires Rust + `substreams` CLI + a Substreams endpoint (Sepolia: `sepolia.substreams.pinax.network:443`).
8. **Query-side freshness:** poller reads `_meta` first; only issues data queries when `block.number` advanced. Latency budget: Upgrade Indexer lag (~seconds) + poll interval (5–10 s) ⇒ NFR-1's ≤ 15 s p95.

**Anti-goals:** no per-block handlers, no `skip`-based pagination (docs call it out as slow — use `id_gt` cursors), no `or:` filters where `and:` works, no fetching derivedFrom collections you don't consume.

---

## 8. Roadmap

Phases are sequential; each has exit criteria. This is the implementation backlog for the hackathon branch.

### P0 — Bootstrap & venue verification
- [ ] Pick protocol + network; verify testnet contract addresses on an explorer (deliverable: `config/testnet.sepolia.json` with factory/router/vault/oracle/ERC20 addresses + `startBlock` each)
- [ ] Studio: create subgraph (Title Case name, e.g. "EMS Derivatives Perp Sepolia"); copy **deploy key** (32-hex); note the 3-slot account limit
- [ ] `node -v` ≥ 20.18.1; `npm i -g @graphprotocol/graph-cli` (0.98.1)
- [ ] Scaffold `the-graph/deriv-perp/` per §6 (hand-rolled, do not `graph init` from a stale template)
- **Exit:** config file reviewed against explorer; `graph --version` prints 0.98.x

### P1 — Schema & codegen green
- [ ] Vendor `schema-derivatives-perpfutures.graphql` v1.3.4 → `schema.graphql`
- [ ] Apply §5 deviations (Network enum += testnets; Token += FDV fields; header comment documenting both)
- [ ] `package.json` with `@graphprotocol/graph-ts`, `@graphprotocol/graph-cli`, `matchstick-as` (dev)
- [ ] Minimal `subgraph.yaml` (factory + oracle + ERC20 sources, `templates` for pools), network = `sepolia` (or chosen)
- **Exit:** `graph codegen` generates `generated/schema.ts`; `graph build` passes

### P2 — Core mappings (money paths)
- [ ] `helpers/entity.ts`: ID conventions exactly per Messari docs (`Protocol.id` = factory address; `Position.id = {account}-{pool}-{asset}-{side}-{counter}`; event IDs `{type}-{txHash}-{logIndex}`)
- [ ] `factory.ts`: pool creation → `LiquidityPool` + dynamic template instantiation; `RewardToken`s, `LiquidityPoolFee`s per protocol fee model
- [ ] `position.ts`: open/increase/decrease/close → `Position` open/close fields, `CollateralIn`/`CollateralOut`, leverage, `longOpenInterestUSD` / `shortOpenInterestUSD` rollups (pool → protocol, `Account` counts, `_PositionCounter`)
- [ ] `liquidation.ts`: `Liquidate` + liquidator/liquidatee bookkeeping
- [ ] Usage metrics: `ActiveAccount` per day/hour; `UsageMetricsDailySnapshot` / `UsageMetricsHourlySnapshot` counters via `_ActivityHelper`
- **Exit:** `graph build` clean; event-driven unit tests for one open→increase→close lifecycle assert OI and position fields

### P3 — Metrics, revenue & snapshots
- [ ] Fee split config (`FEE_SPLIT` in `constants.ts`): supply-side vs protocol-side vs stake-side; premia (entry/exit/deposit/withdraw)
- [ ] `FinancialsDailySnapshot` + pool daily/hourly snapshots via lazy boundary-crossing logic in `helpers/snapshots.ts` (incl. `dailyFundingrate`, OI, volume by token)
- [ ] `PositionSnapshot` per position-change event
- [ ] Volume decomposition: inflow/outflow (open vs close notional) per the schema
- **Exit:** test asserting two consecutive daily snapshots roll correctly (day boundary crossing); totals reconcile pool→protocol

### P4 — Price oracle & FDV module
- [ ] `oracle.ts`: Chainlink `AnswerUpdated` (or protocol oracle event) → `Token.lastPriceUSD` (+ `lastPriceBlockNumber`)
- [ ] `token.ts`: `Transfer` mint/burn accounting → `totalSupply`; `maxSupply` from config
- [ ] FDV recompute: on price update, iterate `_TokenRegistry`, set `fdvUSD`, `circulatingMarketCapUSD` (BigDecimal, decimal-scaled)
- **Exit:** `fdv.test.ts` — mint 1,000,000 tokens, price feed update to $3,000 → `fdvUSD = 3,000,000,000`; price→null case leaves FDV stale-but-present (documented)

### P5 — Testnet deploy & validation (the "test now" runbook)
- [ ] `graph auth <DEPLOY_KEY>` (no `--studio` flag)
- [ ] `graph codegen && graph build && graph deploy <subgraph-slug> --version-label 0.0.1`
- [ ] Validate via `queries/*.graphql` against `https://api.studio.thegraph.com/query/<ID>/<NAME>/<VERSION>` (3,000 q/day dev cap)
- [ ] `scripts/poll_indexer_status.py`: log `_meta.block.number` vs chain head (public Sepolia RPC), alert if `hasIndexingErrors` or lag > 25 blocks
- [ ] Demo query pack executed and screenshots captured
- **Exit:** `_meta.hasIndexingErrors == false`; head-lag ≤ ~5 blocks; all §9 queries return data after a scripted testnet trade

### P6 — Options subgraph (completes F&O)
- [ ] `deriv-options/` on schema v1.3.2 (`Option`, call/put typing); reuse price/supply modules
- [ ] Deploy as second Studio subgraph (watch the 3-slot cap)
- **Exit:** combined demo query showing perp OI + options open premium by strike/expiry

### P7 — (Optional) Substreams acceleration
- [ ] Only if historical sync is the bottleneck: Rust `graph_out` module → `.spkg` → `graph init --protocol substreams --spkg` → deploy (§7.7)
- **Exit:** A/B sync-time comparison documented; standard path kept as fallback

### P8 — EMS integration
- [ ] `scripts/sync_to_timescale.py`: single poller, 5–10 s cadence, `_meta` gate, `deltas.graphql` (`where: { _change_block: { number_gte: $lastBlock } }`, `id_gt` cursor pagination)
- [ ] Wire into FastAPI `/api/v1/market/*` (market data endpoints in `SYSTEM_DESIGN.md` §3.5) and risk-engine inputs (OI, funding, liquidity score)
- [ ] Cross-check subgraph TVL vs DefiLlama/Obscura scraper in `data_validation/` (anomaly detection)
- **Exit:** dashboard renders subgraph-sourced metrics; risk endpoints return values

### P9 — (Optional) Hackathon bounty compliance
- [ ] If The Graph's ETHOnline bounty requires network publication: `graph publish` (Arbitrum One/Sepolia, via `cli.thegraph.com/publish`), then query via `gateway.thegraph.com` with an API key
- **Exit:** subgraph ID queryable through the gateway

---

## 9. EMS Integration Contract (queries the EMS will run)

`queries/protocol_snapshot.graphql` — one-shot dashboard payload:

```graphql
query ProtocolSnapshot($protocol: Bytes!) {
  derivPerpProtocol(id: $protocol) {
    name totalValueLockedUSD
    longOpenInterestUSD shortOpenInterestUSD totalOpenInterestUSD
    cumulativeVolumeUSD cumulativeTotalRevenueUSD
    financialMetrics(first: 30, orderBy: days, orderDirection: desc) {
      days dailyVolumeUSD dailyTotalOpenInterestUSD dailyTotalRevenueUSD
      dailySupplySideRevenueUSD dailyProtocolSideRevenueUSD
    }
  }
}
```

`queries/funding_rates.graphql` — live + hourly funding per market:

```graphql
query Funding($pool: Bytes!, $hours: Int!) {
  liquidityPool(id: $pool) {
    fundingrate
    inputTokenBalances inputTokenWeights totalValueLockedUSD
    hourlySnapshots(first: $hours, orderBy: hours, orderDirection: desc) {
      hours hourlyFundingrate hourlyVolumeUSD hourlyTotalOpenInterestUSD
    }
  }
}
```

`queries/open_interest.graphql` — position-level (risk engine inputs: leverage, liquidation proximity):

```graphql
query OpenPositions($pool: Bytes!, $first: Int!, $lastID: Bytes) {
  positions(first: $first, where: { liquidityPool: $pool, hashClosed: null, id_gt: $lastID },
           orderBy: balanceUSD, orderDirection: desc) {
    id side leverage balance balanceUSD collateralBalanceUSD
    account { id openPositionCount }
    fundingrateOpen timestampOpened
  }
}
```

`queries/fdv_tokens.graphql` — FDV view (custom extension):

```graphql
query Fdv($first: Int!, $lastID: Bytes) {
  tokens(first: $first, where: { id_gt: $lastID, fdvUSD_not: null }) {
    id symbol lastPriceUSD totalSupply maxSupply fdvUSD circulatingMarketCapUSD
  }
}
```

`queries/deltas.graphql` — incremental poll (cost control):

```graphql
query Deltas($lastBlock: Int!, $lastID: Bytes, $first: Int!) {
  swaps(first: $first, where: { _change_block: { number_gte: $lastBlock }, id_gt: $lastID }) {
    id hash blockNumber timestamp amountInUSD amountOutUSD
  }
  liquidates(first: $first, where: { _change_block: { number_gte: $lastBlock } }) {
    id amountUSD profitUSD liquidatee { id }
  }
}
```

`scripts/poll_indexer_status.py` — health check:

```graphql
{ _meta { block { number hash timestamp } deployment hasIndexingErrors } }
```

---

## 10. Testing & Validation Plan

| Layer | Tool | Coverage |
|---|---|---|
| Unit (mapping logic) | matchstick (`graph test`, `matchstick-as`) | Day/hour boundary snapshot rolls; fee split arithmetic; FDV scaling; position counter edge cases (same account+side reopen → counter increments); liquidation bookkeeping |
| Money-math invariants | matchstick asserts | `cumulativeSupplySide + protocolSide + stakeSide == total`; `longOI + shortOI == totalOI`; inflow/outflow decomposition reconciles with volume |
| Deployment validation | `_meta` + head-lag monitor | `hasIndexingErrors`, lag ≤ 5 blocks |
| Data sanity | `data_validation/` cross-checks | Subgraph TVL/OI vs protocol's own UI numbers on the testnet; DefiLlama comparison for any mainnet sibling |
| E2E demo | Scripted testnet trade | Trade → poll within one cycle → OI/funding/position delta visible (the 60-second judge demo) |

---

## 11. Risks, Limits & Open Questions

| Risk | Impact | Mitigation |
|---|---|---|
| Chosen protocol has **no verified testnet deployment** (addresses unverifiable) | Blocks P0 | Fallback: deploy own minimal mock perp market emitting position/collateral/funding events; or switch network to wherever the protocol's testnet lives (all 5 candidate testnets are Studio-deployable) |
| Subgraphs **cannot read arbitrary contract state** (e.g. `totalSupply()`, mark price getters) | FDV/price must be event-derived | §5.2 methodology: oracle events + Transfer-based supply; validate against explorer readouts |
| Studio limits: 3 deployed subgraphs/account, 3k queries/day on dev URL, 100k/month free | Poller cost, slot juggling | Single poller + `_meta` gating + cursor deltas; archive unused slots |
| Upgrade Indexer is a single dev-focused indexer | Occasional lag/restarts on Studio | NFR-1 tolerances; `hasIndexingErrors` alerting; reploy with graft if stuck |
| `--studio` flag / hosted-service tutorials are stale | Wasted cycles | Use only the commands in §P5 (verified against CLI 0.98.1 source) |
| Messari reference repo is dormant | Bit-rot in helpers | Vendor the schema only; write mappings fresh; pin dependency versions |
| BigDecimal division/rounding drift in funding-rate APR math | Wrong EMG metrics | Integer-first math scaled by decimals; matchstick golden-value tests |
| Open: exact Sepolia Chainlink ETH/USD feed address | Price module | Verify at data.chain.link during P4 before hardcoding into config |
| Open: whether ETHOnline 2026 The Graph bounty requires network publication | Bounty eligibility | Check bounty terms during P9; publish path is verified working regardless |

---

## 12. Appendix — Verified Command Runbook (P5, copy-paste)

```bash
# 0. tooling (Node >= 20.18.1)
node -v
npm i -g @graphprotocol/graph-cli          # 0.98.x

# 1. studio: create subgraph at https://thegraph.com/studio/ → copy 32-hex deploy key

# 2. auth (NO --studio flag in current CLI)
graph auth <DEPLOY_KEY>

# 3. build loop
cd the-graph/deriv-perp
npm install
graph codegen
graph build

# 4. deploy (studio is the default node; version label skips the prompt)
graph deploy <SUBGRAPH_SLUG> --version-label 0.0.1

# 5. query (dev URL, 3k queries/day cap)
# https://api.studio.thegraph.com/query/<ID>/<SUBGRAPH_NAME>/<VERSION>

# 6. health
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"query":"{ _meta { block { number timestamp } hasIndexingErrors } }"}' \
  https://api.studio.thegraph.com/query/<ID>/<SUBGRAPH_NAME>/<VERSION>
```

Manifest skeleton (`subgraph.yaml`) highlights:

```yaml
specVersion: 1.0.0
schema: { file: ./schema.graphql }
dataSources:
  - kind: ethereum
    name: Factory
    network: sepolia            # registry identifier, not the GraphQL enum
    source: { address: "0x…", abi: Factory, startBlock: <deploy block> }
    mapping: { kind: ethereum/models, apiVersion: 0.0.9, language: wasm/assemblyscript,
               entities: [DerivPerpProtocol], abis: […], file: ./src/factory.ts }
templates:
  - name: LiquidityPool
    kind: ethereum
    network: sepolia
    # pool-level sources (Vault/PositionRouter/Oracle events)
```

---

*End of specification. Implementation should proceed P0 → P5 for the hackathon testnet demo; P6–P9 are stretch.*
