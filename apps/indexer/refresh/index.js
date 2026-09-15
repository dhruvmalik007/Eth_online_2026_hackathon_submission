#!/usr/bin/env node
/**
 * indexer-cache-refresh — pull the indexer's reads and store them for CDN delivery.
 *
 * Runs as a Cloud Run Job every two hours, triggered by Cloud Scheduler. There is no HTTP surface:
 * the only way to run it is the Cloud Run Admin API with `run.invoker` on the job.
 *
 * ## It holds no database credential and no model credential
 *
 * Every credential that can read TimescaleDB, reach TimesFM-3 or spend Vertex quota stays in Vercel,
 * where it already is. This process makes HTTP calls and writes objects, so compromising it yields a
 * bucket — not the estate. Its service account has two bindings, both resource-scoped: objectAdmin on
 * the cache bucket, and secretAccessor on the one secret carrying `CRON_SECRET`.
 *
 * ## What it does, and why in this order
 *
 *   1. POST /api/cron/probe   — the indexer sweeps its dependencies AND records the rows that give
 *                               /api/model-status a history. A stored snapshot shows the present and
 *                               no history, and uptime without history cannot show an outage.
 *   2. GET  the read routes   — bounded concurrency, per-request timeout.
 *   3. GET  per-pool performance for the top N pools, in parallel.
 *   4. Write each object, then the manifest.
 *
 * ## The properties that make it safe to run unattended
 *
 *   - **A failed fetch never replaces a good object.** The previous generation stays and the manifest
 *     reports it as older. A cache serving yesterday's data under today's timestamp is worse than no
 *     cache at all.
 *   - **Partial failure is normal.** One dead dependency must not abort the other writes, so failures
 *     are collected and the run still exits 0 — unless *everything* failed, which is a real outage.
 *   - **Identical content is not rewritten.** Each object's SHA-256 is compared against the previous
 *     `sha256` in its metadata; an unchanged payload keeps its original `changedAt`. That is what lets
 *     the console say "checked 20 minutes ago, unchanged for three days" rather than resetting the
 *     clock on every run.
 *   - **Idempotent and retry-safe.** Fixed paths, overwrite semantics, and a hard deadline. A retry
 *     after a partial failure redoes only what is missing.
 */
import { createHash } from 'node:crypto';

/** Bump when a stored shape changes; the console refuses a manifest it does not understand. */
const SCHEMA_VERSION = 1;
const PREFIX = 'cache/v1';

/** Bounded so a large universe cannot turn one run into thousands of requests. */
const PERFORMANCE_POOL_LIMIT = 25;
const PERFORMANCE_DAYS = 30;
const CONCURRENCY = 6;
const REQUEST_TIMEOUT_MS = 20_000;
/** Leaves headroom inside the job's own 300s timeout for the final manifest write. */
const JOB_DEADLINE_MS = 240_000;

const startedAt = Date.now();

/**
 * Assigned in `main`, not at module scope.
 *
 * `--self-test` has to run with no environment set, and a module-scope `requireEnv` would make merely
 * importing this file fail wherever the job's configuration is absent.
 */
