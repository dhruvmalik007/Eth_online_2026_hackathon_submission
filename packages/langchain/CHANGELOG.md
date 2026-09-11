# Changelog

All notable changes to `@ethonline2026/langchain-agent` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-10

First release of the agent package: a 5-node LangGraph state machine that
fuses an LLM reasoning core (Gemini 2.5 family, multi-family registry) with
TimesFM-3 probabilistic forecasts over TimescaleDB time-series — the
implementation of `docs/timeseries-model-architecture.md`.

### Added

- **v0.1 agent** (`src/graph/v01/`): the 5-node cycle from the architecture
  doc — deterministic Protocol Ingestion (Category A rule text / Category B
  TimescaleDB vectors), LLM Legal & Rule Parsing into a strict zod
  `ConstraintSchema` (one bounded re-ask, per-constraint provenance), TimesFM-3
  Temporal Yield Prediction (14–30 day quantile matrices), Quant Synthesis
  over deterministically pre-computed risk, and the Readjustment Engine
  emitting the zod-enforced execution matrix (Σ allocations ≈ 100,
  transaction-ready parameters only, never raw calldata).
- **Guardrail module** (`src/graph/v01/guardrails.ts`): quantile monotonicity,
  k·σ scale sanity, citation trace-check (uncited numeric claims = hallucination
  ⇒ regenerate once ⇒ typed failure), amount-sum invariant — folded into a
  deterministic risk gate that forces HOLD + one bounded re-plan cycle
  (`synthesisRuns ≤ 2`).
- **TimesFM-3 integration** (`src/services/timesfm3/`): typed client for the
  deployed `timesfm3-inference` Cloud Run service (GPU, 330M, context 16384,
  9 quantiles, `/predict` + `/predict/protocol` + `/finetune/*`), a transport
  port with offline fixture executor, wire-drift rejection (quantile
  monotonicity, row-count cross-checks), and deterministic backtest scoring
  (band hit-rate, median MAPE, strategy-vs-hodl).
- **TimescaleDB store** (`@ethonline2026/timeseries`, new workspace package):
  hypertables (`pool_metrics_hourly`, `timesfm_forecasts`, `backtest_runs`),
  typed client over a `SqlRunner` port, idempotent batch upserts, metric
  windows as the Category B matrix source.
- **Model registry** (`src/config/modelRegistry.ts`): per-node LLM roles
  (parser / synthesis) resolved from env (`LANGCHAIN_MODEL_<ROLE>`), default
  `google-vertexai:gemini-2.5-flash-lite`, other families via `initChatModel`
  spec strings without code changes.
- **Scoped execution authorization** (`src/execution/authorization.ts`):
  dry-first, HITL-gated conversion of an approved readjustment matrix into
  per-protocol allowances (allocation% × portfolio USD cap, session expiry).
  Deterministic gates reject proposals failing the backtest threshold
  (hitRate ≥ 0.7, MAPE ≤ 0.25), carrying uncited decisions, unbalanced
  allocations, or unknown action verbs. The LLM proposes; the wallet
  contract enforces scope.
- **Category-A rule corpus** (`src/graph/v01/corpus.ts`): curated rule docs
  for aave-v3, uniswap-v4, rocket-pool, morpho (lockups, slashing, fee tiers,
  LTV/liquidation, hook restrictions).
- **Level-A v0.1 probe** (`probe:levelA-v01`): LLM-free verification of the
  TimesFM-3 wire contract, guardrail rejections, backtest scoring, and
  scoped authorization — exits non-zero with enumerated failures.
- **Docs**: TimesFM-3 service contract (pinned from build logs + live
  probes), v0.1 verification walkthrough, research round verdicts.

### Changed

- Tool suite is now exclusively thin adapters over `@ethonline2026/graph-fno-indexer`
  query templates — inline SDL removed from all 16 consumer files.
- `SubgraphClient` health is schema-validated and block-flattened;
  `SubgraphHealthTool` consumes the flattened shape (fixes a latent
  parse-against-wrong-shape bug).

### Fixed

- Post-merge validation refactor repaired (`validateDefinition` brace,
  `declaredVariableNames` rename completion, `usedVariableNames` signature).
- CLI positionals were never captured — `graph-fno query <file>` always threw
  the usage error; `parseArgs` now stores the first positional.
- Polygon Amoy wired to its own viem chain (`polygonAmoy`, id 80002) and a
  dedicated `RPC_URL_POLYGON_AMOY` env key (was silently reusing Sepolia).

[0.1.0]: https://github.com/dhruvmalik007/Eth_online_2026_hackathon_submission/releases/tag/langchain-agent-v0.1.0
