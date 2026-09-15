import { TimescaleDB } from '@timescaledb/core';
import type { SqlRunner } from './runner.js';
import {
  EMBEDDING_KINDS,
  PROBED_EXTENSIONS,
  VectorUnavailableError,
  type CapabilityReport,
} from './types.js';

/**
 * Schema migration for the EMS time-series store.
 *
 * Two rules govern this module:
 *
 *  1. **TimescaleDB DDL comes from `@timescaledb/core` builders.** The
 *     library is the single source of truth for hypertable/compression SQL,
 *     so a server upgrade changes behaviour in one place instead of in
 *     hand-copied DDL.
 *  2. **Idempotency comes from probes, not from `IF NOT EXISTS`.** The
 *     builders emit `create_hypertable(...)` without `if_not_exists`, so we
 *     ask the library's own `inspect()` query first and only execute the
 *     creation statements when the table is not yet a hypertable.
 */

/** How far after a decision its outcome is measured. Injected into the view. */
export const DEFAULT_DECISION_HORIZON = '1 day';

export type VectorMode = 'auto' | 'off' | 'require';

export interface MigrateOptions {
  /** Attach compression policies to the time-scanned hypertables (default true). */
  readonly compression?: boolean;
  /** `auto` creates the vector layer when the extension exists. */
  readonly vector?: VectorMode;
  /** Measured outcome window for `v_decision_outcomes`. */
  readonly decisionHorizon?: string;
  /**
   * Attach retention to the high-volume trace tables (default true).
   *
   * Separate from `compression` because the two answer different questions:
   * compression makes old rows cheaper to store, retention decides how long they
   * exist at all.
   */
  readonly retention?: boolean;
  /**
   * Enable tenant row-level security on the `exec_*` tables.
   *
   * Off by default, and deliberately **without `FORCE`**: the table owner still
   * sees every row, so the existing single-role deployment is unaffected and the
   * policies stay inert until a restricted role exists. That is what makes it
   * safe to apply now and useful later, rather than a switch that changes
   * behaviour the moment it is flipped.
   */
  readonly rls?: boolean;
}

export interface MigrationReport {
  readonly capabilities: CapabilityReport;
  readonly created: readonly string[];
  readonly existing: readonly string[];
  readonly skipped: readonly string[];
  readonly statementCount: number;
}

interface HypertableSpec {
  readonly table: string;
  readonly timeColumn: string;
  readonly segmentBy: string;
  readonly orderBy: string;
  readonly compress: boolean;
}

/**
 * Hypertables scanned by time keep compression; `ts_embeddings` deliberately
 * does not, because ANN indexes are not maintained across compressed chunks.
 */
const HYPERTABLES: readonly HypertableSpec[] = [
  {
    table: 'pool_metrics_hourly',
    timeColumn: 'ts',
    segmentBy: 'pool_id',
    orderBy: 'ts DESC',
    compress: true,
  },
  {
    table: 'ts_forecasts',
    timeColumn: 'issued_at',
    segmentBy: 'pool_id',
    orderBy: 'issued_at DESC',
    compress: true,
  },
  {
    table: 'ts_decisions',
    timeColumn: 'decided_at',
    segmentBy: 'pool_id',
    orderBy: 'decided_at DESC',
    compress: true,
  },
  {
    table: 'ts_embeddings',
    timeColumn: 'ts_start',
    segmentBy: 'pool_id',
    orderBy: 'ts_start DESC',
    compress: false,
  },
  {
    // Append-only and read strictly by time, with no ANN index for compression to invalidate.
    // Segmented by `service` because that is the shape of every query the status view makes: one
    // service's window at a time.
    table: 'model_probes',
    timeColumn: 'probed_at',
    segmentBy: 'service',
    orderBy: 'probed_at DESC',
    compress: true,
  },
  // ── Risk-data pipeline history ────────────────────────────────────────────
  // These four carry the temporal risk record: how a chain's decentralisation,
  // a protocol's governance, a market maker's depth, and the security-incident
  // record evolve. They exist because the *current* snapshot (in GCS) answers
  // "what is true now", while a forecast covariate needs "what was true then".
  //
  // All four keep compression: they are append-only analytics series scanned by
  // time, with no ANN index that compression would invalidate.
  {
    table: 'chain_risk_history',
    timeColumn: 'ts',
    segmentBy: 'chain_slug',
    orderBy: 'ts DESC',
    compress: true,
  },
  {
    table: 'protocol_governance_history',
    timeColumn: 'observed_at',
    segmentBy: 'protocol_slug',
    orderBy: 'observed_at DESC',
    compress: true,
  },
  {
    table: 'market_maker_metrics',
    timeColumn: 'ts',
    segmentBy: 'market_maker',
    orderBy: 'ts DESC',
    compress: true,
  },
  {
    table: 'security_incidents',
    timeColumn: 'occurred_at',
    segmentBy: 'subject',
    orderBy: 'occurred_at DESC',
    compress: true,
  },
  // ── Execution service history ─────────────────────────────────────────────
  // Only these two are time-series. The rest of the `exec_*` family is *mutable*
  // current state — a step's status changes in place — and TimescaleDB
  // compression is for append-only data, so those stay plain tables.
  //
  // `segmentby user_id` is what makes this per-user without partitioning per
  // user: one user's rows sit together, so compression works better and a
  // dashboard scan for a single user reads fewer chunks.
  {
    table: 'exec_events',
    timeColumn: 'at',
    segmentBy: 'user_id',
    orderBy: 'at DESC',
    compress: true,
  },
  {
    table: 'exec_position_snapshots',
    timeColumn: 'at',
    segmentBy: 'user_id',
    orderBy: 'at DESC',
    compress: true,
  },
];

