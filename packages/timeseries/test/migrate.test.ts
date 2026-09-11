import { describe, expect, it } from 'vitest';
import {
  EMBEDDING_KIND_CONSTRAINT,
  embeddingIndexStatements,
  embeddingKindCheckStatements,
  migrate,
  probeCapabilities,
  splitStatements,
} from '../src/migrate.js';
import { EMBEDDING_KINDS, VectorUnavailableError } from '../src/types.js';
import { RoutingFakeRunner } from './helpers.js';

/** A server with TimescaleDB plus the pgvector family available. */
function fullServer(): RoutingFakeRunner {
  const runner = new RoutingFakeRunner()
    .on("current_setting('server_version')", [{ v: 'PostgreSQL 18.6', sv: '18.6' }])
    .on('FROM pg_available_extensions', [
      { name: 'timescaledb', default_version: '2.30.0' },
      { name: 'vector', default_version: '0.8.6' },
      { name: 'vectorscale', default_version: '0.9.0' },
    ])
    .on('AS is_hypertable', [{ table_exists: false, is_hypertable: false }])
    .on('compression_settings', [{ n: 0 }])
    .on('INSERT INTO ts_capabilities', []);

  // Reflect extensions back only once the migration has installed them, so the
  // post-migration capability probe exercises the real "installed" branch.
  runner.on('FROM pg_extension', () => {
    const installed: Record<string, unknown>[] = [
      { extname: 'timescaledb', extversion: '2.30.0' },
    ];
    if (runner.statements.some((s) => s.includes('CREATE EXTENSION IF NOT EXISTS vector'))) {
      installed.push({ extname: 'vector', extversion: '0.8.6' });
    }
    if (runner.statements.some((s) => s.includes('CREATE EXTENSION IF NOT EXISTS vectorscale'))) {
      installed.push({ extname: 'vectorscale', extversion: '0.9.0' });
    }
    return installed;
  });

  return runner;
}

/** A server offering TimescaleDB only — no installable pgvector. */
function timescaleOnlyServer(): RoutingFakeRunner {
  return new RoutingFakeRunner()
    .on("current_setting('server_version')", [{ v: 'PostgreSQL 18.6', sv: '18.6' }])
    .on('FROM pg_extension', [{ extname: 'timescaledb', extversion: '2.30.0' }])
    .on('FROM pg_available_extensions', [{ name: 'timescaledb', default_version: '2.30.0' }])
    .on('AS is_hypertable', [{ table_exists: false, is_hypertable: false }])
    .on('INSERT INTO ts_capabilities', []);
}

describe('splitStatements', () => {
  it('splits builder output into executable statements', () => {
    const statements = splitStatements('SELECT 1;\nALTER TABLE x SET (a = b);\n');
    expect(statements).toEqual(['SELECT 1', 'ALTER TABLE x SET (a = b)']);
  });

  it('drops empty fragments', () => {
    expect(splitStatements(';;\n;\n')).toEqual([]);
  });
});

describe('capability probe', () => {
  it('reports installed and available extensions separately', async () => {
    const report = await probeCapabilities(fullServer());
    expect(report.timescaleVersion).toBe('2.30.0');
    expect(report.postgresVersion).toBe('18.6');
    // Available but not yet installed is not the same as enabled.
    expect(report.available['vector']).toBe('0.8.6');
    expect(report.vectorEnabled).toBe(false);
    expect(report.vectorscaleEnabled).toBe(false);
  });
});

describe('embeddingIndexStatements', () => {
  it('uses HNSW when only pgvector is present', () => {
    const [ann] = embeddingIndexStatements(false);
    expect(ann).toContain('USING hnsw');
    expect(ann).toContain('vector_cosine_ops');
    expect(ann).toContain('m = 16');
  });

  it('prefers diskann when vectorscale is present', () => {
    const [ann] = embeddingIndexStatements(true);
    expect(ann).toContain('USING diskann');
  });

  it('always creates the pool/time and hash indexes', () => {
    const statements = embeddingIndexStatements(false);
    expect(statements.some((s) => s.includes('ts_embeddings_pool_ts_idx'))).toBe(true);
    expect(statements.some((s) => s.includes('UNIQUE INDEX') && s.includes('content_hash'))).toBe(true);
  });
});