let config;

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is not set`);
  }
  return value.trim();
}

export const digest = (text) => createHash('sha256').update(text).digest('hex');

/**
 * Decide whether an object needs rewriting.
 *
 * Separated from the write so it can be exercised with no bucket in reach — it is the rule that makes
 * "checked 20 minutes ago, unchanged for three days" possible, and a rule stated only inside an I/O
 * call is a rule nothing can check.
 *
 * @param previousMetadata - The stored `sha256` and `changedAt`, or undefined on a first run.
 * @returns The new hash, whether to write, and the `changedAt` to record.
 */
export function decideWrite(previousMetadata, text, fetchedAt) {
  const sha256 = digest(text);
  const previousSha = previousMetadata?.sha256;
  const unchanged = previousSha === sha256;
  return {
    sha256,
    rewritten: !unchanged,
    // A rewrite moves the clock; an unchanged payload keeps the moment it last actually changed.
    changedAt: unchanged ? (previousMetadata.changedAt ?? fetchedAt) : fetchedAt,
  };
}

/**
 * One request, with a timeout and a JSON body.
 *
 * The timeout is the point: a dependency that accepts a connection and then never answers would
 * otherwise hold the run open until the job's own deadline kills it, taking the other entries with
 * it. A bounded request degrades one entry instead.
 */
async function fetchJson(path, init = {}) {
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: 'application/json', ...(init.headers ?? {}) },
  });

  const text = await response.text();
  if (!response.ok) {
    // The API answers with a typed envelope; surface the code rather than the whole body so the
    // manifest's `failures[]` stays readable.
    let detail = text.slice(0, 200);
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.error?.code ?? parsed?.error?.message ?? detail;
    } catch {
      // Not JSON — keep the truncated text.
    }
    throw new Error(`HTTP ${response.status} ${detail}`);
  }
  return { body: text, parsed: JSON.parse(text) };
}

/**
 * Run `worker` over `items`, at most `limit` at a time, preserving order.
 *
 * Stops early once the deadline passes, so a slow dependency cannot hold the run past the point where
 * the manifest could still be written.
 */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length || expired()) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

const expired = () => Date.now() - startedAt > JOB_DEADLINE_MS;

/**
 * Store one object, or leave the existing one alone if the payload is byte-identical.
 *
 * @returns The manifest entry, whether or not a write happened.
 */
async function putObject(bucket, key, path, text, fetchedAt) {
  const file = bucket.file(path);

  let previousMetadata;
  try {
    const [previous] = await file.getMetadata();
    previousMetadata = previous?.metadata;
  } catch {
    // Absent is the first-run case, not a failure.
    previousMetadata = undefined;
  }

  const { sha256, rewritten, changedAt } = decideWrite(previousMetadata, text, fetchedAt);
  const stored = { sha256, fetchedAt, changedAt };

  if (rewritten) {
    await file.save(text, {
      contentType: 'application/json; charset=utf-8',
      // Short, because a refresh should become visible within minutes of finishing; the console
      // reads the manifest first, and that one is `no-cache`.
      metadata: { cacheControl: 'public, max-age=300', metadata: stored },
    });
  }

  return {
    key,
    url: `https://storage.googleapis.com/${config.bucket}/${path}`,
    path,
    ...stored,
    bytes: Buffer.byteLength(text),
    rewritten,
  };
}

