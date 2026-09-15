/**
 * Deployment verification for the indexer surface.
 *
 * The sibling `verify-live.ts` builds a runtime and calls handlers in-process, which proves the
 * composition root, the SQL and the model wiring. It cannot prove anything about what a *deployed*
 * route actually answers — routing, function config, the environment Vercel injects, deployment
 * protection, or whether a request carries the credentials the invocation needs. Both of this
 * project's recent production incidents lived in exactly that gap: a missing `INFERENCE_SERVICE_URL`
 * and an OIDC token that was never captured because the adapter that needed it did not translate a
 * request. Neither is visible from inside the process.
 *
 * So this speaks HTTP to a deployment, and can be pointed at staging, a preview or production.
 *
 *   INDEXER_BASE_URL=https://ethonline-2026-indexer.vercel.app \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=… \
 *   pnpm --filter @ethonline2026/indexer verify:deployment
 *
 * ## Three outcomes, not two
 *
 * A protected deployment answers every route with a 302 to Vercel's SSO flow. That is not a pass and
 * it is not a failure — it means this script cannot speak for the deployment, and reporting it as
 * either would be a lie in one direction or the other. It exits 2 for that, distinctly, so CI can
 * treat "unverified" differently from "broken".
 */
const BASE = (process.env['INDEXER_BASE_URL'] ?? '').replace(/\/+$/, '');
const BYPASS = process.env['VERCEL_AUTOMATION_BYPASS_SECRET']?.trim() ?? '';
const CACHE_ONLY = process.argv.includes('--cache-only');

/** The scheduler's cadence, from the Cloud Run Job's cron expression. */
const CACHE_INTERVAL_HOURS = 2;
/** Room for a run to take longer than its schedule without the check flapping. */
const CACHE_SLACK_HOURS = 4;

let failures = 0;
let inconclusive = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures += 1;
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

function unverifiable(label: string, reason: string): void {
  inconclusive += 1;
  console.log(`? ${label} — cannot verify: ${reason}`);
}

function note(label: string, detail: string): void {
  console.log(`· ${label} — ${detail}`);
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    accept: 'application/json',
    ...(BYPASS.length === 0 ? {} : { 'x-vercel-protection-bypass': BYPASS }),
    ...extra,
  };
}

/** A response, plus whether deployment protection intercepted it instead of the route. */
interface Attempt {
  readonly res: Response;
  readonly protectedBy: string | null;
}

async function attempt(path: string, init: RequestInit = {}): Promise<Attempt> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers(), ...((init.headers as Record<string, string>) ?? {}) },
    redirect: 'manual',
  });
  const location = res.headers.get('location') ?? '';
  const protectedBy = res.status === 302 && location.includes('sso-api') ? location : null;
  return { res, protectedBy };
}

async function body(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** The error envelope every route shares: `{ error: { code, message } }`. */
function errorCode(payload: Record<string, unknown>): string | null {
  const error = payload['error'];
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as Record<string, unknown>)['code'];
  return typeof code === 'string' ? code : null;
}

/**
 * One route: reachable, JSON, and carrying the headers the contract promises.
 *
 * `cache-control: no-store` is asserted rather than assumed. Every live read is per-request data,
 * and a CDN or proxy that cached one would serve a pool's metrics to a different pool's request.
 */
async function route(label: string, path: string, init?: RequestInit): Promise<Record<string, unknown> | null> {
  const { res, protectedBy } = await attempt(path, init);
  if (protectedBy !== null) {
    unverifiable(label, 'the deployment is behind Vercel authentication');
    return null;
  }

  const payload = await body(res);
  const code = errorCode(payload);

  if (res.status >= 500) {
    check(`${label} — ${res.status}`, false, code ?? 'no typed error code');
    return null;
  }
  // A 4xx here is legitimate only when it carries the typed contract; an untyped one is a bug,
  // because a client cannot tell a bad request from an outage.
  if (res.status >= 400 && code === null) {
    check(`${label} — typed error`, false, `HTTP ${res.status} with no error.code`);
    return null;
  }
  if (res.status < 400) {
    check(`${label} — ${res.status}`, true, code === null ? '' : `typed ${code}`);
    const cacheControl = res.headers.get('cache-control') ?? '';
    check(`${label} — cache-control: no-store`, cacheControl.includes('no-store'), cacheControl || '(absent)');
  } else {
    note(label, `HTTP ${res.status} ${code ?? ''}`);
  }
  return payload;
}