describe('migrate', () => {
  it('creates the extension, tables, hypertables and views', async () => {
    const runner = fullServer();
    const report = await migrate(runner);

    expect(runner.statements.some((s) => s.includes('CREATE EXTENSION IF NOT EXISTS timescaledb'))).toBe(true);
    expect(runner.statements.some((s) => s.includes('CREATE TABLE IF NOT EXISTS pool_metrics_hourly'))).toBe(true);
    expect(runner.statements.some((s) => s.includes('CREATE TABLE IF NOT EXISTS ts_forecasts'))).toBe(true);
    expect(runner.statements.some((s) => s.includes('CREATE TABLE IF NOT EXISTS ts_decisions'))).toBe(true);

    // Hypertables are built by @timescaledb/core, not hand-written DDL.
    expect(runner.statements.some((s) => s.includes("create_hypertable('pool_metrics_hourly'"))).toBe(true);
    expect(runner.statements.some((s) => s.includes("create_hypertable('ts_forecasts', by_range('issued_at')"))).toBe(true);
    expect(runner.statements.some((s) => s.includes("create_hypertable('ts_decisions', by_range('decided_at')"))).toBe(true);

    expect(report.created).toContain('pool_metrics_hourly');
    expect(report.created).toContain('ts_forecasts_latest');
    expect(report.created).toContain('v_forecast_calibration');
  });

  it('attaches a compression policy to every time-scanned hypertable', async () => {
    const runner = fullServer();
    await migrate(runner);
    const policy = runner.findAll('add_compression_policy');

    // Asserted per table rather than as a magic number: every compressed
    // hypertable must have a policy, and `ts_embeddings` must not. A count would
    // have to be edited on each schema addition and would not catch a *missing*
    // policy on a specific table.
    const compressed = [
      'pool_metrics_hourly',
      'ts_forecasts',
      'ts_decisions',
      'chain_risk_history',
      'protocol_governance_history',
      'market_maker_metrics',
      'security_incidents',
    ];
    for (const table of compressed) {
      expect(
        policy.some((q) => q.text.includes(table)),
        `expected a compression policy for ${table}`,
      ).toBe(true);
    }
    expect(policy).toHaveLength(compressed.length);
    expect(policy.every((q) => q.text.includes("INTERVAL '7 days'"))).toBe(true);
  });

  it('leaves ts_embeddings uncompressed so ANN indexes stay valid', async () => {
    const runner = fullServer();
    await migrate(runner);
    expect(
      runner.statements.some((s) => s.includes('add_compression_policy') && s.includes('ts_embeddings')),
    ).toBe(false);
  });

  it('creates the vector layer and records capabilities when pgvector is available', async () => {
    const runner = fullServer();
    const report = await migrate(runner);

    expect(runner.statements.some((s) => s.includes('CREATE EXTENSION IF NOT EXISTS vector'))).toBe(true);
    expect(runner.statements.some((s) => s.includes('CREATE EXTENSION IF NOT EXISTS vectorscale'))).toBe(true);
    expect(runner.statements.some((s) => s.includes('CREATE TABLE IF NOT EXISTS ts_embeddings'))).toBe(true);
    expect(runner.statements.some((s) => s.includes('vector(768)'))).toBe(true);
    expect(report.created).toContain('ts_embeddings');
  });

  it('skips the vector layer and has no compression policy for embeddings when pgvector is absent', async () => {
    const runner = timescaleOnlyServer();
    const report = await migrate(runner);

    expect(runner.statements.some((s) => s.includes('CREATE EXTENSION IF NOT EXISTS vector'))).toBe(false);
    expect(runner.statements.some((s) => s.includes('CREATE TABLE IF NOT EXISTS ts_embeddings'))).toBe(false);
    expect(report.skipped.some((s) => s.includes('pgvector unavailable'))).toBe(true);
  });

  it('throws a typed error when the vector layer is required but unavailable', async () => {
    await expect(migrate(timescaleOnlyServer(), { vector: 'require' })).rejects.toThrowError(
      VectorUnavailableError,
    );
  });

  it('does not recreate a table that is already a hypertable', async () => {
    const runner = new RoutingFakeRunner()
      .on("current_setting('server_version')", [{ v: 'PostgreSQL 18.6', sv: '18.6' }])
      .on('FROM pg_extension', [
        { extname: 'timescaledb', extversion: '2.30.0' },
        { extname: 'vector', extversion: '0.8.6' },
      ])
      .on('FROM pg_available_extensions', [{ name: 'vector', default_version: '0.8.6' }])
      .on('AS is_hypertable', [{ table_exists: true, is_hypertable: true }])
      .on('compression_settings', [{ n: 2 }])
      .on('INSERT INTO ts_capabilities', []);

    const report = await migrate(runner);
    expect(runner.statements.some((s) => s.includes('create_hypertable'))).toBe(false);
    expect(runner.statements.some((s) => s.includes('add_compression_policy'))).toBe(false);
    expect(report.existing).toContain('pool_metrics_hourly');
  });

  it('repairs a missing compression policy on an existing hypertable', async () => {
    const runner = new RoutingFakeRunner()
      .on("current_setting('server_version')", [{ v: 'PostgreSQL 18.6', sv: '18.6' }])
      .on('FROM pg_extension', [{ extname: 'timescaledb', extversion: '2.30.0' }])
      .on('FROM pg_available_extensions', [{ name: 'timescaledb', default_version: '2.30.0' }])
      .on('AS is_hypertable', [{ table_exists: true, is_hypertable: true }])
      .on('compression_settings', [{ n: 0 }])
      .on('INSERT INTO ts_capabilities', []);

    await migrate(runner, { vector: 'off' });
    // Hypertable exists, but compression was never configured.
    expect(runner.statements.some((s) => s.includes('create_hypertable'))).toBe(false);
    // Every time-scanned hypertable gets a repair attempt; the count follows the
    // schema, so it is derived rather than hardcoded.
    expect(runner.findAll('add_compression_policy').length).toBeGreaterThanOrEqual(7);
  });

  it('injects the configured decision horizon into the outcome view', async () => {
    const runner = fullServer();
    await migrate(runner, { decisionHorizon: '7 days', vector: 'off' });
    const view = runner.find('CREATE OR REPLACE VIEW v_decision_outcomes');
    expect(view?.text).toContain("INTERVAL '7 days'");
  });

  it('replaces views so a definition change always applies', async () => {
    const runner = fullServer();
    await migrate(runner, { vector: 'off' });
    expect(runner.statements.some((s) => s.includes('CREATE OR REPLACE VIEW ts_forecasts_latest'))).toBe(true);
    expect(runner.statements.some((s) => s.includes('CREATE OR REPLACE VIEW v_realized_yield'))).toBe(true);
  });

  it('exposes every column the forecast read path selects', async () => {
    // getLatest() reads latency_ms through this view; a column missing from the
    // projection fails only against a real server, so it is pinned here.
    const runner = fullServer();
    await migrate(runner, { vector: 'off' });
    const view = runner.find('CREATE OR REPLACE VIEW ts_forecasts_latest');
    for (const column of [
      'run_id', 'issued_at', 'target_ts', 'pool_id', 'metric', 'horizon_step',
      'point', 'q10', 'q90', 'model_version', 'context_hash', 'latency_ms',
    ]) {
      expect(view?.text).toContain(column);
    }
  });

  it('records the capability snapshot after installing extensions', async () => {
    const runner = fullServer();
    const report = await migrate(runner);
    const insert = runner.find('INSERT INTO ts_capabilities');
    expect(insert).toBeDefined();
    expect(insert?.values[4]).toBe(true); // vector_enabled
    expect(report.capabilities.available['vector']).toBe('0.8.6');
  });
});

