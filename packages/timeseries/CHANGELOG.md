# Changelog

All notable changes to `@ethonline2026/timeseries` are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-11

First release. Verified end to end against a live Tiger Cloud service
(PostgreSQL 18.6, TimescaleDB 2.30.0, pgvector 0.8.6, vectorscale 0.9.0).

### Added

- **Tiger Cloud connection** — `TIMESERIES_DATABASE_URL` (single DSN) with a
  discrete-key fallback, automatic TLS for non-local hosts, and a
  `globalThis`-cached pool sized for the free-tier connection cap. libpq SSL
  parameters are stripped from the DSN and resolved into an explicit policy so
  `pg` cannot override the decision; `sslrootcert` upgrades to real
  verification.
- **Migration via official builders** — `@timescaledb/core` generates the
  hypertable and compression SQL; the migration is idempotent by probing with
  the library's own `inspect()` query before executing DDL, and views use
  `CREATE OR REPLACE` so definition changes always apply.
- **Capability probe** — `pg_available_extensions` / `pg_extension` are
  inspected and recorded in `ts_capabilities`, so features degrade from
  evidence rather than assumption.
- **Metric store** — `pool_metrics_hourly` hypertable with idempotent
  per-`(pool_id, ts)` batch upserts, single- and multi-metric windows,
  parameterized time-bucket analytics built by the core `timeBucket` builder,
  and store-coverage reporting.
- **Forecast ledger** — `ts_forecasts` append-only hypertable storing every
  horizon step with **all nine quantiles**, monotonicity enforced in the
  client and mirrored by a database CHECK constraint, plus
  `ts_forecasts_latest` for cheap current-path reads.
- **Decision ledger** — `ts_decisions` recording the action, size,
  confidence, rationale, model versions and the `cited_forecast_ids` /
  `cited_metric_ids` that make the audit trail verifiable.
- **Performance evaluation** — `v_forecast_calibration` (forecast joined to
  realized actuals, with signed error, absolute error, per-quantile pinball
  loss and q10–q90 coverage), `v_realized_yield` (realized APY per daily
  bucket) and `v_decision_outcomes` (each decision scored against the yield
  that materialized). All figures are computed in SQL — the agent may quote
  them but has no path to inventing them.
- **Temporal vector layer** — `ts_embeddings` with an ANN index (`diskann`
  when vectorscale is available, `hnsw` otherwise, both `vector_cosine_ops`),
  deliberately uncompressed because ANN indexes are not maintained across
  compressed chunks.
- **Deterministic serializer** — renders citation-tagged text from database
  rows only, with fixed numeric precision so output is byte-stable and the
  content hash is a valid idempotency key. Embeddings are never produced from
  model prose.
- **Retrieval** — `VectorRepository.searchTemporal` pushes pool/time/kind
  filters server-side, over-fetches `k × 5` before re-ranking because ANN
  ahead of a selective filter starves results, and returns `sourceIds` on
  every hit for the citation guard.
- **Vertex embeddings** — `VertexEmbeddingService` against
  `text-embedding-005` (768-d) with batched requests, `RETRIEVAL_DOCUMENT` /
  `RETRIEVAL_QUERY` task hints, and a hard assertion on the returned
  dimension so a model swap cannot silently mismatch the `vector(768)` column.
- **Scripts** — `migrate`, `verify:live` (30 assertions against a real
  service, using a disposable per-run pool id) and `backfill:embeddings`
  (idempotent; `--dry-embed` rehearses without Vertex calls).
- **Typed API** — zod-validated wire rows at every boundary, defensive
  coercion helpers instead of casts, and a typed `VectorUnavailableError` for
  the capability-gated path. No `any` in the package.

### Fixed

- Window reads previously validated a partial projection (`ts`, one metric
  column) against the full row schema requiring `protocol`/`network`, so every
  `getMetricWindow` call failed against a real server. Reads now project a
  single metric column aliased to `value` and validate against a schema that
  matches the projection.
- `ts_forecasts_latest` was missing `latency_ms`, which the forecast read path
  selected — the view now carries every column its consumers read.