const TABLE_DDL: readonly { readonly name: string; readonly sql: string }[] = [
  {
    name: 'pool_metrics_hourly',
    sql: `CREATE TABLE IF NOT EXISTS pool_metrics_hourly (
  pool_id     text        NOT NULL,
  ts          timestamptz NOT NULL,
  protocol    text        NOT NULL,
  network     text        NOT NULL,
  apy         numeric,
  volume_usd  numeric,
  tvl_usd     numeric,
  utilization numeric,
  vol         numeric,
  tx_count    integer,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pool_id, ts)
)`,
  },
  {
    name: 'ts_forecasts',
    sql: `CREATE TABLE IF NOT EXISTS ts_forecasts (
  run_id        uuid        NOT NULL,
  issued_at     timestamptz NOT NULL,
  target_ts     timestamptz NOT NULL,
  pool_id       text        NOT NULL,
  metric        text        NOT NULL,
  horizon_step  integer     NOT NULL,
  point         numeric     NOT NULL,
  q10 numeric NOT NULL, q20 numeric NOT NULL, q30 numeric NOT NULL,
  q40 numeric NOT NULL, q50 numeric NOT NULL, q60 numeric NOT NULL,
  q70 numeric NOT NULL, q80 numeric NOT NULL, q90 numeric NOT NULL,
  model_version text        NOT NULL,
  context_hash  text        NOT NULL,
  latency_ms    numeric,
  PRIMARY KEY (run_id, issued_at, horizon_step),
  CONSTRAINT ts_forecasts_metric_check
    CHECK (metric IN ('apy', 'volume', 'tvl', 'utilization')),
  CONSTRAINT ts_forecasts_quantiles_monotonic CHECK (
    q10 <= q20 AND q20 <= q30 AND q30 <= q40 AND q40 <= q50 AND
    q50 <= q60 AND q60 <= q70 AND q70 <= q80 AND q80 <= q90
  )
)`,
  },
  {
    name: 'ts_decisions',
    sql: `CREATE TABLE IF NOT EXISTS ts_decisions (
  decision_id        uuid        NOT NULL,
  decided_at         timestamptz NOT NULL,
  pool_id            text        NOT NULL,
  action             text        NOT NULL,
  size_usd           numeric     NOT NULL DEFAULT 0,
  confidence         numeric     NOT NULL,
  cited_forecast_ids uuid[]      NOT NULL DEFAULT '{}',
  cited_metric_ids   text[]      NOT NULL DEFAULT '{}',
  rationale          text        NOT NULL,
  state_snapshot     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  model_versions     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (decision_id, decided_at),
  CONSTRAINT ts_decisions_action_check CHECK (
    action IN ('WITHDRAW_LIQUIDITY', 'SUPPLY_CAPITAL', 'DEPOSIT_LSD', 'HOLD')
  ),
  CONSTRAINT ts_decisions_confidence_check CHECK (confidence >= 0 AND confidence <= 1)
)`,
  },
  {
    name: 'backtest_runs',
    sql: `CREATE TABLE IF NOT EXISTS backtest_runs (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pool_id      text        NOT NULL,
  window_days  integer     NOT NULL,
  strategy     text        NOT NULL,
  hit_rate     numeric,
  mape         numeric,
  pnl_vs_hodl  numeric,
  created_at   timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    name: 'ts_capabilities',
    sql: `CREATE TABLE IF NOT EXISTS ts_capabilities (
  captured_at         timestamptz NOT NULL DEFAULT now(),
  postgres_version    text        NOT NULL,
  timescale_version   text,
  installed           jsonb       NOT NULL,
  available           jsonb       NOT NULL,
  vector_enabled      boolean     NOT NULL,
  vectorscale_enabled boolean     NOT NULL
)`,
  },
  // The model-availability record. Until this existed, an uptime view had nothing to read: the
  // health probe answered a request and the answer was discarded, and no table carried a
  // success/failure column, so a failure left no trace anywhere. One row per probe.
  //
  // `source` distinguishes a scheduled probe from one a visitor triggered, because a window that
  // looks dense only when someone was watching is a misleading uptime figure and the reader should
  // be able to tell which they are looking at.
  {
    name: 'model_probes',
    sql: `CREATE TABLE IF NOT EXISTS model_probes (
  probed_at  timestamptz NOT NULL DEFAULT now(),
  service    text        NOT NULL,
  reachable  boolean     NOT NULL,
  latency_ms numeric,
  status     integer,
  detail     text,
  source     text        NOT NULL DEFAULT 'cron'
)`,
  },
  // ── Risk-data pipeline history ──────────────────────────────────────────────
  // These hold the temporal risk record contributed by
  // `@ethonline2026/risk-analysis-data-pipeline`. The current snapshot lives in
  // GCS; these tables hold its history, which is what a forecast covariate needs.
  //
  // Every table keeps a `raw` jsonb column beside the parsed columns, so a parser
  // or classifier change can always be audited against what the upstream
  // actually published at that instant — the same retain-the-source rule the
  // scraper applies to its snapshots.
  {
    name: 'chain_risk_history',
    sql: `CREATE TABLE IF NOT EXISTS chain_risk_history (
  ts                      timestamptz NOT NULL,
  chain_slug              text        NOT NULL,
  stage                   text        NOT NULL,
  state_validation        text        NOT NULL,
  data_availability       text        NOT NULL,
  exit_window             text        NOT NULL,
  sequencer_failure       text        NOT NULL,
  proposer_failure        text        NOT NULL,
  challenge_period_days   numeric,
  exit_window_days        numeric,
  sequencer_delay_hours   numeric,
  value_secured_usd       numeric,
  composite_score         numeric     NOT NULL,
  raw                     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (chain_slug, ts),
  CONSTRAINT chain_risk_history_composite_check
    CHECK (composite_score >= 0 AND composite_score <= 1)
)`,
  },
  {
    name: 'protocol_governance_history',
    sql: `CREATE TABLE IF NOT EXISTS protocol_governance_history (
  observed_at        timestamptz NOT NULL,
  protocol_slug      text        NOT NULL,
  proposal_count     integer     NOT NULL,
  open_count         integer     NOT NULL,
  recent_count       integer     NOT NULL,
  risk_proposal_count integer    NOT NULL,
  activity_score     numeric     NOT NULL,
  participation_score numeric    NOT NULL,
  risk_activity_score numeric    NOT NULL,
  composite_score    numeric     NOT NULL,
  raw                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (protocol_slug, observed_at),
  CONSTRAINT protocol_governance_history_composite_check
    CHECK (composite_score >= 0 AND composite_score <= 1)
)`,
  },
  {
    name: 'market_maker_metrics',
    sql: `CREATE TABLE IF NOT EXISTS market_maker_metrics (
  ts                  timestamptz NOT NULL,
  market_maker        text        NOT NULL,
  grade               text        NOT NULL,
  composite_score     numeric     NOT NULL,
  rank                integer,
  depth_usd           numeric,
  spread_pct          numeric,
  volume_usd          numeric,
  trading_kpis        numeric,
  trust               numeric,
  coverage_capabilities numeric,
  uptime              numeric,
  integration_level   numeric,
  active_engagements  integer,
  fdv_usd             numeric,
  raw                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (market_maker, ts)
)`,
  },
  {
    name: 'security_incidents',
    sql: `CREATE TABLE IF NOT EXISTS security_incidents (
  occurred_at     timestamptz NOT NULL,
  incident_id     text        NOT NULL,
  subject         text        NOT NULL,
  subject_kind    text        NOT NULL,
  incident_kind   text        NOT NULL,
  severity        text        NOT NULL,
  amount_usd      numeric,
  summary         text        NOT NULL,
  source_url      text,
  raw             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (subject, occurred_at),
  CONSTRAINT security_incidents_subject_kind_check
    CHECK (subject_kind IN ('chain', 'protocol', 'market_maker')),
  CONSTRAINT security_incidents_severity_check
    CHECK (severity IN ('low', 'medium', 'high', 'critical'))
)`,
  },

  // ── Execution service: the session → strategy → run → intent → step chain ──
  //
  // One schema for every user. What makes this per-user is the `user_id` column
  // repeated on every table plus `segmentby user_id` on the two hypertables —
  // not a table or database per user, which would be hundreds of databases to
  // migrate, back up and pay for.
  //
  // Note that `status` columns are deliberately NOT constrained by CHECK: the
  // lifecycle has fourteen states and is enforced by the state machine in
  // `@ethonline2026/execution-domain` (every write goes through
  // `assertTransition`). A CHECK here would mean two sources of truth for the
  // same vocabulary, drifting on the next state added.
  {
    name: 'exec_users',
    sql: `CREATE TABLE IF NOT EXISTS exec_users (
  user_id    text        PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    // A short-lived interaction context, not a container. Nothing depends on it
    // staying open — which is what lets a risk-triggered rebalance run with
    // nobody logged in.
    name: 'exec_sessions',
    sql: `CREATE TABLE IF NOT EXISTS exec_sessions (
  session_id       uuid        PRIMARY KEY,
  user_id          text        NOT NULL REFERENCES exec_users(user_id) ON DELETE CASCADE,
  agent            text        NOT NULL,
  status           text        NOT NULL DEFAULT 'open',
  thread_id        text,
  mandate_snapshot jsonb       NOT NULL DEFAULT '{}'::jsonb,
  started_at       timestamptz NOT NULL DEFAULT now(),
  last_active_at   timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz,
  CONSTRAINT exec_session_agent_check  CHECK (agent  IN ('v01', 'deep', 'desk')),
  CONSTRAINT exec_session_status_check CHECK (status IN ('open', 'paused', 'closed'))
)`,
  },
  {
    // `provisioning` is explicit because a Privy server signer must be
    // provisioned per user (authorization key + policy), and its failure mode is
    // silent: a missing policy means the signer simply cannot act.
    name: 'exec_accounts',
    sql: `CREATE TABLE IF NOT EXISTS exec_accounts (
  account_id      uuid        PRIMARY KEY,
  user_id         text        NOT NULL REFERENCES exec_users(user_id) ON DELETE CASCADE,
  kind            text        NOT NULL,
  chain_id        integer     NOT NULL,
  address         text        NOT NULL,
  privy_wallet_id text        NOT NULL,
  provisioning    text        NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exec_account_kind_check         CHECK (kind IN ('eoa', 'smart')),
  CONSTRAINT exec_account_provisioning_check CHECK (provisioning IN ('pending', 'ready', 'failed')),
  CONSTRAINT exec_account_address_check      CHECK (address ~ '^0x[0-9a-fA-F]{40}$'),
  UNIQUE (user_id, chain_id, kind, address)
)`,
  },
  {
    // Durable and user-owned — the parent of runs, not a session.
    // `risk_thresholds` is what the risk engine watches; a breach starts a run.
    name: 'exec_strategies',
    sql: `CREATE TABLE IF NOT EXISTS exec_strategies (
  strategy_id     uuid        PRIMARY KEY,
  user_id         text        NOT NULL REFERENCES exec_users(user_id) ON DELETE CASCADE,
  name            text        NOT NULL,
  mandate         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  risk_thresholds jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status          text        NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exec_strategy_status_check CHECK (status IN ('active', 'paused', 'retired'))
)`,
  },
  {
    // `session_id` is nullable audit metadata; `trigger_detail` is the audit
    // answer to "why did this run happen?".
    name: 'exec_runs',
    sql: `CREATE TABLE IF NOT EXISTS exec_runs (
  run_id         uuid        PRIMARY KEY,
  strategy_id    uuid        NOT NULL REFERENCES exec_strategies(strategy_id) ON DELETE CASCADE,
  user_id        text        NOT NULL,
  session_id     uuid        REFERENCES exec_sessions(session_id) ON DELETE SET NULL,
  parent_run_id  uuid        REFERENCES exec_runs(run_id) ON DELETE SET NULL,
  trigger        text        NOT NULL,
  trigger_detail jsonb,
  mode           text        NOT NULL DEFAULT 'dry',
  status         text        NOT NULL DEFAULT 'draft',
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  CONSTRAINT exec_run_trigger_check CHECK (trigger IN ('user', 'agent', 'risk_breach', 'schedule')),
  CONSTRAINT exec_run_mode_check    CHECK (mode IN ('dry', 'live'))
)`,
  },
  {
    // One simulation pass, pinned to a block so every quote describes the same
    // state. Large traces go to object storage; only the key lives here.
    name: 'exec_simulations',
    sql: `CREATE TABLE IF NOT EXISTS exec_simulations (
  simulation_id uuid        PRIMARY KEY,
  run_id        uuid        NOT NULL REFERENCES exec_runs(run_id) ON DELETE CASCADE,
  user_id       text        NOT NULL,
  attempt       integer     NOT NULL DEFAULT 1,
  state_block   bigint,
  gas_price_wei numeric,
  status        text        NOT NULL DEFAULT 'running',
  trace_key     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, attempt)
)`,
  },
  {
    // Every attempted path is recorded, including the rejects and why — a user
    // must be able to ask "why not the third one?".
    name: 'exec_paths',
    sql: `CREATE TABLE IF NOT EXISTS exec_paths (
  path_id       uuid        PRIMARY KEY,
  simulation_id uuid        NOT NULL REFERENCES exec_simulations(simulation_id) ON DELETE CASCADE,
  run_id        uuid        NOT NULL REFERENCES exec_runs(run_id) ON DELETE CASCADE,
  user_id       text        NOT NULL,
  rank          integer     NOT NULL,
  label         text        NOT NULL DEFAULT '',
  net_value_usd numeric     NOT NULL,
  fee_total_usd numeric     NOT NULL,
  fee_breakdown jsonb       NOT NULL DEFAULT '[]'::jsonb,
  steps         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  viable        boolean     NOT NULL DEFAULT true,
  reject_reason text,
  selected_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (simulation_id, rank)
)`,
  },
  {
    // The signed intent. `typed_data_hash` binds the signature to the exact
    // payload the user reviewed, so a mismatch is detectable afterwards.
    name: 'exec_intents',
    sql: `CREATE TABLE IF NOT EXISTS exec_intents (
  intent_id         uuid        PRIMARY KEY,
  run_id            uuid        NOT NULL REFERENCES exec_runs(run_id) ON DELETE CASCADE,
  path_id           uuid        REFERENCES exec_paths(path_id) ON DELETE SET NULL,
  user_id           text        NOT NULL,
  signer_account_id uuid        REFERENCES exec_accounts(account_id) ON DELETE SET NULL,
  status            text        NOT NULL DEFAULT 'proposed',
  typed_data_hash   text,
  signature         text,
  signed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    // Mutable current state for one leg. The append-only history is
    // `exec_events`; this is the row the dashboard reads for "where is it now".
    name: 'exec_steps',
    sql: `CREATE TABLE IF NOT EXISTS exec_steps (
  step_id     uuid        PRIMARY KEY,
  intent_id   uuid        NOT NULL REFERENCES exec_intents(intent_id) ON DELETE CASCADE,
  user_id     text        NOT NULL,
  seq         integer     NOT NULL,
  kind        text        NOT NULL,
  label       text        NOT NULL DEFAULT '',
  status      text        NOT NULL DEFAULT 'queued',
  chain_id    integer     NOT NULL,
  tx_hash     text,
  nonce       bigint,
  gas_used    numeric,
  src_tx_hash text,
  dst_tx_hash text,
  guid        text,
  error       text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intent_id, seq),
  CONSTRAINT exec_step_kind_check CHECK (kind IN (
    'approve', 'wrap', 'bridge', 'lzSend', 'lzCompose',
    'supply', 'swap', 'order', 'transfer'
  ))
)`,
  },
  {
    // One row per step per token. `estimated` distinguishes the pre-trade quote
    // from the amount actually paid, which is what the receipt's actual-vs-quoted
    // trust signal is built on.
    name: 'exec_fee_actuals',
    sql: `CREATE TABLE IF NOT EXISTS exec_fee_actuals (
  fee_id    uuid        PRIMARY KEY,
  step_id   uuid        REFERENCES exec_steps(step_id) ON DELETE CASCADE,
  user_id   text        NOT NULL,
  chain_id  integer     NOT NULL,
  token     text        NOT NULL,
  amount    numeric     NOT NULL,
  usd       numeric,
  kind      text        NOT NULL,
  estimated boolean     NOT NULL DEFAULT false,
  at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exec_fee_kind_check CHECK (kind IN (
    'gas', 'bridge', 'lp', 'protocol', 'aggregator', 'other'
  ))
)`,
  },
  {
    // The append-only trace. Primary key includes the time column, which a
    // hypertable requires. Deliberately NO foreign keys: this is the highest
    // write volume table in the schema, and FK checks on every event would cost
    // more than the referential guarantee is worth here — the ids are written by
    // the same transaction that writes the parent rows.
    name: 'exec_events',
    sql: `CREATE TABLE IF NOT EXISTS exec_events (
  event_id  uuid        NOT NULL,
  at        timestamptz NOT NULL DEFAULT now(),
  user_id   text        NOT NULL,
  run_id    uuid,
  intent_id uuid,
  step_id   uuid,
  type      text        NOT NULL,
  payload   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (event_id, at)
)`,
  },
  {
    // Downsampled at write time — one row per position per horizon, never per
    // block. `account_id` is NOT NULL because it is part of the primary key and
    // Postgres forbids a nullable primary-key column.
    name: 'exec_position_snapshots',
    sql: `CREATE TABLE IF NOT EXISTS exec_position_snapshots (
  at         timestamptz NOT NULL,
  user_id    text        NOT NULL,
  account_id uuid        NOT NULL,
  chain_id   integer     NOT NULL,
  protocol   text        NOT NULL,
  pool_id    text        NOT NULL,
  value_usd  numeric     NOT NULL,
  units      numeric,
  apy        numeric,
  PRIMARY KEY (at, user_id, account_id, chain_id, pool_id)
)`,
  },
  {
    // One row per principal *per agent*, not per principal: the same operator running a conservative
    // agent and an opportunistic one needs two limits, and keying on the user alone would silently
    // give both whichever number was written last.
    //
    // This is the durable home for a mandate. `APPROVAL_MAX_SPEND_USD` remains the *default* for
    // agents with no row, so a deployment with an empty table behaves exactly as it did before.
    name: 'exec_agent_mandates',
    sql: `CREATE TABLE IF NOT EXISTS exec_agent_mandates (
  user_id           text        NOT NULL,
  agent             text        NOT NULL,
  max_spend_usd     numeric     NOT NULL,
  approval_required boolean     NOT NULL DEFAULT true,
  updated_by        text        NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, agent),
  CONSTRAINT exec_agent_mandates_max_spend_check CHECK (max_spend_usd > 0)
)`,
  },
];

/**
 * Indexes built for the dashboard's actual questions, not for hypothetical ones.
 *
 * Every one is led by the column the read filters on first — `user_id` for the
 * tenant-scoped panels, `strategy_id`/`session_id` for the lineage walks.
 */
const INDEX_DDL: readonly { readonly name: string; readonly sql: string }[] = [
  {
    name: 'model_probes_service_probed_idx',
    sql: `CREATE INDEX IF NOT EXISTS model_probes_service_probed_idx
       ON model_probes (service, probed_at DESC)`,
  },
  {
    name: 'exec_sessions_user_activity_idx',
    sql: `CREATE INDEX IF NOT EXISTS exec_sessions_user_activity_idx
       ON exec_sessions (user_id, last_active_at DESC)`,
  },
  {
    name: 'exec_strategies_user_status_idx',
    sql: `CREATE INDEX IF NOT EXISTS exec_strategies_user_status_idx
       ON exec_strategies (user_id, status)`,
  },
  {
    name: 'exec_runs_strategy_started_idx',
    sql: `CREATE INDEX IF NOT EXISTS exec_runs_strategy_started_idx
       ON exec_runs (strategy_id, started_at DESC)`,
  },
  {
    name: 'exec_runs_session_started_idx',
    sql: `CREATE INDEX IF NOT EXISTS exec_runs_session_started_idx
       ON exec_runs (session_id, started_at DESC)`,
  },
  {
    name: 'exec_runs_user_status_idx',
    sql: `CREATE INDEX IF NOT EXISTS exec_runs_user_status_idx
       ON exec_runs (user_id, status)`,
  },
  {
    name: 'exec_paths_run_rank_idx',
    sql: `CREATE INDEX IF NOT EXISTS exec_paths_run_rank_idx
       ON exec_paths (run_id, rank)`,
  },
  {
    name: 'exec_intents_user_status_idx',
    sql: `CREATE INDEX IF NOT EXISTS exec_intents_user_status_idx
       ON exec_intents (user_id, status)`,
  },
  {
    // Partial, deliberately. `status` changes on every transition, and indexing
    // a frequently-updated column defeats HOT updates. The only question ever
    // asked of this table is "what is still moving?", so the index holds just
    // those rows — small to maintain, and a step leaves it on completion rather
    // than updating a large index in place.
    name: 'exec_steps_in_flight_idx',
    sql: `CREATE INDEX IF NOT EXISTS exec_steps_in_flight_idx
       ON exec_steps (user_id, updated_at DESC)
       WHERE status NOT IN ('confirmed', 'failed', 'skipped')`,
  },
  {
    name: 'exec_fee_actuals_user_at_idx',
    sql: `CREATE INDEX IF NOT EXISTS exec_fee_actuals_user_at_idx
       ON exec_fee_actuals (user_id, at DESC)`,
  },
  {
    name: 'exec_events_user_at_idx',
    sql: `CREATE INDEX IF NOT EXISTS exec_events_user_at_idx
       ON exec_events (user_id, at DESC)`,
  },
  {
    name: 'exec_position_snapshots_user_at_idx',
    sql: `CREATE INDEX IF NOT EXISTS exec_position_snapshots_user_at_idx
       ON exec_position_snapshots (user_id, at DESC)`,
  },
];

/**
 * Retention for the highest-volume table only.
 *
 * `exec_events` is a trace, not a system of record: the current state lives in
 * the mutable `exec_steps`/`exec_intents` rows, and the position history lives in
 * `exec_position_snapshots`. Dropping raw events after 180 days bounds storage
 * without losing anything the dashboard reads.
 *
 * Wrapped in a `DO` block because `add_retention_policy` errors when a policy
 * already exists, and this migration is expected to be safe to re-run.
 */
const RETENTION_STATEMENTS: readonly { readonly name: string; readonly sql: string }[] = [
  {
    name: 'exec_events_retention',
    sql: `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.jobs
    WHERE proc_name = 'policy_retention' AND hypertable_name = 'exec_events'
  ) THEN
    PERFORM add_retention_policy('exec_events', INTERVAL '180 days');
  END IF;
