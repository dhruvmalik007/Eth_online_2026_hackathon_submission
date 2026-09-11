# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-09-11

The first release: a working collection → validation → derivation → temporal
history path, verified end-to-end against the hosted services it depends on.

### Added

**Collection (Python worker, `scraper/`)**

- Camoufox-driven transport with realistic fingerprinting, bounded retry with
  backoff, a per-source timeout and guaranteed teardown. Two narrow ports —
  `PageFetcher` and the composed `DetailReader` — so a source depends only on the
  capability it uses.
- `L2BeatSource`: the five decentralisation dimensions (state validation, data
  availability, exit window, sequencer failure, proposer failure), the Stage, and
  value secured. Raw dimension strings are retained verbatim so a classifier
  change stays auditable against what L2Beat published.
- `DiscourseSource`: roster-driven, covering the governance forums that expose a
  Discourse JSON API. Determines each proposal's stage from its bracket prefix
  and derives open/closed status from forum metadata.
- `MarketMakerSource` + `MarketMakerDetailSource`: the DefiLlama leaderboard
  (grade, composite and sub-scores, 30-day depth/volume/spread/uptime, FDV) plus,
  from each maker's detail drawer, the four KPI breakdown families (depth at
  50/100/200 bps with percentile and rank, volume, spread, KPI adherence) and the
  CEX/DEX venue coverage that exists nowhere else on the page.
- `roster.json`: a curated, version-controlled target list. Per-protocol transport
  state records *why* an unverifiable forum is excluded rather than silently
  omitting it.
- Sweep orchestration with structured logging (human-readable, or JSON via
  `RISK_LOG_FORMAT=json` for Cloud Logging) and failure isolation: a broken
  source is recorded as `failed` with its error and writes no records, so a
  truncated snapshot is never published.

**Derivation and read path (TypeScript, `src/`)**

- The published contract in zod, mirrored 1:1 by pydantic on the write side, with
  a fixture-based drift test feeding real Python output through the TypeScript
  schemas.
- Branded units (`Usd`, `Pct`, `DecimalRate`, `Bps`, `Days`) so a unit mix-up is a
  compile error rather than a wrong number. `NewType` mirrors them in Python.
- `deriveRiskAdjustment`: deterministic, pure, hand-computed golden tests. Produces
  the five parameters the Black-Scholes/Merton math consumes — volatility (after
  the chain-regime multiplier), risk-free rate (after the chain premium),
  collateral haircut, probability-of-default load and liquidity score — each with
  the inputs that produced it.
- `RiskProfileReader`, composed of four ≤4-method ports, with every read validated
  against the schema and reporting freshness so staleness is visible rather than
  masked.
- `RiskStore` with a GCS adapter and a local-directory adapter, plus a
  `createRiskProfileReader` factory that imports the GCS SDK lazily so a
  local-only run never loads it.

**Temporal history and covariates**

- Four TimescaleDB hypertables added to `packages/timeseries`:
  `chain_risk_history`, `protocol_governance_history`, `market_maker_metrics` and
  `security_incidents`, each with a `raw` jsonb column beside the parsed ones.
- `EMBEDDING_KINDS` extended with `governance_proposal`, `security_incident`,
  `chain_risk` and `market_maker`; the `kind` CHECK constraint is dropped and
  re-added by a tested migration step rather than left to drift.
- Temporal write mappings, and a covariate builder that aligns risk series onto a
  target grid by forward-fill — never interpolation, because a step function has
  no intermediate values to report.
- **The TimesFM-3 alignment contract is enforced at construction.** Every
  past-covariate row must equal the target series length; the deployed service
  answers a mismatch with HTTP 500 rather than a 4xx, so the guard turns an
  opaque model outage into a message naming the covariate and both lengths.

**Consumer integration**

- `apps/indexer`: three risk routes (`/api/risk/chains`, `/api/risk/protocols`,
  `/api/risk/adjustment`), a lazily-resolved reader shared with the v0.1 graph,
  and health reporting that distinguishes an unconfigured store from an
  unreadable one.
- `packages/langchain`: `riskProfile` state annotation, a chain-risk extraction
  step in the synthesis node, three risk tools, and a guardrail that validates a
  risk payload against the derivation's documented ranges and verifies that a
  `risk-*` citation resolves to the context actually in state.
- `MertonPDTool` now takes its parameters from the derivation when a chain is
  named, replacing the hardcoded 5% risk-free rate, the collateral-ratio
  volatility proxy and the unadjusted PD. Every fallback preserves the previous
  behaviour, and the output names which source supplied each parameter.

**Operations**

- `container/Dockerfile`: a Cloud Run Job image with strict layer caching. The
  browser install path is pinned via `XDG_CACHE_HOME` — Camoufox does not honour
  `PLAYWRIGHT_BROWSERS_PATH`, and getting this wrong is silent at build time and
  fatal at runtime.
- `docs/deployment-runbook.md`: the exact `gcloud` commands, with the cost shape
  and the deliberately absent resources (no managed Postgres — the existing
  instance already holds the history).
- `docs/risk-pipeline-solution.md`: the architecture, the trade-offs, and the
  evidence behind each engineering-standard claim.

### Fixed

- The L2Beat dimension parser assumed a heading order the page does not use, so
  it silently skipped the first dimension. It now resolves each heading
  independently.
- The market-maker table parser stripped the tabs that delimit its columns,
  collapsing the row structure.
- `"Random discussion thread"` was classified as a *discussion-stage proposal*
  because the classifier matched the word anywhere in the title; it is now
  anchored to the bracketed prefix.
- The manifest reported the pre-truncation record count, so a `--limit` run
  advertised documents that were never written.
- `l2BeatUrl` vs `l2beatUrl`: pydantic capitalises after a digit, which the
  TypeScript schema rejected. Caught by the cross-language drift test.
- The sweep orchestration constructed its own browser, making the failure paths
  untestable without one; the fetcher is now injected.

### Security

- Every upstream payload is validated before use, and no credential is read
  outside a composition root.

[Unreleased]: https://example.invalid/compare/v0.1.0...HEAD
[0.1.0]: https://example.invalid/releases/tag/v0.1.0
