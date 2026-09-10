# Changelog

All notable changes to `@ethonline2026/graph-fno-indexer` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-09

First release of the package: a templated, schema-validated GraphQL client for
The Graph, serving as the data-indexation layer of the Agentic EMS.

### Added

- **Query-template core** (`src/query/`): `defineQuery()` couples a parameterized
  SDL (variables only — value interpolation is banned and fail-fast checked) with
  zod schemas validating request variables *before* the network call and wire
  responses *after* receive; `QueryRegistry` indexes templates by unique id;
  `PaginationSpec` drives `id_gt` cursor pagination; wire scalars
  (`ZodBigNumberString`, `ZodBytes32`, `ZodAddress`, `ZodRayRate`).
- **Query catalog** (`src/queries/`, 26 templates — the single source of truth
  for every GraphQL query in the package):
  - `fno/`: protocol snapshot, funding, open positions, FDV tokens, deltas
    (Messari Derivatives Perpetual Futures schema v1.3.4).
  - `lending/`: Aave V3 reserves, pool metrics, risk params, health probe.
  - `dex/`: Uniswap V3 pools (+ volume-ordered and metrics variants, probe) and
    the full Uniswap V4 catalog (poolManager, pool state, top/hooked pools,
    hourly/day series, token series, swaps, token data, positions).
  - `prediction/`: Polymarket probe (payout-ordered) and activity feed
    (recency-ordered).
  - `health/`: indexer `_meta`.
- **Transport port + adapter** (`src/clients/`): `SubgraphTransport` interface
  with a `graphql-request` adapter; `SubgraphClient.executeTemplate()` validates
  variables and responses around every send; `collectAll()` paginates strictly
  by `id_gt` cursors (no `skip`); `health()` returns a validated, block-flattened
  `SubgraphHealth`. Schema drift raises `SubgraphValidationError` with typed
  issue paths; transport failures raise `SubgraphTransportError`.
- **Derived response types**: per-template response types exported from the
  package root via a `ResponseOf` helper — never hand-written.
- **FnoDataExtractor** (`src/fno/`): Messari derivatives operations
  (protocol snapshot, funding, open positions, FDV tokens, `_change_block`
  deltas, aggregate `FnoView`) executed through templates; public method
  signatures unchanged from the pre-template API.
- **Registries** (`src/registry/`): `SubgraphRegistry` (endpoint refs → clients,
  `firstHealthy()` tier fallback, health reports) and `ProtocolRegistry`
  (category/protocol/network resolution across lending, perps, DEX and
  prediction markets), composing clients through the transport adapter.
- **CLI** (`graph-fno`): `health`, `query`, `extract-fno`, `deltas`,
  `dry-run`, `wallet-status`, `list-protocols`, `test-data`.
- **Wallet** (`src/wallet/`): optional signing sessions — Ledger v2 payload,
  private-key (testnet only), or read-only default.
- **Tooling**: `graphclient` config, MCP subgraph loader + manifest, strict
  `tsconfig` (incl. `exactOptionalPropertyTypes`), eslint (no-unused-vars
  strict with `^_` ignores) and vitest setup.
- **Tests**: 36 offline tests covering query-definition fail-fast validation,
  wire scalars, registry guarantees, template execution and pagination via an
  in-memory transport, health flattening, and catalog-wide integrity (unique
  ids, SDL/schema variable parity).

[0.1.0]: https://github.com/dhruvmalik007/Eth_online_2026_hackathon_submission/releases/tag/the-graph-v0.1.0
