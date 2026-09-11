/**
 * Integrated end-to-end verification against live hosted services.
 *
 * This is the only suite that exercises the *whole* path: a real Camoufox sweep,
 * real snapshots on disk, real writes to the hosted Tiger Cloud TimescaleDB, a
 * real temporal vector search, and a real covariate alignment computed from the
 * rows that just landed. Everything else in `test/` is offline by design, so a
 * failure here is the one that means the deployment is actually broken.
 *
 * Opt-in, because it needs network access and a database:
 *
 *     RISK_E2E=1 pnpm --filter @ethonline2026/risk-analysis-data-pipeline test:e2e
 *
 * The sweep runs once for the whole file and every assertion reads its output,
 * so the expensive part is paid once. `--limit` bounds each source, which keeps
 * the run short without reducing the number of sources exercised — the point is
 * breadth (every source reports a state), not volume.
 *
 * Every row this writes is deleted afterwards: the hosted instance is treated as
 * borrowed, not as a fixture store.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

// ── environment ──────────────────────────────────────────────────────────────
// The hosted connection string and GCP project live in the repo-root .env, not
// in this package, so it is loaded explicitly (the same pattern the langchain
// e2e suite uses).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const ENV_PATH = join(REPO_ROOT, '.env');
if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

const ENABLED = process.env['RISK_E2E'] === '1';
const DSN = process.env['TIMESERIES_DATABASE_URL'];
const HAS_VERTEX_PROJECT =
  (process.env['GOOGLE_CLOUD_PROJECT'] ?? '').length > 0;

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRAPER_ROOT = join(PACKAGE_ROOT, 'scraper');
const SNAPSHOT_DIR = join(PACKAGE_ROOT, 'logs', 'e2e', 'snapshots');

/** Records per source: enough to prove the path without a long sweep. */
const SOURCE_LIMIT = '2';