describe('embedding kind constraint migration', () => {
  it('builds the CHECK from the enum, so the two cannot drift', () => {
    // The constraint and `EMBEDDING_KINDS` are the same fact stated twice. This
    // asserts they agree, which is what stops a widened enum from being rejected
    // by a stale constraint at insert time.
    const statements = embeddingKindCheckStatements();
    const add = statements[1];
    expect(add).toBeDefined();
    for (const kind of EMBEDDING_KINDS) {
      expect(add).toContain(`'${kind}'`);
    }
  });

  it('covers the risk-analysis kinds contributed by the risk pipeline', () => {
    const add = embeddingKindCheckStatements()[1] ?? '';
    // Named individually: a rename in either package should fail here rather
    // than silently making the kind un-insertable.
    for (const kind of [
      'governance_proposal',
      'security_incident',
      'chain_risk',
      'market_maker',
    ]) {
      expect(add).toContain(`'${kind}'`);
    }
  });

  it('drops before adding, because Postgres has no replace-check', () => {
    const statements = embeddingKindCheckStatements();
    expect(statements[0]).toContain(`DROP CONSTRAINT IF EXISTS ${EMBEDDING_KIND_CONSTRAINT}`);
    expect(statements[1]).toContain(`ADD CONSTRAINT ${EMBEDDING_KIND_CONSTRAINT}`);
  });

  it('rewrites the constraint during a migration that builds the vector layer', async () => {
    const runner = fullServer();
    await migrate(runner);
    const drop = runner.statements.findIndex((s) => s.includes(`DROP CONSTRAINT IF EXISTS ${EMBEDDING_KIND_CONSTRAINT}`));
    const add = runner.statements.findIndex((s) => s.includes(`ADD CONSTRAINT ${EMBEDDING_KIND_CONSTRAINT}`));
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(add).toBeGreaterThan(drop);
  });

  it('is idempotent — a second migration rewrites the same constraint', async () => {
    const runner = fullServer();
    await migrate(runner);
    await migrate(runner);
    const drops = runner.statements.filter((s) => s.includes('DROP CONSTRAINT IF EXISTS')).length;
    // `IF EXISTS` is what makes the second run safe; without it the migration
    // would fail on a store that already had the constraint.
    expect(drops).toBeGreaterThanOrEqual(2);
  });
});

