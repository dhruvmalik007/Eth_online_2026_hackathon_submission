/**
 * Apply the schema migration to the configured TimescaleDB service.
 *
 * Safe to run on every deploy: tables use `IF NOT EXISTS`, hypertables are
 * probe-gated, and views are replaced. Prints what it found and what it did.
 *
 *   TIMESERIES_DATABASE_URL=postgres://... pnpm --filter @ethonline2026/timeseries migrate
 *   ... migrate --vector=require   # fail instead of degrading when pgvector is absent
 *   ... migrate --no-compression   # skip compression policies
 */
import { PgSqlRunner, closeAllPools, migrate, type VectorMode } from '../src/index.js';

function vectorMode(argv: readonly string[]): VectorMode {
  const flag = argv.find((a) => a.startsWith('--vector='));
  const value = flag?.slice('--vector='.length);
  return value === 'off' || value === 'require' || value === 'auto' ? value : 'auto';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runner = PgSqlRunner.fromEnv();
  console.log('[migrate] connecting to', {
    viaDsn: runner.connection.fromConnectionString,
    ssl: runner.connection.ssl,
    poolMax: runner.connection.maxConnections,
  });

  const report = await migrate(runner, {
    vector: vectorMode(args),
    compression: !args.includes('--no-compression'),
  });

  console.log('[migrate] capabilities', {
    postgres: report.capabilities.postgresVersion,
    timescaledb: report.capabilities.timescaleVersion,
    vector: report.capabilities.installed['vector'] ?? null,
    vectorscale: report.capabilities.installed['vectorscale'] ?? null,
  });
  console.log('[migrate] created', report.created);
  console.log('[migrate] already present', report.existing);
  if (report.skipped.length > 0) console.log('[migrate] skipped', report.skipped);
  console.log(`[migrate] executed ${report.statementCount} statements`);

  await closeAllPools();
}

main().catch(async (err: unknown) => {
  console.error('[migrate] failed:', err);
  await closeAllPools().catch(() => undefined);
  process.exitCode = 1;
});
