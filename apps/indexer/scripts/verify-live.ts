/**
 * Live verification for the indexer surface.
 *
 * Exercises the real handlers against real services — no HTTP server, no
 * fakes — by building a production runtime from the environment and calling
 * each route's handler directly. This is the check that proves the composition
 * root, the SQL, the forecast ledger, the vector layer and the model wiring all
 * work together on this deployment.
 *
 * Read-only with respect to data: nothing is written except a forecast run and
 * a set of embeddings for a pool that already has history, and both are
 * reported so they can be removed.
 *
 *   TIMESERIES_DATABASE_URL=… GOOGLE_CLOUD_PROJECT=… \
 *   pnpm --filter @ethonline2026/indexer verify:live
 */
import { closeAllPools } from '@ethonline2026/timeseries';
import { handleAgent, handleForecast, handleHealth, handleMetrics, handlePerformance, handleSearch } from '../api/_lib/handlers.js';
import { createRuntime } from '../api/_lib/runtime.js';

let failures = 0;
let skipped = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures += 1;
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

function skip(label: string, reason: string): void {
  skipped += 1;
  console.log(`- ${label} — skipped: ${reason}`);
}

async function json(res: Response): Promise<Record<string, unknown>> {
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = body['error'] as Record<string, unknown> | undefined;
    throw new Error(`HTTP ${res.status} ${String(err?.['code'])}: ${String(err?.['message'])}`);
  }
  return body;
}

function get(path: string): Request {
  return new Request(`https://indexer.local${path}`);
}