END $$`,
  },
];

/**
 * Build the `kind IN (...)` list for the embeddings CHECK constraint.
 *
 * Derived from {@link EMBEDDING_KINDS} rather than hand-written, so widening the
 * enum cannot leave the constraint rejecting a kind the application considers
 * valid. That mismatch is exactly the bug this avoids: the enum lives in
 * `types.ts` and the constraint in SQL, and without a single source they drift.
 *
 * @returns The quoted, comma-separated kind list.
 */
function embeddingKindSqlList(): string {
  return EMBEDDING_KINDS.map((kind) => `'${kind}'`).join(', ');
}

/**
 * `ts_embeddings` is created only when pgvector is present, so its DDL lives
 * apart from TABLE_DDL. Uncompressed by design; see HYPERTABLES.
 */
const EMBEDDINGS_DDL = `CREATE TABLE IF NOT EXISTS ts_embeddings (
  id           uuid        NOT NULL,
  ts_start     timestamptz NOT NULL,
  ts_end       timestamptz NOT NULL,
  pool_id      text        NOT NULL,
  kind         text        NOT NULL,
  source_ids   text[]      NOT NULL,
  content      text        NOT NULL,
  embedding    vector(768) NOT NULL,
  model        text        NOT NULL,
  content_hash text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, ts_start),
  CONSTRAINT ts_embeddings_kind_check CHECK (
    kind IN (${embeddingKindSqlList()})
  )
)`;

/** The constraint name the kind CHECK is created under. */
export const EMBEDDING_KIND_CONSTRAINT = 'ts_embeddings_kind_check';

/**
 * Statements that widen the embeddings kind constraint on an existing table.
 *
 * `CREATE TABLE IF NOT EXISTS` does not alter an existing table, so a database
 * migrated before a new kind was added keeps the *old* constraint and rejects the
 * new kind at insert time. Postgres has no `ALTER ... ADD OR REPLACE CHECK`, so
 * the constraint is dropped and re-added — the one non-idempotent-looking step in
 * an otherwise idempotent migration, and the reason it is isolated here with a
 * test pinning the generated SQL.
 *
 * Dropping and re-adding in one transaction means a concurrent insert either sees
 * the old constraint entirely or the new one, never a table with no constraint.
 *
 * @returns The two statements, in order.
 */
export function embeddingKindCheckStatements(): readonly string[] {
  return [
    `ALTER TABLE ts_embeddings DROP CONSTRAINT IF EXISTS ${EMBEDDING_KIND_CONSTRAINT}`,
    `ALTER TABLE ts_embeddings ADD CONSTRAINT ${EMBEDDING_KIND_CONSTRAINT} ` +
      `CHECK (kind IN (${embeddingKindSqlList()}))`,
  ];
}

/**
 * Indexes on the embeddings hypertable; ANN flavour depends on capabilities.
 *
 * Both flavours index the full-precision `vector(768)` column rather than
 * `halfvec(768)`. That is a deliberate trade against index size: the vector
 * operator classes are not interchangeable, and pgvectorscale's StreamingDiskANN
 * — which supports label-based filtered search, the access pattern every query
 * here uses — exposes only `vector_*_ops`. `halfvec_cosine_ops` exists for hnsw
 * alone, so choosing it would forfeit diskann entirely. The discriminator is a
 * live capability probe, not a version guess.
 */
export function embeddingIndexStatements(hasVectorscale: boolean): readonly string[] {
  const ann = hasVectorscale
    ? `CREATE INDEX IF NOT EXISTS ts_embeddings_diskann_idx
         ON ts_embeddings USING diskann (embedding vector_cosine_ops)`
    : `CREATE INDEX IF NOT EXISTS ts_embeddings_hnsw_idx
         ON ts_embeddings USING hnsw (embedding vector_cosine_ops)
         WITH (m = 16, ef_construction = 64)`;
  return [
    ann,
    `CREATE INDEX IF NOT EXISTS ts_embeddings_pool_ts_idx
       ON ts_embeddings (pool_id, ts_start DESC)`,
    // Hypertable unique indexes must include the time column. `ts_start` is
    // derived deterministically from the serialized content, so the pair is
    // still unique per logical chunk — re-running backfill cannot duplicate.
    `CREATE UNIQUE INDEX IF NOT EXISTS ts_embeddings_hash_key
       ON ts_embeddings (content_hash, ts_start)`,
  ];
}

const VIEW_STATEMENTS = (decisionHorizon: string): readonly { readonly name: string; readonly sql: string }[] => [
  {
    name: 'ts_forecasts_latest',
    sql: `CREATE OR REPLACE VIEW ts_forecasts_latest AS