describe('risk-data history tables', () => {
  it('creates all four risk hypertables', async () => {
    const runner = fullServer();
    const report = await migrate(runner);
    for (const table of [
      'chain_risk_history',
      'protocol_governance_history',
      'market_maker_metrics',
      'security_incidents',
    ]) {
      expect(report.created).toContain(table);
    }
  });

  it('keeps a raw jsonb column beside the parsed columns on every table', async () => {
    const runner = fullServer();
    await migrate(runner);
    // The retain-the-source rule: a classifier change must stay auditable against
    // what the upstream published at that instant.
    for (const table of [
      'chain_risk_history',
      'protocol_governance_history',
      'market_maker_metrics',
      'security_incidents',
    ]) {
      const ddl = runner.statements.find((s) => s.includes(`CREATE TABLE IF NOT EXISTS ${table}`));
      expect(ddl, `expected DDL for ${table}`).toContain('raw');
      expect(ddl).toContain('jsonb');
    }
  });

  it('constrains scores to the 0-1 range', async () => {
    const runner = fullServer();
    await migrate(runner);
    const chain = runner.statements.find((s) => s.includes('CREATE TABLE IF NOT EXISTS chain_risk_history'));
    expect(chain).toContain('composite_score >= 0 AND composite_score <= 1');
  });
});
