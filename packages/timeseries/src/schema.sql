-- TimescaleDB schema for the Agentic EMS time-series store.
-- Applied via `psql -f schema.sql` (or the docker-compose init step).
-- Hypertables: pool_metrics_hourly (auto-partitioned by ts), forecast + backtest tables.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ── Pool metrics (the Category B matrix source) ──────────────────────────────
-- One row per (pool, hour). Fed by the the-graph poller (batch upserts).
CREATE TABLE IF NOT EXISTS pool_metrics_hourly (
  pool_id       TEXT        NOT NULL,
  ts            TIMESTAMPTZ NOT NULL,
  protocol      TEXT        NOT NULL,
  network       TEXT        NOT NULL,
  apy           DOUBLE PRECISION,
  volume_usd    DOUBLE PRECISION,
  tvl_usd       DOUBLE PRECISION,
  utilization   DOUBLE PRECISION,
  vol           DOUBLE PRECISION,
  tx_count      BIGINT,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pool_id, ts)
);
SELECT create_hypertable('pool_metrics_hourly', 'ts', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_pool_metrics_pool_ts
  ON pool_metrics_hourly (pool_id, ts DESC);

-- ── TimesFM-3 forecast persistence (cache + audit) ──────────────────────────
CREATE TABLE IF NOT EXISTS timesfm_forecasts (
  pool_id       TEXT        NOT NULL,
  target        TEXT        NOT NULL,            -- 'apy' | 'volume' | 'tvl' | 'utilization' | ...
  horizon_ts    TIMESTAMPTZ NOT NULL,            -- timestamp the step forecasts
  q10           DOUBLE PRECISION NOT NULL,
  q50           DOUBLE PRECISION NOT NULL,
  q90           DOUBLE PRECISION NOT NULL,
  model_version TEXT        NOT NULL,
  inputs_hash   TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pool_id, target, horizon_ts, model_version)
);
SELECT create_hypertable('timesfm_forecasts', 'horizon_ts', if_not_exists => TRUE);

-- ── Backtest runs (HITL gate evidence) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS backtest_runs (
  id           BIGSERIAL PRIMARY KEY,
  pool_id      TEXT        NOT NULL,
  window_days  INTEGER     NOT NULL,
  strategy     TEXT        NOT NULL,
  hit_rate     DOUBLE PRECISION,
  mape         DOUBLE PRECISION,
  pnl_vs_hodl  DOUBLE PRECISION,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
