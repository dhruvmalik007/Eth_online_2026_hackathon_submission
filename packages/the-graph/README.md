# GraphQL F&O Indexer Client (`@ethonline2026/graph-fno-indexer`)

Ops-grade TypeScript client that turns The Graph subgraphs into the **data-indexation
framework** for the Agentic EMS: F&O (perp futures + options), liquidity, FDV and
trading metrics, batched through typed classes with a CLI and an optional wallet layer.

Companion to `SUBGRAPH_SPEC.md` (the subgraph build roadmap). This package is the
**consumer side**: it queries whatever the spec's P1–P6 phases deploy, plus any
curated network subgraph.

## Architecture

```
src/
├── query/                  QUERY TEMPLATE CORE (see "Query templates" below)
│   ├── QueryDefinition.ts  defineQuery(): id + SDL + zod variables/response + pagination
│   ├── QueryRegistry.ts    id-keyed catalog; duplicate ids fail fast
│   └── scalars.ts          wire scalars (big-number strings, bytes32, addresses, RAY)
├── config/
│   ├── env.ts            zod-validated env; chain registry (5 Studio testnets)
│   └── endpoints.ts      3 tiers: studio (own deploys) / network (gateway+key) / mcp
├── clients/
│   ├── SubgraphTransport.ts transport interface (DIP) + GraphQLClient adapter
│   └── SubgraphClient.ts  executeTemplate (validated vars + response), health, cursor collectAll
├── queries/                QUERY CATALOG — single source of truth for every GraphQL query
│   ├── fno/                protocolSnapshot, funding, openPositions, fdvTokens, deltas
│   ├── lending/            Aave V3 reserves / pool metrics / risk params / probe
│   ├── dex/                Uniswap V3 pools (+volume-ordered, metrics) + full V4 catalog
│   ├── prediction/         Polymarket probe + activity feed
│   └── health/             indexerMeta
├── registry/
│   └── SubgraphRegistry.ts endpoint refs -> clients; firstHealthy() fallback chain
├── fno/
│   └── FnoDataExtractor.ts Messari derivatives schema ops: OI, funding, positions, FDV, deltas
├── wallet/
│   └── WalletSigner.ts    OPTIONAL signing (Ledger v2 payload / private-key / readonly)
└── cli.ts                 graph-fno CLI
```

## Query templates (added 2026-09-09)

Every GraphQL query in the package is a **QueryDefinition template** — never an
inline string. A template couples the parameterized SDL (variables only; value
interpolation is banned and fail-fast checked), a zod schema validating request
variables *before* the network call, a zod schema validating the wire response
*after* it arrives (subgraph schema drift throws `SubgraphValidationError`), and
an optional `id_gt` cursor pagination spec.

```ts
import { fnoFunding } from '@ethonline2026/graph-fno-indexer';
// client.executeTemplate(fnoFunding, { pool, hours }) — fully inferred, validated both ways
```

To add a protocol: create `src/queries/<domain>/<query>.ts` with `defineQuery`,
export it from `src/queries/index.ts` + root `index.ts`, and consume it through
`SubgraphClient.executeTemplate` / `collectAll` (or an extractor in
`FnoDataExtractor`). The LangChain package's legacy inline-SDL layer was removed
in this migration — the archived originals live in `archive/langchain-graphql-legacy/`.

## Setup

```bash
cd the-graph
cp .env.example .env       # fill GATEWAY_API_KEY (+ endpoints) — see below
npm install
npm run typecheck && npm test
```

### Environment (from `.env.example`)

| Variable | Required for | Notes |
|---|---|---|
| `GATEWAY_API_KEY` | network-tier queries, MCP server | Subgraph Studio → API Keys |
| `STUDIO_PERP_SEPOLIA_ENDPOINT` | your own perp subgraph | after SPEC P5 deploy |
| `WALLET_MODE` | on-chain interaction only | unset = readonly (data-only works) |
| `WALLET_PRIVATE_KEY` | private-key mode | **testnet-only throwaway** |
| `WALLET_LEDGER_PATH` + `WALLET_ADDRESS` | ledger mode | v2 payload; key never leaves device |

## The Graph Subgraph MCP server

Install once per machine (Command Code example — same shape for Claude/Cursor):

```bash
cmd mcp add subgraph \
  --env GATEWAY_API_KEY=$GATEWAY_API_KEY \
  -- npx mcp-remote --header "Authorization:\${AUTH_HEADER}" https://subgraphs.mcp.thegraph.com/sse
```

Check inside a session with `/mcp`. Tools you get: schema by deployment/subgraph/IPFS id,
execute query, keyword search, top deployments for a contract, 30-day query volumes.
`mcp.subgraph.json` holds the same config as JSON for scripting.

## CLI

```bash
npm run cli -- health                              # _meta on every configured endpoint
npm run cli -- extract-fno --protocol 0x... --pool 0x... --out fno.json
npm run cli -- deltas --since-block 5_000_000      # incremental poller pull
npm run cli -- dry-run --network sepolia           # end-to-end testnet dry run
npm run cli -- wallet-status                       # resolve signer without transacting
npm run cli -- query queries/fdv_tokens.graphql --vars '{"first":50}'
```

## Library use (EMS poller / risk engine)

```ts
import { SubgraphRegistry, FnoDataExtractor } from '@ethonline2026/graph-fno-indexer';

const registry = SubgraphRegistry.fromEnv(process.env);
const client = await registry.firstHealthy();          // studio -> network fallback
const fno = new FnoDataExtractor(client);

const view = await fno.fnoView({ protocolId, poolId }); // OI + funding + positions + FDV
const deltas = await fno.deltas(lastSeenBlock);        // _change_block incremental pull
```

## Wallet notes (Ledger EOA)

The Ledger is treated as an **external EOA**: signing is only needed for on-chain
actions (e.g. scripted testnet trades so the subgraph has events to index). Data
extraction never signs. Two supported modes:

1. **Ledger (preferred)** — v2 payload (`WALLET_LEDGER_PATH` + `WALLET_ADDRESS`).
   Private keys never leave the secure element. Headless CLI signing requires the
   Ledger Connect Kit bridge (browser context) — `dry-run` reports this precisely
   instead of failing silently.
2. **Throwaway private key (testnet-only)** — `WALLET_MODE=private-key`.
   Never reuse a key funded with mainnet assets.

A smart-account (ERC-4337) path can be added later by wrapping `WalletSigner.session()`
with a `SmartAccountClient` (viem + `permissionless`), keeping the same interface.

## Ops principles encoded

- every network call time-boxed (`AbortSignal.timeout`) — no unbounded awaits
- `_meta` health gate before data pulls; `hasIndexingErrors` surfaced immediately
- cursor pagination (`id_gt`) only — never `skip`/offset
- deltas via `_change_block` — cost-controlled polling within Studio free tier
- no secret ever committed: `.env` ignored, MCP key via env interpolation
