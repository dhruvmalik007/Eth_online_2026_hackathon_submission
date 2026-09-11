/**
 * Live Tiger Cloud verification.
 *
 * Proves the whole stack against a real service: connection + SSL policy,
 * migration through the `@timescaledb/core` builders, capacity of the
 * pgvector/vectorscale extensions, the forecast + decision ledgers, the
 * SQL-computed calibration views, and a temporal vector round-trip.
 *
 * Every write uses a per-run pool id and a fixed timestamp, so re-running the
 * script neither collides with real data nor accumulates junk. The run is
 * removed again at the end.
 *
 *   TIMESERIES_DATABASE_URL=postgres://... pnpm --filter @ethonline2026/timeseries verify:live
 */
import { randomUUID } from 'node:crypto';
import {
  DecisionRepository,
  ForecastRepository,
  PerformanceRepository,
  PgSqlRunner,
  TimeseriesClient,
  VectorRepository,
  closeAllPools,
  migrate,
  serializeDecision,
  serializeForecastRun,
  serializeMetricWindow,
  type ForecastQuantiles,
} from '../src/index.js';
import { FakeEmbeddingService } from '../test/helpers.js';

const PROBE_POOL = `0xverify-${randomUUID().slice(0, 8)}`;
const ISSUED_AT = new Date('2026-09-10T00:00:00.000Z');

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  const mark = condition ? '✓' : '✗';
  if (!condition) failures += 1;
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ''}`);
}

const quantiles = (q50: number): ForecastQuantiles => ({
  q10: q50 - 0.02, q20: q50 - 0.015, q30: q50 - 0.01, q40: q50 - 0.005,
  q50, q60: q50 + 0.005, q70: q50 + 0.01, q80: q50 + 0.015, q90: q50 + 0.02,
});

async function main(): Promise<void> {
  const runner = PgSqlRunner.fromEnv();
  console.log('connection:', {
    dsn: runner.connection.fromConnectionString,
    ssl: runner.connection.ssl,
    max: runner.connection.maxConnections,
  });

  // ── 1. Migration ──────────────────────────────────────────────────────────
  const report = await migrate(runner);
  console.log('\n[migrate]', {
    created: report.created,
    existing: report.existing,
    skipped: report.skipped,
    statements: report.statementCount,
  });
  check('timescaledb installed', report.capabilities.timescaleVersion !== null,
    report.capabilities.timescaleVersion ?? '');
  check('vector extension enabled', report.capabilities.vectorEnabled);
  check('vectorscale extension enabled', report.capabilities.vectorscaleEnabled);
  check('hypertables present', report.created.length + report.existing.length >= 4);

  // Re-running must be a no-op — this is the deploy-time safety property.
  const second = await migrate(runner);
  check('migration is idempotent', second.existing.length >= 4,
    `existing=${second.existing.length}`);
  check('no tables recreated on re-run',
    !second.created.some((c) => ['pool_metrics_hourly', 'ts_forecasts', 'ts_decisions'].includes(c)));

  const client = new TimeseriesClient(runner);
  const forecasts = new ForecastRepository(runner);
  const decisions = new DecisionRepository(runner);
  const performance = new PerformanceRepository(runner);

  // Confirm the hypertable partition columns are what we intended.
  const hypertables = await runner.query(
    `SELECT hypertable_name, num_dimensions FROM timescaledb_information.hypertables
     WHERE hypertable_name = ANY($1::text[]) ORDER BY hypertable_name`,
    [['pool_metrics_hourly', 'ts_forecasts', 'ts_decisions', 'ts_embeddings']],
  );
  check('four hypertables registered', hypertables.rows.length === 4,
    hypertables.rows.map((r) => String(r.hypertable_name)).join(', '));

  const compression = await runner.query(
    `SELECT hypertable_name FROM timescaledb_information.compression_settings
     WHERE hypertable_name = ANY($1::text[]) GROUP BY hypertable_name ORDER BY hypertable_name`,
    [['pool_metrics_hourly', 'ts_forecasts', 'ts_decisions', 'ts_embeddings']],
  );
  const compressed = compression.rows.map((r) => String(r.hypertable_name));
  check('compression on the three time-scanned tables',
    compressed.includes('pool_metrics_hourly') && compressed.includes('ts_forecasts') &&
      compressed.includes('ts_decisions'));
  check('ts_embeddings left uncompressed (ANN index validity)',
    !compressed.includes('ts_embeddings'));

  // ── 2. Metric store ──────────────────────────────────────────────────────
  const rows = Array.from({ length: 48 }, (_, i) => ({
    poolId: PROBE_POOL,
    ts: new Date(Date.UTC(2026, 8, 1, i)),
    protocol: 'verify',
    network: 'ethereum',
    apy: 0.04 + Math.sin(i / 8) * 0.005,
    volumeUsd: 1_000_000 + i * 1000,
    tvlUsd: 50_000_000,
    utilization: 0.7,
    vol: 0.3,
    txCount: 100 + i,
  }));
  const inserted = await client.upsertPoolMetrics(rows);
  check('upserted hourly metrics', inserted === 48, `${inserted} rows`);

  // Idempotency: the same batch again must not duplicate.
  await client.upsertPoolMetrics(rows);
  const window = await client.getMetricWindow(
    PROBE_POOL, 'apy', new Date('2026-09-01T00:00:00Z'),
  );
  check('upsert is idempotent per (pool, ts)', window.values.length === 48,
    `${window.values.length} points`);

  const bucketed = await client.getMetricWindowBucketed(PROBE_POOL, 'apy', '12 hours', {
    start: new Date('2026-09-01T00:00:00Z'),
    end: new Date('2026-09-03T00:00:00Z'),
  });
  check('time-bucket analytics returns points', bucketed.length > 0,
    `${bucketed.length} buckets`);
  check('buckets are chronologically ordered',
    bucketed.every((p, i) => i === 0 || p.bucketStart >= bucketed[i - 1]!.bucketStart));

  const coverage = await client.getCoverage();
  check('coverage reports the store', coverage.poolCount >= 1, `${coverage.poolCount} pools`);

  // ── 3. Forecast ledger + calibration ─────────────────────────────────────
  // Forecast targets line up with stored metric timestamps so the calibration
  // view has realized values to join against.
  const runId = randomUUID();
  const steps = Array.from({ length: 12 }, (_, i) => ({
    targetTs: new Date(Date.UTC(2026, 8, 1, i)),
    horizonStep: i + 1,
    point: rows[i]!.apy,
    // Deliberately centred slightly off the actual so calibration is not trivial.
    quantiles: quantiles(rows[i]!.apy + 0.001),
  }));
  const written = await forecasts.saveRun({
    runId,
    poolId: PROBE_POOL,
    metric: 'apy',
    issuedAt: ISSUED_AT,
    modelVersion: 'timesfm-3.0-verify',
    contextHash: 'verify-ctx',
    latencyMs: 153,
    steps,
  });
  check('persisted a forecast run', written === 12, `${written} steps`);

  const latest = await forecasts.getLatest(PROBE_POOL, 'apy');
  check('latest forecast is readable', latest?.runId === runId, latest?.runId ?? 'none');
  check('latest forecast preserves the quantile vector',
    latest?.steps[0] !== undefined &&
      latest.steps[0].quantiles.q10 < latest.steps[0].quantiles.q90);

  const calibration = await performance.getCalibration(PROBE_POOL, {
    from: new Date('2026-09-01T00:00:00Z'),
    to: new Date('2026-09-03T00:00:00Z'),
  });
  check('calibration joins forecasts to realized metrics', calibration.length > 0,
    `${calibration.length} scored steps`);
  if (calibration.length > 0) {
    const sample = calibration[0]!;
    // The view must agree with its own inputs — pinball loss is derived, not guessed.
    const expectedPinball = 0.5 * Math.abs(sample.actual - sample.forecastQ50);
    check('pinball loss matches its definition',
      Math.abs(sample.pinballLoss - expectedPinball) < 1e-9);
    check('coverage matches the q10–q90 band',
      sample.covered === (sample.actual >= sample.forecastQ10 && sample.actual <= sample.forecastQ90));
  }

  const summary = await performance.getCalibrationSummary(PROBE_POOL, {
    from: new Date('2026-09-01T00:00:00Z'),
    to: new Date('2026-09-03T00:00:00Z'),
  });
  check('calibration summary aggregates', summary.length > 0,
    summary[0] ? `coverage=${summary[0].coverage.toFixed(3)} samples=${summary[0].samples}` : '');

  // ── 4. Decision ledger + outcome evaluation ──────────────────────────────
  const decisionId = randomUUID();
  await decisions.record({
    decisionId,
    decidedAt: new Date('2026-09-01T00:00:00Z'),
    poolId: PROBE_POOL,
    action: 'SUPPLY_CAPITAL',
    sizeUsd: 25_000,
    confidence: 0.72,
    citedForecastIds: [runId],
    citedMetricIds: [`metric:${PROBE_POOL}:apy:2026-09-01T00:00:00.000Z`],
    rationale: 'Live verification probe.',
    stateSnapshot: { probe: 'true' },
    modelVersions: { timesfm: 'timesfm-3.0-verify', llm: 'verify' },
  });
  const history = await decisions.getHistory(PROBE_POOL, {
    from: new Date('2026-09-01T00:00:00Z'),
    to: new Date('2026-09-02T00:00:00Z'),
  });
  check('decision ledger records the citation trail',
    history.length === 1 && history[0]!.citedForecastIds.includes(runId));

  const realized = await performance.getRealizedYield(PROBE_POOL, {
    from: new Date('2026-09-01T00:00:00Z'),
    to: new Date('2026-09-03T00:00:00Z'),
  });
  check('realized yield is bucketed daily', realized.length > 0, `${realized.length} days`);

  const outcomes = await performance.getDecisionOutcomes(PROBE_POOL, {
    from: new Date('2026-09-01T00:00:00Z'),
    to: new Date('2026-09-02T00:00:00Z'),
  });
  check('decision outcome view returns the scored decision', outcomes.length >= 1,
    outcomes[0] ? `score=${String(outcomes[0].outcomeScore)}` : '');

  // ── 5. Temporal vector round-trip ────────────────────────────────────────
  // The fake embedder keeps this deterministic; the Vertex path is exercised
  // by the indexer with real credentials.
  const embeddings = new FakeEmbeddingService();
  const vectors = new VectorRepository(runner, embeddings);
  await vectors.assertAvailable();

  const chunks = [
    serializeMetricWindow({ poolId: PROBE_POOL, metric: 'apy', points: rows.map((r) => ({ ts: r.ts, value: r.apy })) }),
    serializeForecastRun({
      runId, poolId: PROBE_POOL, metric: 'apy', issuedAt: ISSUED_AT,
      modelVersion: 'timesfm-3.0-verify', contextHash: 'verify-ctx', steps,
    }),
    serializeDecision({
      decisionId, decidedAt: new Date('2026-09-01T00:00:00Z'), poolId: PROBE_POOL,
      action: 'SUPPLY_CAPITAL', sizeUsd: 25_000, confidence: 0.72,
      citedForecastIds: [runId], citedMetricIds: [], rationale: 'Live verification probe.',
      stateSnapshot: {}, modelVersions: {},
    }),
  ].filter((c): c is NonNullable<typeof c> => c !== null);

  const up = await vectors.upsertBatch(chunks);
  check('vector chunks embedded and inserted', up.inserted === chunks.length,
    `inserted=${up.inserted} skipped=${up.skipped}`);

  const rerun = await vectors.upsertBatch(chunks);
  check('vector upsert is idempotent by content hash', rerun.inserted === 0 && rerun.skipped === chunks.length,
    `skipped=${rerun.skipped}`);

  const hits = await vectors.searchTemporal({
    query: 'apy forecast for the pool', poolId: PROBE_POOL, k: 3,
  });
  check('temporal vector search returns hits', hits.length > 0, `${hits.length} hits`);
  check('every hit carries source ids (citation guard input)',
    hits.every((h) => h.sourceIds.length > 0));
  check('similarity scores are descending',
    hits.every((h, i) => i === 0 || hits[i - 1]!.score >= h.score));

  const scoped = await vectors.searchTemporal({
    query: 'apy forecast',
    poolId: PROBE_POOL,
    from: new Date('2026-09-01T00:00:00Z'),
    to: new Date('2026-09-02T00:00:00Z'),
    k: 3,
  });
  check('time-scoped search stays inside the window',
    scoped.every((h) => h.tsEnd >= new Date('2026-09-01T00:00:00Z')));

  const vectorCount = await vectors.count(PROBE_POOL);
  check('vector count reflects the probe pool', vectorCount >= chunks.length, `${vectorCount} chunks`);

  const annIndex = await runner.query(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'ts_embeddings' ORDER BY indexname`,
  );
  const indexNames = annIndex.rows.map((r) => String(r.indexname));
  check('an ANN index exists on ts_embeddings',
    indexNames.some((n) => n.includes('diskann') || n.includes('hnsw')),
    indexNames.join(', '));

  // ── 6. Cleanup ───────────────────────────────────────────────────────────
  await runner.query('DELETE FROM ts_embeddings WHERE pool_id = $1', [PROBE_POOL]);
  await runner.query('DELETE FROM ts_decisions WHERE pool_id = $1', [PROBE_POOL]);
  await runner.query('DELETE FROM ts_forecasts WHERE pool_id = $1', [PROBE_POOL]);
  await runner.query('DELETE FROM pool_metrics_hourly WHERE pool_id = $1', [PROBE_POOL]);
  console.log('\n[cleanup] probe rows removed');

  await closeAllPools();
  console.log(failures === 0 ? '\nLIVE VERIFICATION PASSED' : `\nLIVE VERIFICATION FAILED (${failures})`);
  if (failures > 0) process.exitCode = 1;
}

main().catch(async (err: unknown) => {
  console.error('\nLIVE VERIFICATION ERRORED:', err);
  await closeAllPools().catch(() => undefined);
  process.exitCode = 1;
});
