# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

**Cyber risk: the security-incident collector (issue #13's third area)**

- `IncidentSource` reads DeFiLlama's hacks feed and emits `SecurityIncident`
  records for roster subjects. Against the live feed: 1,268 records produce 18
  incidents across 9 protocols, spanning all four severity bands.
- `SecurityIncident` and `IncidentFeed` complete the Python half of a contract
  the TypeScript side already declared. The `security_incidents` table, its zod
  row schema, its embedding kind and its covariate builder all shipped in v0.1.0
  with no producer. **No migration is needed** to store this collector's output:
  `types.ts` says as much — *"the table exists so the schema is complete and a
  collector can be added without a migration"*.
- `ManifestTemporal.securityIncidents` records the count, defaulted to zero so
  the change is additive.
- Incidents publish one feed per subject at `risk/incidents/{subject}.json`,
  matching the per-subject shape of the chain and protocol families.

Two derivations are stated rather than hidden:

- **Severity is derived from the disclosed loss**, because the feed publishes
  none. The thresholds sit at the feed's own quartiles (p25 ≈ $180k, median
  ≈ $980k, p75 ≈ $5M) rather than at round numbers, so "high" means "worse than
  about three quarters of recorded incidents". An incident whose amount is
  undisclosed is skipped and counted: there is no honest severity for an unknown
  loss, and labelling it `low` would put a reassuring number where the truth is
  "not stated".
- **Subject attribution is a curated alias table, never a substring match.** The
  feed contains `compounder finance`, `super sushi samurai`, `crosscurve`,
  `hyperliquid malaysia` and `leadblock's morpho blue market`, each of which
  contains a roster slug and none of which is that protocol. All five are listed
  in `EXCLUDED_UPSTREAM_NAMES` with their reason and asserted by test, so an
  exclusion is a recorded decision rather than a silent omission.

### Fixed

- The incident identifier is a digest of the record's own fields, **not** the
  feed's `defillamaId`. That field is a *project* id reused across a project's
  incidents: the same value `337` appears on both the September 2022 and the July
  2025 GMX entries, and likewise for `144` (dYdX), `3` (Curve) and `119`
  (Sushi). Using it collapsed four protocols' histories into a single row each
  and made their embedding subjects ambiguous. Caught by asserting id uniqueness
  against the real feed rather than by inspection.

### Notes

- Chain and market-maker incident subjects are deliberately not produced. The
  feed's `chain` array names where an incident's contracts were deployed, which
  is not the same claim as "this chain was compromised"; attributing it that way
  would manufacture chain-risk signal the data does not support.
- The subject alias table lives in the source module rather than `roster.json`.
  The roster is validated by both languages, so extending it would require a
  matching change to the TypeScript schema; the roster remains the authority on
  which subjects exist, and an alias targeting an unknown slug is dropped rather
  than trusted.

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