function post(path: string, body: unknown): Request {
  return new Request(`https://indexer.local${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function main(): Promise<void> {
  const runtime = createRuntime();

  // ── health ────────────────────────────────────────────────────────────────
  console.log('\n[health]');
  const health = await json(await handleHealth(runtime));
  console.log('  status:', health['status'], '| degraded:', health['degraded']);
  check('database reachable', (health['database'] as Record<string, unknown>)['reachable'] === true);
  check('timesfm3 reachable', (health['timesfm3'] as Record<string, unknown>)['reachable'] === true);
  const caps = health['timescaledb'] as Record<string, unknown> | null;
  check('timescaledb capability probe', caps !== null && caps !== undefined,
    caps === null ? '' : `timescaledb ${String(caps['timescaleVersion'])}`);
  if (caps !== null && caps !== undefined) {
    check('pgvector enabled', caps['vectorEnabled'] === true);
  }

  // Pick a pool that has history. If the store is empty, seed a probe pool so
  // the routes can be exercised for real, then remove it on the way out — the
  // check should not depend on someone else's ingest having run first.
  let seededProbe = false;
  let poolId: string;
  let pointCount: number;

  const coverage = await runtime.metrics.getCoverage();
  if (coverage.poolCount === 0) {
    poolId = `0xverify-indexer-${Math.random().toString(16).slice(2, 10)}`;
    const now = Date.now();
    const rows = Array.from({ length: 48 }, (_, i) => ({
      poolId,
      ts: new Date(now - (47 - i) * 3_600_000),
      protocol: 'verify',
      network: 'ethereum',
      // A gently oscillating series so the forecast has structure to model.
      apy: 0.04 + Math.sin(i / 7) * 0.004,
      volumeUsd: 1_000_000 + i * 1_000,
      tvlUsd: 50_000_000,
      utilization: 0.7,
      vol: 0.3,
      txCount: 100 + i,
    }));
    await runtime.metrics.upsertPoolMetrics(rows);
    seededProbe = true;
    pointCount = rows.length;
    console.log(`\n[pool] store was empty — seeded probe pool ${poolId} (${pointCount} points)`);
  } else {
    const poolList = await runtime.runner.query(
      `SELECT pool_id, count(*)::int AS n FROM pool_metrics_hourly
       GROUP BY pool_id ORDER BY n DESC LIMIT 1`,
    );
    poolId = String(poolList.rows[0]?.['pool_id'] ?? '');
    pointCount = Number(poolList.rows[0]?.['n'] ?? 0);
    console.log(`\n[pool] using ${poolId} (${pointCount} observations)`);
  }

  // ── metrics ───────────────────────────────────────────────────────────────
  console.log('\n[metrics]');
  const metrics = await json(
    await handleMetrics(get(`/api/metrics?poolId=${encodeURIComponent(poolId)}&metric=apy&days=90&bucket=1 day`), runtime),
  );
  const points = metrics['points'] as unknown[];
  check('bucketed series returned', points.length > 0, `${points.length} buckets`);
  check('buckets carry an ISO start', typeof (points[0] as Record<string, unknown>)?.['bucketStart'] === 'string');

  // ── performance ───────────────────────────────────────────────────────────
  console.log('\n[performance]');
  const perf = await json(
    await handlePerformance(get(`/api/performance?poolId=${encodeURIComponent(poolId)}&days=90`), runtime),
  );
  check('realized yield series returned', (perf['realizedYield'] as unknown[]).length > 0,
    `${(perf['realizedYield'] as unknown[]).length} buckets`);
  const calibration = perf['calibration'] as unknown[];
  if (calibration.length === 0) {
    skip('calibration figures', 'no forecast has matured past its target timestamp yet');
  } else {
    const first = calibration[0] as Record<string, unknown>;
    const coverageValue = Number(first['coverage']);
    check('calibration coverage is a probability',
      Number.isFinite(coverageValue) && coverageValue >= 0 && coverageValue <= 1,
      `coverage=${coverageValue.toFixed(3)} samples=${String(first['samples'])}`);
  }

  // ── forecast ──────────────────────────────────────────────────────────────
  console.log('\n[forecast]');
  try {
    const forecast = await json(
      await handleForecast(post('/api/forecast', { poolId, metric: 'apy', horizon: 7, windowDays: 90 }), runtime),
    );
    if (forecast['status'] === 'insufficient_history') {
      skip('live forecast', `only ${String(forecast['points'])} observations (need >= 8)`);
    } else {
      const steps = forecast['steps'] as Array<Record<string, unknown>>;
      check('forecast returned', steps.length === 7, `${steps.length} steps`);
      check('quantiles ordered', steps.every((s) => Number(s['q10']) <= Number(s['q50']) && Number(s['q50']) <= Number(s['q90'])));
      check('guardrail flags present and clean',
        (forecast['flags'] as Record<string, unknown>)['quantileMonotonic'] === true,
        `latency ${Math.round(Number(forecast['latencyMs']))}ms`);
    }
  } catch (err) {
    check('live forecast', false, err instanceof Error ? err.message : String(err));
  }

  // ── retrieval ─────────────────────────────────────────────────────────────
  console.log('\n[retrieval]');
  if (runtime.vectors === undefined) {
    skip('temporal search', 'GOOGLE_CLOUD_PROJECT is not set, so embeddings are unconfigured');
  } else {
    try {
      const search = await json(
        await handleSearch(post('/api/search', { query: `apy history for ${poolId}`, poolId, k: 5 }), runtime),
      );
      const hits = search['hits'] as Array<Record<string, unknown>>;
      if (hits.length === 0) {
        skip('temporal search results', 'no embeddings indexed yet — run backfill:embeddings');
      } else {
        check('temporal search returned hits', true, `${hits.length} hits`);
        check('every hit carries source ids (citation guard input)',
          hits.every((h) => (h['sourceIds'] as unknown[]).length > 0));
        const scores = hits.map((h) => Number(h['score']));
        check('scores are descending', scores.every((s, i) => i === 0 || scores[i - 1]! >= s));
      }
    } catch (err) {
      check('temporal search', false, err instanceof Error ? err.message : String(err));
    }
  }

  // ── agent (deterministic path — no model spend) ───────────────────────────
  console.log('\n[agent dry]');
  const dry = await json(
    await handleAgent(post('/api/agent', { query: 'verify the desk', poolIds: [poolId], dry: true }), runtime),
  );
  check('dry run returns coverage', (dry['coverage'] as Record<string, unknown>)['rowCount'] !== undefined);
  check('dry run reached the requested pool',
    (dry['pools'] as Array<Record<string, unknown>>).some((p) => p['poolId'] === poolId));

  // ── agent (full v0.1 cycle, model calls) ──────────────────────────────────
  const runFull = process.env['VERIFY_FULL_AGENT'] === 'true';
  console.log('\n[agent v01]');
  if (!runFull) {
    skip('full five-node cycle', 'set VERIFY_FULL_AGENT=true to spend model credits');
  } else {
    try {
      const res = await handleAgent(
        post('/api/agent', {
          query: 'Is the yield on this pool stable enough to supply capital for 30 days?',
          poolIds: [poolId],
          protocols: ['aave-v3'],
          horizonDays: 30,
        }),
        runtime,
      );
      const payload = await json(res);
      const audit = payload['audit'] as Array<Record<string, unknown>>;
      check('cycle produced an audit trail', audit.length > 0, `${audit.length} entries`);
      const projections = payload['projections'] as Array<Record<string, unknown>>;
      check('node 3 produced projections', projections.length > 0);
      check('forecast run persisted (citation anchor present)',
        typeof payload['forecastRunId'] === 'string' && String(payload['forecastRunId']).length > 0,
        String(payload['forecastRunId']));
      check('projection carries the ledger run id',
        projections.some((p) => typeof p['forecastRunId'] === 'string'));
      const decisions = payload['decisions'] as Array<Record<string, unknown>>;
      check('node 5 produced decisions', decisions.length > 0);
      check('decisions are cited', decisions.every((d) => (d['citations'] as unknown[]).length > 0));
      for (const d of decisions) {
        console.log(
          `    → ${String(d['action'])} ${String(d['protocol'])} ${Number(d['amountPercentage'])}% ` +
            `cites [${(d['citations'] as string[]).join(', ')}]`,
        );
      }
      const risk = payload['riskAssessment'] as Record<string, unknown>;
      console.log('  guardrails:', risk['replanNeeded'] === true ? risk['reasons'] : 'clean');
      if (payload['calibration'] !== null && payload['calibration'] !== undefined) {
        check('calibration reached agent state', true,
          `coverage=${Number((payload['calibration'] as Record<string, unknown>)['coverage']).toFixed(3)}`);
      } else {
        skip('calibration in state', 'no matured forecast history for this pool');
      }
      console.log(`  elapsed: ${String(payload['elapsedMs'])}ms`);
    } catch (err) {
      check('full five-node cycle', false, err instanceof Error ? err.message : String(err));
    }
  }

  // Leave the store as we found it: a seeded probe pool and anything derived
  // from it (forecasts, decisions, embeddings) is removed.
  if (seededProbe) {
    for (const table of ['ts_embeddings', 'ts_decisions', 'ts_forecasts', 'pool_metrics_hourly']) {
      await runtime.runner.query(`DELETE FROM ${table} WHERE pool_id = $1`, [poolId]);
    }
    console.log(`\n[cleanup] removed probe pool ${poolId}`);
  }

  await closeAllPools();
  console.log(
    failures === 0
      ? `\nLIVE VERIFICATION PASSED${skipped > 0 ? ` (${skipped} skipped)` : ''}`
      : `\nLIVE VERIFICATION FAILED (${failures})`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch(async (err: unknown) => {
  console.error('\nLIVE VERIFICATION ERRORED:', err);
  await closeAllPools().catch(() => undefined);
  process.exitCode = 1;
});
