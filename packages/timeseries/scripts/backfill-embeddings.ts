/**
 * Backfill the temporal vector store from data already in TimescaleDB.
 *
 * The vector store is only useful if it covers history, so this walks recent
 * metric windows and stored forecast runs, serializes them into
 * citation-tagged chunks, and embeds them. It is safe to run repeatedly: the
 * upsert is keyed on a content hash, so already-indexed chunks are skipped
 * rather than duplicated.
 *
 *   TIMESERIES_DATABASE_URL=postgres://... \
 *   GOOGLE_CLOUD_PROJECT=<project> \
 *   pnpm --filter @ethonline2026/timeseries backfill:embeddings -- --days 90
 */
import {
  ForecastRepository,
  PgSqlRunner,
  TimeseriesClient,
  VectorRepository,
  VertexEmbeddingService,
  closeAllPools,
  migrate,
  serializeForecastRun,
  serializeMetricWindow,
  MetricNameSchema,
  type EmbeddingService,
  type MetricName,
  type SerializedChunk,
} from '../src/index.js';
import { FakeEmbeddingService } from '../test/helpers.js';

interface BackfillOptions {
  readonly days: number;
  readonly poolIds: readonly string[];
  readonly metrics: readonly MetricName[];
  /** `--dry-embed` keeps everything offline with a deterministic fake. */
  readonly dryEmbed: boolean;
}

function parseArgs(argv: readonly string[]): BackfillOptions {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const days = Number(value('--days') ?? '90');
  const requested = (value('--metrics') ?? 'apy,tvl')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // Validate rather than cast: an unknown metric would otherwise reach SQL.
  const metrics = requested
    .map((name) => MetricNameSchema.safeParse(name))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  return {
    days: Number.isFinite(days) && days > 0 ? days : 90,
    poolIds: (value('--pools') ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0),
    metrics: metrics.length > 0 ? metrics : ['apy', 'tvl'],
    dryEmbed: argv.includes('--dry-embed'),
  };
}

async function resolvePools(runner: PgSqlRunner, explicit: readonly string[]): Promise<readonly string[]> {
  if (explicit.length > 0) return explicit;
  const res = await runner.query(
    'SELECT DISTINCT pool_id FROM pool_metrics_hourly ORDER BY pool_id',
  );
  return res.rows
    .map((r) => r['pool_id'])
    .filter((v): v is string => typeof v === 'string');
}

function buildEmbeddingService(dryEmbed: boolean): EmbeddingService {
  if (dryEmbed) {
    console.log('[backfill] using the deterministic fake embedder (--dry-embed)');
    return new FakeEmbeddingService();
  }
  const project = process.env['GOOGLE_CLOUD_PROJECT'];
  if (project === undefined || project.length === 0) {
    throw new Error(
      'GOOGLE_CLOUD_PROJECT is required to embed for real. ' +
        'Set it, or pass --dry-embed to rehearse without Vertex AI.',
    );
  }
  return new VertexEmbeddingService({
    project,
    location: process.env['GOOGLE_CLOUD_LOCATION'],
    model: process.env['VERTEX_EMBEDDING_MODEL'],
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const runner = PgSqlRunner.fromEnv();

  // Backfill assumes the schema exists; migrate first so a fresh service works.
  await migrate(runner);

  const client = new TimeseriesClient(runner);
  const forecasts = new ForecastRepository(runner);
  const vectors = new VectorRepository(runner, buildEmbeddingService(options.dryEmbed));

  const pools = await resolvePools(runner, options.poolIds);
  if (pools.length === 0) {
    console.log('[backfill] no pools in pool_metrics_hourly — nothing to do');
    await closeAllPools();
    return;
  }

  const since = new Date(Date.now() - options.days * 86_400_000);
  const until = new Date();
  const chunks: SerializedChunk[] = [];
  let skippedEmpty = 0;

  for (const poolId of pools) {
    for (const metric of options.metrics) {
      const window = await client.getMetricWindow(poolId, metric, since, until);
      if (window.values.length < 2) {
        skippedEmpty += 1;
        continue;
      }
      chunks.push(
        serializeMetricWindow({
          poolId,
          metric,
          points: window.timestamps.map((ts, i) => ({ ts, value: window.values[i]! })),
        }),
      );
    }

    const runs = await forecasts.listRuns(poolId, { from: since, to: until });
    for (const summary of runs) {
      const run = await forecasts.getRun(summary.runId);
      if (run !== null) chunks.push(serializeForecastRun(run));
    }
  }

  console.log(
    `[backfill] pools=${pools.length} chunks=${chunks.length} ` +
      `skipped_insufficient_history=${skippedEmpty} window=${options.days}d`,
  );

  if (chunks.length === 0) {
    console.log('[backfill] nothing to embed');
    await closeAllPools();
    return;
  }

  // Batch so a free-tier connection is not held across thousands of embeddings.
  const batchSize = 32;
  let inserted = 0;
  let skipped = 0;
  for (let start = 0; start < chunks.length; start += batchSize) {
    const batch = chunks.slice(start, start + batchSize);
    const result = await vectors.upsertBatch(batch);
    inserted += result.inserted;
    skipped += result.skipped;
    console.log(
      `[backfill] ${Math.min(start + batchSize, chunks.length)}/${chunks.length} ` +
        `inserted=${inserted} skipped=${skipped}`,
    );
  }

  const total = await vectors.count();
  console.log(`[backfill] done — inserted=${inserted} skipped=${skipped} indexed_total=${total}`);
  await closeAllPools();
}

main().catch(async (err: unknown) => {
  console.error('[backfill] failed:', err);
  await closeAllPools().catch(() => undefined);
  process.exitCode = 1;
});