SELECT DISTINCT ON (pool_id, metric, target_ts)
  run_id, issued_at, target_ts, pool_id, metric, horizon_step, point,
  q10, q20, q30, q40, q50, q60, q70, q80, q90,
  model_version, context_hash, latency_ms
FROM ts_forecasts
ORDER BY pool_id, metric, target_ts, issued_at DESC, horizon_step DESC`,
  },
  {
    name: 'v_forecast_calibration',
    sql: `CREATE OR REPLACE VIEW v_forecast_calibration AS
WITH actuals AS (
  SELECT pool_id, ts, 'apy'::text AS metric, apy AS value FROM pool_metrics_hourly
  UNION ALL
  SELECT pool_id, ts, 'volume'::text, volume_usd FROM pool_metrics_hourly
  UNION ALL
  SELECT pool_id, ts, 'tvl'::text, tvl_usd FROM pool_metrics_hourly
  UNION ALL
  SELECT pool_id, ts, 'utilization'::text, utilization FROM pool_metrics_hourly
)
SELECT
  f.run_id,
  f.pool_id,
  f.metric,
  f.target_ts,
  f.horizon_step,
  f.q10 AS forecast_q10,
  f.q50 AS forecast_q50,
  f.q90 AS forecast_q90,
  a.value AS actual,
  (a.value - f.q50) AS signed_error,
  abs(a.value - f.q50) AS absolute_error,
  -- Pinball loss ρ_τ(y, q) at the median level (τ = 0.5).
  (0.5 * abs(a.value - f.q50)) AS pinball_q50,
  CASE WHEN a.value >= f.q10 THEN 0.1 * (a.value - f.q10)
       ELSE 0.9 * (f.q10 - a.value) END AS pinball_q10,
  CASE WHEN a.value >= f.q90 THEN 0.9 * (a.value - f.q90)
       ELSE 0.1 * (f.q90 - a.value) END AS pinball_q90,
  (0.5 * abs(a.value - f.q50)) AS pinball_loss,
  (a.value >= f.q10 AND a.value <= f.q90) AS covered,
  f.model_version