describe.skipIf(!ENABLED || DSN === undefined)('E2E: risk pipeline against live services', () => {
  let sweepExitCode = 0;

  beforeAll(() => {
    if (existsSync(SNAPSHOT_DIR)) rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
    mkdirSync(SNAPSHOT_DIR, { recursive: true });

    // The real worker: real Camoufox, real upstreams, the real parsers.
    const result = spawnSync(
      'uv',
      [
        'run',
        '--no-sync',
        'python',
        '-m',
        'risk_pipeline',
        '--no-cloud',
        '--out',
        SNAPSHOT_DIR,
        '--limit',
        SOURCE_LIMIT,
      ],
      {
        cwd: SCRAPER_ROOT,
        encoding: 'utf8',
        timeout: 900_000,
        env: { ...process.env, RISK_LOG_FORMAT: 'json' },
      },
    );
    sweepExitCode = result.status ?? 1;
  }, 900_000);

  it('completes a sweep without aborting', () => {
    // Exit code 0 means at least one source produced fresh data. Partial failure
    // is a recorded outcome, so this asserts the sweep *ran* rather than that
    // every upstream was reachable — which is not ours to guarantee.
    expect(sweepExitCode).toBe(0);
  });

  describe('snapshots', () => {
    it('writes a manifest naming every collected source with an explicit state', async () => {
      const { LocalDirStore, RiskProfileRepository } = await import('../../src/index.js');
      const repository = new RiskProfileRepository(new LocalDirStore(SNAPSHOT_DIR));

      const manifest = await repository.manifest();
      expect(manifest).not.toBeNull();

      const sources = manifest!.value.sources;
      expect(Object.keys(sources).length).toBeGreaterThan(0);

      for (const [id, entry] of Object.entries(sources)) {
        // A source must be either fresh or carry an error. A non-fresh state with
        // no error is the failure this catches: silence instead of a diagnosis.
        const explicit = entry.state === 'fresh' || entry.error !== null;
        expect(explicit, `source "${id}" has state=${entry.state} error=${entry.error}`).toBe(true);
      }
    });

    it('produces chain snapshots that satisfy the published contract', async () => {
      const { LocalDirStore, RiskProfileRepository } = await import('../../src/index.js');
      const repository = new RiskProfileRepository(new LocalDirStore(SNAPSHOT_DIR));

      const slugs = await repository.chainSlugs();
      // A missing chain set means the L2Beat source failed, which is worth
      // failing on rather than skipping past.
      expect(slugs.length).toBeGreaterThan(0);

      for (const slug of slugs) {
        // `chain` validates against the schema, so a drifted parser fails here.
        const loaded = await repository.chain(slug);
        expect(loaded, `chain "${slug}" is unreadable`).not.toBeNull();
        expect(loaded!.value.riskScores.composite).toBeGreaterThanOrEqual(0);
        expect(loaded!.value.riskScores.composite).toBeLessThanOrEqual(1);
      }
    });

    it('produces governance snapshots carrying forum provenance', async () => {
      const { LocalDirStore, RiskProfileRepository } = await import('../../src/index.js');
      const repository = new RiskProfileRepository(new LocalDirStore(SNAPSHOT_DIR));

      const slugs = await repository.protocolSlugs();
      // Discourse is a verified-available source, so an empty set is a failure
      // rather than an acceptable absence.
      expect(slugs.length).toBeGreaterThan(0);

      for (const slug of slugs.slice(0, 3)) {
        const loaded = await repository.protocol(slug);
        expect(loaded).not.toBeNull();
        expect(loaded!.value.governance.forumUrl.length).toBeGreaterThan(0);
      }
    });
  });

  describe('temporal history and covariates', () => {
    it('writes rows, reads the series back, and aligns a covariate to it', async () => {
      const { PgSqlRunner, RiskHistoryRepository } = await import('@ethonline2026/timeseries');
      const { LocalDirStore, RiskProfileRepository, buildPastCovariates, chainRowFromProfile } =
        await import('../../src/index.js');

      const repository = new RiskProfileRepository(new LocalDirStore(SNAPSHOT_DIR));
      const slugs = await repository.chainSlugs();
      expect(slugs.length).toBeGreaterThan(0);

      // `fromEnv` resolves the same connection the service uses, including the
      // SSL policy, rather than re-deriving it here.
      const runner = PgSqlRunner.fromEnv();
      const history = new RiskHistoryRepository(runner);

      const observedAt = new Date();
      const from = new Date(observedAt.getTime() - 60_000);
      const to = new Date(observedAt.getTime() + 60_000);

      try {
        let written = 0;
        for (const slug of slugs) {
          const loaded = await repository.chain(slug);
          if (loaded === null) continue;
          const result = await history.recordChainRisk([chainRowFromProfile(loaded.value, observedAt)]);
          written += result.inserted;
        }
        expect(written).toBeGreaterThan(0);

        // Queryable immediately, oldest-first: the order a covariate needs.
        const series = await history.chainCompositeSeries(slugs[0]!, { from, to });
        expect(series.length).toBeGreaterThan(0);

        // The covariate contract: every row must equal the target series length.
        // A mismatch reaches TimesFM-3 as an HTTP 500, so it is caught here.
        const grid = series.map((point) => point.ts);
        const matrix = buildPastCovariates({
          grid,
          sources: [{ name: 'chain_risk', points: series }],
        });
        expect(matrix.rows[0]).toHaveLength(series.length);
        expect(matrix.coverage[0]!.observed).toBeGreaterThan(0);
      } finally {
        // Leave the hosted instance as it was found: these rows were a probe, not
        // a backfill.
        await runner
          .query('DELETE FROM chain_risk_history WHERE ts >= $1 AND ts <= $2', [from, to])
          .catch(() => undefined);
      }
    });
  });

  describe('vector layer', () => {
    it('answers a temporal search over the hosted index', async () => {
      const { PgSqlRunner, VectorRepository, VertexEmbeddingService, probeCapabilities } =
        await import('@ethonline2026/timeseries');

      const runner = PgSqlRunner.fromEnv();
      const capabilities = await probeCapabilities(runner);
      // The hosted instance is known to carry pgvector, so a missing extension is
      // a real failure rather than a reason to pass vacuously.
      expect(capabilities.vectorEnabled).toBe(true);

      if (!HAS_VERTEX_PROJECT) {
        // Embedding a query needs Vertex. Without a project the *index* is still
        // verifiable, so the search is skipped rather than failed.
        expect(capabilities.installed['vector']).toBeTruthy();
        return;
      }

      const vectors = new VectorRepository(
        runner,
        new VertexEmbeddingService({
          project: process.env['GOOGLE_CLOUD_PROJECT']!,
          location: process.env['GOOGLE_CLOUD_LOCATION'] ?? 'us-central1',
          model: process.env['VERTEX_EMBEDDING_MODEL'] ?? 'text-embedding-005',
        }),
      );

      // An empty result is legitimate on a fresh instance: the assertion is that
      // the query executed and returned a well-formed result, which is what
      // proves the index, the dimension casts and the recall settings work.
      const hits = await vectors.searchTemporal({ query: 'chain risk history', k: 3 });
      expect(Array.isArray(hits)).toBe(true);
      for (const hit of hits) {
        expect(hit.id.length).toBeGreaterThan(0);
        expect(Number.isFinite(hit.score)).toBe(true);
      }
    });
  });
});

if (!ENABLED || DSN === undefined) {
  // Surfaced so a skipped run is self-explanatory rather than looking like a
  // silently empty suite.
  describe('E2E: risk pipeline against live services', () => {
    it.skip('set RISK_E2E=1 and TIMESERIES_DATABASE_URL in the repo-root .env to run', () => undefined);
  });
}