/** A malformed call must come back with a typed code, not a stack. */
async function rejectsTyped(label: string, path: string, init?: RequestInit): Promise<void> {
  const { res, protectedBy } = await attempt(path, init);
  if (protectedBy !== null) {
    unverifiable(label, 'the deployment is behind Vercel authentication');
    return;
  }
  const code = errorCode(await body(res));
  check(`rejects ${label}`, res.status === 400 && code !== null, `HTTP ${res.status} ${code ?? '(untyped)'}`);
}

async function main(): Promise<void> {
  if (BASE.length === 0) {
    console.error('INDEXER_BASE_URL is required, e.g. https://ethonline-2026-indexer.vercel.app');
    process.exit(2);
  }
  console.log(`verifying ${BASE}`);
  if (BYPASS.length === 0) {
    note('protection', 'no VERCEL_AUTOMATION_BYPASS_SECRET set — a protected deployment cannot be verified');
  }

  // ── the deployment is reachable at all ────────────────────────────────────
  const health = await route('GET /api/health', '/api/health');
  if (health === null && inconclusive > 0) {
    console.log('\nthis deployment is authenticated, so this script cannot speak for it.');
    process.exit(2);
  }

  if (!CACHE_ONLY) {
    const pools = await route('GET /api/pools', '/api/pools?limit=5');
    const list = Array.isArray(pools?.['pools']) ? (pools['pools'] as Record<string, unknown>[]) : [];
    note('pool universe', `${list.length} pools`);

    const poolId = typeof list[0]?.['poolId'] === 'string' ? (list[0]['poolId'] as string) : null;
    if (poolId === null) {
      unverifiable('pool-scoped routes', 'no pool holds metrics, so there is nothing to scope to');
    } else {
      await route('GET /api/metrics', `/api/metrics?poolId=${encodeURIComponent(poolId)}&metric=apy&days=7`);
      await route('GET /api/performance', `/api/performance?poolId=${encodeURIComponent(poolId)}&days=30`);
      await route('GET /api/forecast', `/api/forecast?poolId=${encodeURIComponent(poolId)}&days=7`);
    }

    await route('POST /api/search', '/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'yield', limit: 3 }),
    });
    await route('GET /api/risk/chains', '/api/risk/chains');
    await route('GET /api/risk/protocols', '/api/risk/protocols');
    await route('GET /api/risk/adjustment', '/api/risk/adjustment?chain=base&protocol=aave-v3');
    await route('POST /api/agent', '/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // `dry` skips the LLM nodes, so this exercises the whole graph without model spend. The
      // non-dry path is a deliberate, separately-run check.
      body: JSON.stringify({ query: 'is the surface reachable?', mode: 'v01', dry: true }),
    });
    await route('GET /api/model-status', '/api/model-status?hours=24');

    // ── the contract, not just the happy path ───────────────────────────────
    await rejectsTyped('a metrics call with no pool', '/api/metrics?metric=apy');
    await rejectsTyped('a metrics call with an unknown metric', `/api/metrics?poolId=${poolId ?? 'x'}&metric=nope`);
    await rejectsTyped('a forecast beyond the horizon cap', `/api/forecast?poolId=${poolId ?? 'x'}&horizon=99999`);

    // The refresh route is machine-called and must never be open. Asserted without the secret,
    // because an unauthenticated 200 here would let anyone write probe rows.
    const probe = await attempt('/api/cron/probe', { method: 'POST' });
    if (probe.protectedBy !== null) {
      unverifiable('POST /api/cron/probe', 'the deployment is behind Vercel authentication');
    } else {
      const code = errorCode(await body(probe.res));
      check('POST /api/cron/probe refuses an unauthenticated caller', probe.res.status === 401, `HTTP ${probe.res.status} ${code ?? '(untyped)'}`);
    }
  }

  // ── the cache: the assertions that catch a stalled cron ───────────────────
  console.log('\n[cache]');
  const manifest = await route('GET /api/cache/manifest', '/api/cache/manifest');
  if (manifest === null) {
    check('cache readable', false, 'the manifest endpoint did not answer');
  } else if (manifest['cached'] !== true) {
    note('cache', String(manifest['reading'] ?? 'nothing cached yet'));
  } else {
    const entries = Array.isArray(manifest['entries']) ? (manifest['entries'] as Record<string, unknown>[]) : [];
    check('cache has entries', entries.length > 0, `${entries.length} entries`);

    const malformed = entries.filter(
      (e) =>
        typeof e['fetchedAt'] !== 'string' ||
        typeof e['changedAt'] !== 'string' ||
        typeof e['sha256'] !== 'string' ||
        typeof e['bytes'] !== 'number',
    );
    // Without these the console cannot say how stale an entry is or whether it actually changed,
    // which is the entire reason the cache is worth having over just calling the route.
    check('every entry carries a fetch time, a change time, a hash and a size', malformed.length === 0,
      malformed.map((e) => String(e['key'])).join(', '));

    // The load-bearing assumption: a signed URL authorises on its own, so the browser needs no
    // credential to fetch the bytes. If this fails, every pane in the console is blank.
    const first = entries[0];
    if (first !== undefined && typeof first['url'] === 'string') {
      const unsigned = await fetch(first['url'] as string, { method: 'HEAD' });
      check('a signed URL fetches with no other credential', unsigned.ok, `HTTP ${unsigned.status}`);
    }

    // The assertion that catches "the scheduler silently stopped firing", which is by far the
    // likeliest way this breaks in a few weeks — and the only one with no other symptom.
    const newest = entries
      .map((e) => new Date(String(e['fetchedAt'])).getTime())
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => b - a)[0];
    const ageHours = newest === undefined ? Number.POSITIVE_INFINITY : (Date.now() - newest) / 3_600_000;
    const limit = CACHE_INTERVAL_HOURS + CACHE_SLACK_HOURS;
    check(`the cache is fresh (under ${limit}h)`, ageHours <= limit, `${ageHours.toFixed(1)}h old`);

    const failures_ = Array.isArray(manifest['failures']) ? (manifest['failures'] as Record<string, unknown>[]) : [];
    note('partial failures', failures_.map((f) => String(f['key'])).join(', ') || 'none');

    const malformedFailures = failures_.filter(
      (f) => typeof f['key'] !== 'string' || typeof f['error'] !== 'string',
    );
    check('every reported failure names a dependency and a reason', malformedFailures.length === 0,
      malformedFailures.map((f) => String(f['key'])).join(', '));

    // Reported side by side, never compared. The manifest's `failures` are *cache entries*
    // (`health`, `risk/chains`, `model-status`) while health's `degraded` is a list of *dependencies*
    // (`timescaledb`, `risk`). Earlier versions of this block inferred a relationship between the two
    // lists and were wrong both times: first grading a stale cache against a live view, then reading
    // `risk/chains` as "not `risk`, therefore recovered". Different vocabularies, so a reader gets
    // both and decides.
    if (health !== null) {
      const degraded = Array.isArray(health['degraded']) ? (health['degraded'] as unknown[]).map(String) : [];
      note('live health now reports degraded', degraded.join(', ') || 'none');
    }
  }

  const summary = `${failures} failed, ${inconclusive} unverifiable`;
  console.log(`\n${summary}`);
  process.exit(failures > 0 ? 1 : inconclusive > 0 ? 2 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

/**
 * A module, not a global script.
 *
 * A TypeScript file with no import or export is treated as a script and its top-level declarations
 * join the global scope. This repo has two standalone verifiers, so their `main` functions merged
 * into one declaration and `tsc` reported "Duplicate function implementation" for a file that was
 * perfectly correct on its own. The empty export is what makes this a module.
 */
export {};