FROM ts_forecasts f
JOIN actuals a
  ON a.pool_id = f.pool_id AND a.metric = f.metric AND a.ts = f.target_ts
WHERE a.value IS NOT NULL`,
  },
  {
    name: 'v_realized_yield',
    sql: `CREATE OR REPLACE VIEW v_realized_yield AS
SELECT
  pool_id,
  time_bucket(INTERVAL '1 day', ts) AS bucket_start,
  avg(apy)  AS avg_apy,
  min(apy)  AS min_apy,
  max(apy)  AS max_apy,
  avg(tvl_usd) AS avg_tvl,
  count(*)::int AS samples
FROM pool_metrics_hourly
WHERE apy IS NOT NULL
GROUP BY pool_id, time_bucket(INTERVAL '1 day', ts)`,
  },
  {
    name: 'v_decision_outcomes',
    sql: `CREATE OR REPLACE VIEW v_decision_outcomes AS
SELECT
  d.decision_id,
  d.pool_id,
  d.action,
  d.size_usd,
  d.decided_at,
  (d.decided_at + INTERVAL '${decisionHorizon}') AS horizon_end,
  realized.avg_apy AS realized_apy,
  baseline.avg_apy AS baseline_apy,
  (realized.avg_apy - baseline.avg_apy) AS outcome_score