async function main() {
  // Imported here rather than at module scope so the pure helpers above — and `--self-test` — run in
  // an environment with no dependencies installed at all. The image installs it for the real run.
  const { Storage } = await import('@google-cloud/storage');
  config = {
    // Trailing slash stripped so `${baseUrl}/api/...` cannot become a double slash, which some
    // serverless routers treat as a different path.
    baseUrl: requireEnv('INDEXER_BASE_URL').replace(/\/+$/, ''),
    bucket: requireEnv('CACHE_BUCKET'),
    cronSecret: requireEnv('CRON_SECRET'),
  };

  const storage = new Storage();
  const bucket = storage.bucket(config.bucket);
  const generatedAt = new Date().toISOString();
  const failures = [];
  const entries = [];

  const record = async (key, path, fn) => {
    if (expired()) {
      failures.push({ key, error: 'skipped — the job deadline was reached' });
      return undefined;
    }
    try {
      const { body } = await fn();
      entries.push(await putObject(bucket, key, path, body, generatedAt));
      return JSON.parse(body);
    } catch (error) {
      failures.push({ key, error: error instanceof Error ? error.message : String(error) });
      return undefined;
    }
  };

  // 1. Probe first and alone. It is the only call that writes to the database, and its report is
  //    what the console compares the cached pool and status documents against.
  const health = await record('health', `${PREFIX}/health.json`, () =>
    fetchJson('/api/cron/probe', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.cronSecret}` },
    }),
  );

  // 2. The independent reads, in parallel — none depends on another.
  const pools = await record('pools', `${PREFIX}/pools.json`, () => fetchJson('/api/pools?limit=200'));
  await Promise.all([
    record('model-status', `${PREFIX}/model-status.json`, () =>
      fetchJson('/api/model-status?hours=168'),
    ),
    record('risk/chains', `${PREFIX}/risk/chains.json`, () => fetchJson('/api/risk/chains')),
    record('risk/protocols', `${PREFIX}/risk/protocols.json`, () => fetchJson('/api/risk/protocols')),
  ]);

  // 3. Per-pool performance for the most recently observed pools. The pool list is already ordered by
  //    recency, so the cap keeps the live end rather than an arbitrary slice.
  const poolIds = (pools?.pools ?? [])
    .slice(0, PERFORMANCE_POOL_LIMIT)
    .map((pool) => pool.poolId)
    .filter((id) => typeof id === 'string');

  await mapLimit(poolIds, CONCURRENCY, (poolId) =>
    record(`performance/${poolId}`, `${PREFIX}/performance/${encodeURIComponent(poolId)}.json`, () =>
      fetchJson(
        `/api/performance?poolId=${encodeURIComponent(poolId)}&days=${PERFORMANCE_DAYS}`,
      ),
    ),
  );

  // 4. The manifest last, so it never describes an object that was not attempted. `no-cache` because
  //    it is the index: a stale index makes every other object look stale too.
  const manifest = {
    version: SCHEMA_VERSION,
    generatedAt,
    durationMs: Date.now() - startedAt,
    baseUrl: config.baseUrl,
    performancePoolLimit: PERFORMANCE_POOL_LIMIT,
    entries: entries.sort((a, b) => a.key.localeCompare(b.key)),
    failures,
    healthStatus: health?.status ?? null,
  };

  await bucket.file(`${PREFIX}/manifest.json`).save(JSON.stringify(manifest, null, 2), {
    contentType: 'application/json; charset=utf-8',
    metadata: { cacheControl: 'no-cache', metadata: { sha256: digest(JSON.stringify(manifest)) } },
  });

  console.log(
    JSON.stringify({
      ok: failures.length === 0,
      generatedAt,
      durationMs: manifest.durationMs,
      written: entries.filter((entry) => entry.rewritten).length,
      unchanged: entries.filter((entry) => !entry.rewritten).length,
      failed: failures.map((failure) => failure.key),
      health: health?.status ?? 'unavailable',
    }),
  );

  // Exit non-zero only when nothing at all was stored. One dead dependency is the normal case the
  // manifest exists to describe; an empty cache is an outage.
  if (entries.length === 0) process.exitCode = 1;
}

/**
 * Assertions over the pure rules, runnable with nothing installed and no environment set:
 *
 *   node apps/indexer/refresh/index.js --self-test
 *
 * The deployment battery verifies the manifest that actually lands in the bucket. This verifies the
 * two rules that decide what lands there — and that the concurrency bound holds — which an end-to-end
 * check can only ever observe indirectly. Deliberately not a test framework: the job is a standalone
 * container package outside the workspace, so importing it into the app's suite would mean adding its
 * dependency to the app for no other purpose.
 */
async function selfTest() {
  const checks = [];
  const assert = (name, ok) => checks.push({ name, ok: Boolean(ok) });

  const body = '{"a":1}';
  const now = '2026-09-15T00:00:00.000Z';
  const earlier = '2026-01-01T00:00:00.000Z';

  assert('digest is stable', digest(body) === digest(body));
  assert('digest separates payloads', digest(body) !== digest('{"a":2}'));
  assert('digest is a hex sha256', /^[0-9a-f]{64}$/.test(digest(body)));

  // The reason the timestamp is worth showing at all: "checked 2h ago, unchanged for 3 days" is only
  // true if an unchanged payload does not reset `changedAt`.
  const same = decideWrite({ sha256: digest(body), changedAt: earlier }, body, now);
  assert('identical content is not rewritten', same.rewritten === false);
  assert('identical content keeps its changedAt', same.changedAt === earlier);

  const differs = decideWrite({ sha256: 'deadbeef', changedAt: earlier }, body, now);
  assert('changed content is rewritten', differs.rewritten === true);
  assert('changed content moves changedAt', differs.changedAt === now);

  const first = decideWrite(undefined, body, now);
  assert('a first run writes', first.rewritten === true);
  assert('a first run dates the change now', first.changedAt === now);

  // The bound is the promise: a large universe must not become unbounded concurrency.
  const items = Array.from({ length: 20 }, (_, index) => index);
  let inFlight = 0;
  let peak = 0;
  const seen = await mapLimit(items, 4, async (item) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 2));
    inFlight -= 1;
    return item;
  });
  assert('mapLimit never exceeds its bound', peak <= 4);
  assert('mapLimit orders results by input', seen.length === 20 && seen.every((value, i) => value === i));

  const failed = checks.filter((check) => !check.ok);
  for (const check of checks) console.log(`${check.ok ? '  ok  ' : ' FAIL '} ${check.name}`);
  console.log(
    failed.length === 0 ? `\n${checks.length} checks passed` : `\n${failed.length} of ${checks.length} FAILED`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

if (process.argv.includes('--self-test')) {
  selfTest().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
