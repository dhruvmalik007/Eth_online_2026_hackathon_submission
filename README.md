<div align="center">

# Agentic EMS

**An execution management system for on-chain fixed income — deterministic strategies, verifiable risk, and agent-orchestrated execution across The Graph, Arc, 1inch Aqua, Uniswap v4 and Ledger.**

[![Node](https://img.shields.io/badge/node-%E2%89%A522.6-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%E2%89%A510-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Turborepo](https://img.shields.io/badge/build-turborepo-EF4444?logo=turborepo&logoColor=white)](https://turbo.build)
[![Python](https://img.shields.io/badge/python-3.11%2B-3776AB?logo=python&logoColor=white)](https://www.python.org)

[Overview](#overview) · [Tracks](#hackathon-tracks) · [Layout](#repository-layout) · [Quick start](#quick-start) · [Commands](#commands) · [Environment](#environment) · [Quality](#quality-gates) · [Deploy](#deployment) · [Conventions](#conventions)

</div>

---

## Overview

Agentic EMS is a **pnpm + Turborepo monorepo** for trading fixed income on-chain. It pairs
long-horizon context-learning agents with classical quant risk (Greeks, carry, duration) so a
desk can build multi-asset portfolios that emphasise stability over chart patterns.

Three properties are load-bearing:

- **Deterministic execution.** A run moves through an explicit lifecycle; every step transition is
  written inside a transaction, so a partial write can never look like a completed execution.
- **Verifiable risk.** Subgraph data is schema-validated on the way in, and every forecast carries
  provenance back to the block it was computed at.
- **Self-custody.** Signing is device-backed (Ledger DMK) or embedded (Privy) — the service never
  holds a key it can spend with.

## Hackathon tracks

| Track | Where it lives |
|---|---|
| **The Graph — composable / standardized subgraph products** | `packages/the-graph` (Messari registry, 197 deployments) |
| **1inch — Aqua / SwapVM** | `packages/oneInch`, `packages/uniswap` |
| **Circle Arc** | `packages/arc` |
| **Ledger — device-backed signing** | `packages/custody` (DMK) |
| **Privy — embedded smart accounts** | `packages/custody`, `apps/execution`, `apps/agentic-ems` |
| **Uniswap Foundation — v4 hooks / positions** | `packages/uniswap` |

## Repository layout

```
.
├── apps/                     deployable services and front ends
│   ├── agentic-ems/          Next.js operator surface (landing, demo, studio)
│   ├── execution/            per-user strategy execution service (Cloud Run)
│   ├── inferrence/           agent orchestration + inference microservice
│   ├── indexer/              serverless API (Vercel functions)
│   └── fork-execution/       Anvil fork backtest harness
├── packages/                 shared libraries
│   ├── the-graph/            The Graph / Messari data client
│   ├── langchain/            agent graph, tools and forecast provenance
│   ├── timeseries/           TimescaleDB store, repositories, read models
│   ├── execution-domain/     zero-I/O execution vocabulary and state machine
│   ├── bridges/              LI.FI / LayerZero / Circle CCTP adapters
│   ├── order-execution-layer/order routing and intent batching
│   ├── oneInch/              1inch Aqua + SwapVM execution layer
│   ├── uniswap/              Uniswap v4 pool, hook and position adapters
│   ├── custody/              Ledger DMK + Privy signing and intents
│   ├── arc/                  Arc L1 wrapper (CCTP V2, App Kit)
│   ├── ux-workflow/          Terminal Noir design system
│   ├── risk-analysis-data-pipeline/  Python ETL for macro/governance/cyber risk
│   └── reactor-video/        Python pipeline that turns a reference video into a persona brief
├── docs/                     architecture and model notes
├── data/                     curated metric snapshots and prize context
└── turbo.json                task graph (build → typecheck/test)
```

## Packages

| Package | Description |
|---|---|
| [`@ethonline2026/graph-fno-indexer`](./packages/the-graph) | Ops-grade The Graph client: F&O, lending, DEX, prediction and liquid-staking categories over Messari standardized subgraphs. |
| [`@ethonline2026/langchain-agent`](./packages/langchain) | Agentic inference layer — graph, tools and forecast provenance for Bloomberg-style risk analytics. |
| [`@ethonline2026/timeseries`](./packages/timeseries) | TimescaleDB store: hypertables, the `exec_*` execution schema, repositories and tenant-scoped read models. |
| [`@ethonline2026/execution-domain`](./packages/execution-domain) | The execution contract — step vocabulary, run lifecycle and branded lineage ids. Zero I/O. |
| [`@ethonline2026/bridges`](./packages/bridges) | LI.FI, LayerZero and Circle CCTP behind one provider-agnostic port. |
| [`@ethonline2026/order-execution-layer`](./packages/order-execution-layer) | The capability port and venue registry between the domain and the adapters. |
| [`@ethonline2026/oneinch-aqua`](./packages/oneInch) | 1inch Aqua + SwapVM program builders, gating policy and Morpho vault adapter. |
| [`@ethonline2026/uniswap`](./packages/uniswap) | Uniswap v4 pool identity, hook admission and position/yield adapters. |
| [`@ethonline2026/custody`](./packages/custody) | Ledger DMK and Privy signers, EIP-712 helpers, intent construction and batch signing. |
| [`@ethonline2026/arc-client`](./packages/arc) | Arc L1 wrapper: CCTP V2 burn-and-mint and the Arc App Kit. |
| [`@ethonline2026/ux-workflow`](./packages/ux-workflow) | Shared Terminal Noir design system built on real shadcn/ui primitives. |
| [`@ethonline2026/risk-analysis-data-pipeline`](./packages/risk-analysis-data-pipeline) | Python ETL for chain (L2Beat), governance (Discourse) and cyber (DeFiLlama) risk. |
| [`reactor-video`](./packages/reactor-video) | Python pipeline that segments a reference video and generates a persona brief. |

## Applications

| App | Package | Description |
|---|---|---|
| [`apps/agentic-ems`](./apps/agentic-ems) | `agentic-ems-landing` | Next.js operator surface: landing page, stage-based demo, studio and live execution. |
| [`apps/execution`](./apps/execution) | `@ethonline2026/execution` | Per-user execution service: simulate, rank, sign, broadcast and track. |
| [`apps/inferrence`](./apps/inferrence) | `@ethonline2026/inferrence` | Sandboxed agent sessions, TimesFM forecasts and SSE streaming. |
| [`apps/indexer`](./apps/indexer) | `@ethonline2026/indexer` | Serverless API over the agent cycle, forecast ledger and risk routes. |
| [`apps/fork-execution`](./apps/fork-execution) | `@ethonline2026/fork-execution` | Pinned Anvil forks with recorded, verifiable evidence. |

## Requirements

- **Node.js ≥ 22.6** (`engines.node`)
- **pnpm ≥ 10** — this repo is pnpm-only (`packageManager: pnpm@10.28.0`)
- **Python 3.11+** for the ETL and video packages
- Optional: Docker, Foundry (`forge`/`anvil`), the Vercel and gcloud CLIs for deploys

## Quick start

```bash
git clone https://github.com/dhruvmalik007/Eth_online_2026_hackathon_submission.git
cd Eth_online_2026_hackathon_submission

corepack enable           # activates the pinned pnpm
pnpm install              # installs every workspace package

cp packages/<pkg>/.env.example packages/<pkg>/.env    # where an example is provided
pnpm build                # turbo: build every package in dependency order
pnpm typecheck            # turbo: strict tsc across the workspace
pnpm test                 # turbo: unit + integration suites
```

Never run `npm install` or `yarn` — the lockfile is `pnpm-lock.yaml` and the workspace protocol
(`workspace:*`) is required for local package resolution.

## Commands

Root scripts (Turborepo):

| Command | What it does |
|---|---|
| `pnpm build` | Build all packages in dependency order |
| `pnpm typecheck` | Type-check the workspace |
| `pnpm test` | Run all suites |
| `pnpm dev` | Run persistent dev tasks (apps) |
| `pnpm clean` | Remove build output and `node_modules` |
| `pnpm build:graph` / `:arc` / `:langchain` / `:inferrence` | Build a single package |

Scoped to one workspace (preferred while developing):

```bash
pnpm --filter @ethonline2026/timeseries typecheck
pnpm --filter @ethonline2026/timeseries test
pnpm --filter @ethonline2026/execution build
pnpm --filter agentic-ems-landing dev
```

Python packages:

```bash
cd packages/risk-analysis-data-pipeline/scraper && pytest && ruff check . && mypy .
cd packages/reactor-video && pytest
```

## Environment

Configuration is per package/app; copy the nearest `.env.example` and fill it in. Grouped:

| Area | Variables |
|---|---|
| Time-series store (Tiger Cloud / TimescaleDB) | `TIMESERIES_DATABASE_URL` |
| The Graph | subgraph API keys and endpoint overrides (see `packages/the-graph/src/config/endpoints.ts`) |
| Execution service | `EXECUTION_MODE`, `EXECUTION_EVENT_BUFFER`, `PORT` |
| Privy | `NEXT_PUBLIC_PRIVY_APP_ID` (public identifier only) |
| Arc | `ARC_TESTNET_RPC_URL`, `ARC_TESTNET_USDC`, `ARC_PRIVATE_KEY` |
| Google Cloud | `GOOGLE_SERVICE_ACCOUNT_KEY` / `GOOGLE_APPLICATION_CREDENTIALS` |
| Inference | `GATEWAY_API_KEY`, sandbox provider settings |

**No secret belongs in the repository.** `.env*`, `*.pem`, and `*-creds.md` are gitignored;
a `postinstall` hook rejects credential-shaped files from the index.

## Quality gates

```bash
pnpm turbo run build typecheck test         # the gate CI runs
```

Live checks against real services (not part of the default gate):

```bash
# TimescaleDB execution store — 29 checks, writes and removes its own probe rows
TIMESERIES_DATABASE_URL=... pnpm --filter @ethonline2026/timeseries exec tsx scripts/verify-execution.ts

# The Graph — probe every Messari deployment and record a liveness verdict
pnpm --filter @ethonline2026/graph-fno-indexer probe:messari
```

## Deployment

| Target | What ships |
|---|---|
| **Vercel** | `apps/indexer` (functions + `vercel.json`) and `apps/agentic-ems` (Next.js) |
| **Cloud Run** | `apps/execution` (long-lived service) and `apps/inferrence` |
| **Tiger Cloud / TimescaleDB** | schema applied by `packages/timeseries/src/migrate.ts` |

Container builds use each app's `Dockerfile`; `.dockerignore` and `.gcloudignore` are checked in.

## Conventions

- **Conventional Commits**, scoped to the package: `feat(timeseries): …`, `fix(custody): …`.
- One commit per concern; commit bodies explain *why*, not just *what*.
- **One package per branch**, then a PR. `main` advances only through a reviewed PR — never a
  direct push — and PRs are merged with a **merge commit** so per-ticket history survives.
- AI-assisted commits carry an attribution footer plus
  `Co-authored-by: CommandCodeBot <noreply@commandcode.ai>`.
- Keep cross-package changes out of a package's commit series.

## Security

- Signing keys are never committed. The `arc` probe requires `ARC_PRIVATE_KEY` from the
  environment and fails closed if it is absent.
- Credential files (`*-creds.md`) and every `.env` are gitignored as defence in depth.
- If a secret is ever committed, **rotate it** — history is not a safe place.

## Contributing

1. Branch from `main`: `git switch -c feat/<area>-v0.1`.
2. Keep the change to one package where possible; add tests for new behaviour.
3. Run `pnpm turbo run build typecheck test` and make it green **before** committing.
4. Open a PR with a short "why / what / verification" body; merge with a merge commit.

## Licence & attribution

See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) and [`licenses/`](./licenses) for vendored
components. Product screenshots and the video pipeline are documented in
[`packages/reactor-video`](./packages/reactor-video).