FROM ts_decisions d
LEFT JOIN v_realized_yield baseline
  ON baseline.pool_id = d.pool_id
 AND baseline.bucket_start = time_bucket(INTERVAL '1 day', d.decided_at)
LEFT JOIN v_realized_yield realized
  ON realized.pool_id = d.pool_id
 AND realized.bucket_start = time_bucket(
       INTERVAL '1 day', d.decided_at + INTERVAL '${decisionHorizon}'
     )`,
  },
];

/**
 * The builders emit statements terminated by `;`. None of the generated
 * statements contains a semicolon inside a string literal (identifiers use
 * double quotes, values use single-quoted literals without `;`), so a plain
 * split is safe — pinned by the migration tests.
 */
export function splitStatements(sql: string): readonly string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Read what the server supports before deciding what to build. */
export async function probeCapabilities(runner: SqlRunner): Promise<CapabilityReport> {
  const versionRes = await runner.query(
    'SELECT version() AS v, current_setting(\'server_version\') AS sv',
  );
  const installedRes = await runner.query(
    'SELECT extname, extversion FROM pg_extension WHERE extname = ANY($1::text[]) ORDER BY extname',
    [[...PROBED_EXTENSIONS]],
  );
  const availableRes = await runner.query(
    'SELECT name, default_version FROM pg_available_extensions WHERE name = ANY($1::text[]) ORDER BY name',
    [[...PROBED_EXTENSIONS]],
  );

  const installed: Record<string, string> = {};
  for (const row of installedRes.rows) {
    const name = row.extname;
    const version = row.extversion;
    if (typeof name === 'string' && typeof version === 'string') installed[name] = version;
  }
  const available: Record<string, string> = {};
  for (const row of availableRes.rows) {
    const name = row.name;
    const version = row.default_version;
    if (typeof name === 'string' && typeof version === 'string') available[name] = version;
  }

  return {
    installed,
    available,
    postgresVersion: String(versionRes.rows[0]?.sv ?? versionRes.rows[0]?.v ?? 'unknown'),
    timescaleVersion: installed['timescaledb'] ?? null,
    vectorEnabled: installed['vector'] !== undefined,
    vectorscaleEnabled: installed['vectorscale'] !== undefined,
  };
}

/**
 * Probe-then-create using the library's own `inspect()` query: the builder
 * supplies the DDL, this function decides whether it should run.
 */
async function ensureHypertable(
  runner: SqlRunner,
  spec: HypertableSpec,
  options: { readonly compression: boolean },
  report: { created: string[]; existing: string[] },
): Promise<void> {
  const hypertable = TimescaleDB.createHypertable(spec.table, {
    by_range: { column_name: spec.timeColumn },
    ...(spec.compress && options.compression
      ? {
          compression: {
            compress: true,
            compress_orderby: spec.orderBy,
            compress_segmentby: spec.segmentBy,
            policy: { schedule_interval: '7 days' },
          },
        }
      : {}),
  });

  const probe = await runner.query(hypertable.inspect().build());
  const alreadyHypertable = probe.rows[0]?.is_hypertable === true;

  if (!alreadyHypertable) {
    for (const statement of splitStatements(hypertable.up().build())) {
      await runner.query(statement);
    }
    report.created.push(spec.table);
    return;
  }

  report.existing.push(spec.table);

  // Already a hypertable: repair a missing compression policy. TimescaleDB
  // errors on a duplicate policy, so gate on the settings catalog.
  if (spec.compress && options.compression) {
    const compression = await runner.query(
      `SELECT count(*)::int AS n FROM timescaledb_information.compression_settings
       WHERE hypertable_name = $1`,
      [spec.table],
    );
    if (Number(compression.rows[0]?.n ?? 0) === 0) {
      const statements = splitStatements(hypertable.up().build());
      for (const statement of statements.slice(1)) {
        await runner.query(statement);
      }
      report.created.push(`${spec.table}.compression`);
    }
  }
}

/**
 * Idempotent migration. Safe to run on every deploy: tables use
 * `IF NOT EXISTS`, hypertables are probe-gated, views are replaced, and the
 * capability probe records what the server actually offered.
 */
export async function migrate(
  runner: SqlRunner,
  options: MigrateOptions = {},
): Promise<MigrationReport> {
  const created: string[] = [];
  const existing: string[] = [];
  const skipped: string[] = [];
  let statementCount = 0;

  const run = async (sql: string, values?: readonly unknown[]): Promise<void> => {
    await runner.query(sql, values);
    statementCount += 1;
  };

  // 1. TimescaleDB itself.
  for (const statement of splitStatements(TimescaleDB.createExtension().up().build())) {
    await run(statement);
  }

  // 2. Probe before building — evidence, not assumption.
  const preliminary = await probeCapabilities(runner);

  // 3. Base tables.
  for (const table of TABLE_DDL) {
    await run(table.sql);
  }

  // 4. Vector layer (optional, capability-gated).
  const vectorMode = options.vector ?? 'auto';
  const canVector = preliminary.vectorEnabled || preliminary.available['vector'] !== undefined;
  const wantVector = vectorMode !== 'off';

  if (wantVector && !canVector) {
    if (vectorMode === 'require') {
      throw new VectorUnavailableError('the server offers no installable `vector` extension');
    }
    skipped.push('ts_embeddings (pgvector unavailable)');
  } else if (wantVector) {
    // The builder's `Extension` hardcodes `CREATE EXTENSION ... timescaledb`
    // (its option schema accepts only `should_cascade`/`version`), so the
    // pgvector family is installed with explicit DDL.
    await run('CREATE EXTENSION IF NOT EXISTS vector');
    const canVectorscale = preliminary.vectorscaleEnabled || preliminary.available['vectorscale'] !== undefined;
    if (canVectorscale) {
      await run('CREATE EXTENSION IF NOT EXISTS vectorscale');
    }
    await run(EMBEDDINGS_DDL);
    // `CREATE TABLE IF NOT EXISTS` does not touch an existing table, so a store
    // migrated before a new embedding kind existed still carries the old CHECK
    // and would reject the new kind. Rewrite the constraint so the enum in
    // `types.ts` and the database agree.
    for (const statement of embeddingKindCheckStatements()) {
      await run(statement);
    }
    for (const statement of embeddingIndexStatements(canVectorscale)) {
      await run(statement);
    }
    created.push('ts_embeddings');
  } else {
    skipped.push('ts_embeddings (vector layer disabled)');
  }

  // 5. Hypertables (builders + inspect probe).
  for (const spec of HYPERTABLES) {
    if (spec.table === 'ts_embeddings' && skipped.some((s) => s.startsWith('ts_embeddings'))) {
      continue;
    }
    await ensureHypertable(runner, spec, { compression: options.compression ?? true }, { created, existing });
  }

  // 6. Lineage indexes for the execution tables — built for the dashboard's
  // reads, each led by the column the query filters on first.
  for (const index of INDEX_DDL) {
    await run(index.sql);
  }

  // 7. Retention for the execution trace. Bounds storage on the one table whose
  // purpose is many small appends; the mutable state it describes is unaffected.
  if (options.retention ?? true) {
    for (const policy of RETENTION_STATEMENTS) {
      await run(policy.sql);
    }
  }

  // 7b. Tenant row-level security (optional, opt-in).
  //
  // Applied **without `FORCE`**, so the table owner keeps full access and this
  // changes nothing for the current single-role deployment. The policies become
  // real the moment a restricted role connects — which is the point: the control
  // is in place before it is needed, and flipping it on cannot lock anyone out.
  //
  // Fail-closed by construction. `current_setting('app.user_id', true)` returns
  // NULL when unset, and `user_id = NULL` evaluates to NULL rather than true, so
  // a connection that forgets to declare its tenant sees nothing. The failure
  // mode of a missing setting is an empty result, never a full one.
  //
  // ## Why compressed hypertables are skipped
  //
  // TimescaleDB refuses the DDL outright on a hypertable with compression
  // enabled — verified against the live database, which returns
  // `0A000: operation not supported on hypertables that have columnstore enabled`
  // naming the offending statement. So `exec_events` and
  // `exec_position_snapshots` cannot carry a policy while compression is on, and
  // they are excluded rather than silently retried.
  //
  // That leaves those two tables relying on the repository's `user_id` scoping
  // alone. Worth knowing: this is the *absence* of a second layer on the two
  // highest-volume tables, not a second layer that happens to be idle.
  if (options.rls ?? false) {
    await run(`
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname LIKE 'exec\\_%'
      AND NOT EXISTS (
        SELECT 1 FROM timescaledb_information.compression_settings s
        WHERE s.hypertable_name = c.relname
      )
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (user_id = current_setting(''app.user_id'', true))', t
    );
  END LOOP;
END $$`);
  }

  // 8. Views (replaced wholesale so a definition change always applies).
  for (const view of VIEW_STATEMENTS(options.decisionHorizon ?? DEFAULT_DECISION_HORIZON)) {
    await run(view.sql);
    created.push(view.name);
  }

  // 9. Record capabilities after extensions were installed.
  const capabilities = await probeCapabilities(runner);
  await run(
    `INSERT INTO ts_capabilities
       (postgres_version, timescale_version, installed, available, vector_enabled, vectorscale_enabled)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
    [
      capabilities.postgresVersion,
      capabilities.timescaleVersion,
      JSON.stringify(capabilities.installed),
      JSON.stringify(capabilities.available),
      capabilities.vectorEnabled,
      capabilities.vectorscaleEnabled,
    ],
  );

  return {
    capabilities,
    created,
    existing,
    skipped,
    statementCount,
  };
}

/** True when the vector layer exists and can be queried. */
export async function assertVectorLayer(runner: SqlRunner): Promise<CapabilityReport> {
  const capabilities = await probeCapabilities(runner);
  if (!capabilities.vectorEnabled) {
    throw new VectorUnavailableError('the `vector` extension is not installed');
  }
  const table = await runner.query("SELECT to_regclass('public.ts_embeddings') AS reg");
  if (table.rows[0]?.reg === null || table.rows[0]?.reg === undefined) {
    throw new VectorUnavailableError('table `ts_embeddings` does not exist — run migrate()');
  }
  return capabilities;
}
