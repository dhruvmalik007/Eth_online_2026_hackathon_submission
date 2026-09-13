#!/usr/bin/env tsx
/**
 * messari-probe — the live gate over the Messari deployment registry.
 *
 *   pnpm --filter @ethonline2026/graph-fno-indexer probe:messari
 *   … probe:messari -- --category liquid-staking
 *   … probe:messari -- --limit 20 --json
 *
 * ## What it decides, and why presence is not enough
 *
 * A registry entry proves a subgraph ID *exists*. It proves nothing about whether the
 * endpoint answers, or whether the deployment implements the Messari standard — and
 * those are two different failures:
 *
 *   - **standard** — answered, and `protocols` resolved. Safe for the Messari core
 *     queries.
 *   - **partial** — answered `_meta` but the core query failed on a schema difference.
 *     It is *alive* and *not* usable with the core queries as written. Two distinct
 *     causes, and the detail line carries whichever applies: a native schema
 *     (`uniswap-v3` has no `protocols` field at all) or an older Messari schema
 *     (Aave's 3.1.0 deployment lacks `Protocol.slug`).
 *   - **dead** — no valid answer. A broken ID, a revoked deployment, or an outage.
 *
 * The gate fails on `dead` only. Failing on `partial` would make the gate permanently
 * red for deployments working exactly as their authors intended, which trains people to
 * ignore it. `partial` is reported loudly instead, because it is the fact a caller needs
 * before choosing a query.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadEnv } from '../src/config/env.js';
import type { SubgraphClient } from '../src/clients/SubgraphClient.js';
import { SubgraphRegistry } from '../src/registry/SubgraphRegistry.js';
import { listMessariDeployments } from '../src/registry/messariRegistry.js';
import { messariProbe } from '../src/queries/messari/protocolCore.js';

const LIVENESS_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'registry',
  'messari-liveness.json',
);

type Status = 'standard' | 'partial' | 'dead';

interface Result {
  readonly name: string;
  readonly protocol: string;
  readonly network: string;
  readonly category: string;
  readonly status: Status;
  readonly detail: string;
}

const PROBE_TIMEOUT_MS = 25_000;
const CONCURRENCY = 8;

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

/**
 * Run the Messari core query through one client and classify the outcome.
 *
 * Never throws. Shared by the curated and Messari passes so both are judged by the
 * *same* test — otherwise a curated endpoint that only passed a `_meta` health check
 * would be reported alongside one that proved it can run the core queries, and the two
 * are not comparable.
 */
async function classifyCore(
  client: SubgraphClient,
  base: Omit<Result, 'status' | 'detail'>,
): Promise<Result> {
  try {
    const response = await client.executeTemplate(messariProbe, {}, { timeoutMs: PROBE_TIMEOUT_MS });
    const protocol = response.protocols[0];
    return {
      ...base,
      status: 'standard',
      detail:
        `block=${response._meta.block.number} protocol=${protocol?.id ?? '?'} ` +
        `indexingErrors=${response._meta.hasIndexingErrors}`,
    };
  } catch (error) {
    const message = (error as Error).message;

    /*
     * A GraphQL field error is proof the endpoint answered — the server told us which
     * field it does not have. That is a schema difference, not an outage, so it needs
     * no second call to distinguish. Anything else (timeout, 5xx, "no allocations",
     * auth) is a real failure and must not be excused as a schema difference.
     */
    const isFieldError = /has no field|Cannot query field|Unknown argument/i.test(message);
    if (isFieldError) {
      return {
        ...base,
        status: 'partial',
        detail: `answered, but the Messari core query did not resolve: ${message.slice(0, 150)}`,
      };
    }
    return { ...base, status: 'dead', detail: message.slice(0, 160) };
  }
}

/** Probe one Messari registry entry, resolving its client by protocol. */
async function probeMessari(
  registry: SubgraphRegistry,
  entry: { protocol: string; network: string; category: string },
): Promise<Result> {
  const base = {
    name: `messari:${entry.protocol}:${entry.network}`,
    protocol: entry.protocol,
    network: entry.network,
    category: entry.category,
  };

  let client: SubgraphClient;
  try {
    client = registry.clientFor({ protocol: entry.protocol, network: entry.network });
  } catch (error) {
    return { ...base, status: 'dead', detail: `unresolvable: ${(error as Error).message.slice(0, 120)}` };
  }
  return classifyCore(client, base);
}

/**
 * Probe the hand-curated endpoints.
 *
 * These are judged by the Messari core query too, except for `prediction` — Polymarket
 * publishes its own schema and is not a Messari deployment, so `_meta` is the only
 * meaningful check there.
 *
 * The result is informative rather than a formality: the curated `aaveV3Ethereum` and
 * `uniswapV3` endpoints both *fail* the core query, which is the concrete answer to
 * "can the existing curated endpoints serve the Messari core?" — they cannot.
 */
async function probeCurated(registry: SubgraphRegistry): Promise<Result[]> {
  const results: Result[] = [];
  for (const ref of registry.list()) {
    const base = {
      name: ref.name,
      protocol: ref.protocol,
      network: ref.network,
      category: ref.category,
    };

    if (ref.category === 'prediction') {
      try {
        const health = await registry.get(ref.name).health({ timeoutMs: PROBE_TIMEOUT_MS });
        results.push({
          ...base,
          status: 'standard',
          detail: `block=${health.blockNumber} indexingErrors=${health.hasIndexingErrors} (own schema, not Messari)`,
        });
      } catch (error) {
        results.push({ ...base, status: 'dead', detail: (error as Error).message.slice(0, 160) });
      }
      continue;
    }

    results.push(await classifyCore(registry.get(ref.name), base));
  }
  return results;
}

/** Run `worker` over `items` with a bounded number in flight. */
async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      out[index] = await worker(item);
    }
  });
  await Promise.all(runners);
  return out;
}

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json');
  const category = flag('category');
  const limitRaw = flag('limit');
  const limit = limitRaw === undefined ? undefined : Number.parseInt(limitRaw, 10);

  const env = loadEnv();
  if (!env.GATEWAY_API_KEY) {
    process.stderr.write('GATEWAY_API_KEY is not set — every Messari endpoint requires it.\n');
    process.exitCode = 2;
    return;
  }

  const registry = SubgraphRegistry.fromEnv(env);

  let entries = listMessariDeployments().map((deployment) => ({
    protocol: deployment.protocol,
    network: deployment.network,
    category: deployment.category,
  }));
  if (category !== undefined) {
    entries = entries.filter((entry) => entry.category === category);
  }
  if (limit !== undefined && Number.isFinite(limit)) {
    entries = entries.slice(0, limit);
  }

  if (!asJson) {
    process.stdout.write(
      `probing ${entries.length} Messari deployment(s)` +
        `${category === undefined ? '' : ` in ${category}`} + ${registry.list().length} curated…\n\n`,
    );
  }

  const curated = await probeCurated(registry);
  const messari = await mapLimited(entries, CONCURRENCY, (entry) => probeMessari(registry, entry));
  const all = [...curated, ...messari];

  const standard = all.filter((r) => r.status === 'standard');
  const partial = all.filter((r) => r.status === 'partial');
  const dead = all.filter((r) => r.status === 'dead');

  const byCategory = new Map<string, { standard: number; partial: number; dead: number }>();
  for (const result of all) {
    const bucket = byCategory.get(result.category) ?? { standard: 0, partial: 0, dead: 0 };
    bucket[result.status] += 1;
    byCategory.set(result.category, bucket);
  }

  /*
   * Record the outcome. A registry entry that exists but cannot be queried is the
   * failure mode this whole script exists to catch — Messari's IDs go stale when an
   * indexer drops its allocation, and the JSON is identical either way. Writing the
   * verdict down is what stops a caller treating a dead ID as a live one.
   */
  if (process.argv.includes('--write')) {
    const liveness = {
      $schema: 'internal://messari-liveness/v1',
      probe: 'scripts/messari-probe.ts',
      verifiedAt: new Date().toISOString().slice(0, 10),
      note:
        'Result of probing every registry entry. `standard` means the endpoint answered AND ' +
        'implemented the Messari core; `partial` means it answered but the core query hit a ' +
        'schema difference (native schema, or an older Messari version); `dead` means it did ' +
        'not answer and must not be used.',
      counts: {
        total: all.length,
        standard: standard.length,
        partial: partial.length,
        dead: dead.length,
      },
      byCategory: Object.fromEntries([...byCategory].sort()),
      standard: standard.map((r) => ({ protocol: r.protocol, network: r.network, category: r.category, detail: r.detail })),
      partial: partial.map((r) => ({ protocol: r.protocol, network: r.network, category: r.category, detail: r.detail })),
      dead: dead.map((r) => ({ protocol: r.protocol, network: r.network, category: r.category, detail: r.detail })),
    };
    writeFileSync(LIVENESS_PATH, `${JSON.stringify(liveness, null, 2)}\n`, 'utf8');
    if (!asJson) {
      process.stdout.write(`\nwrote ${path.relative(process.cwd(), LIVENESS_PATH)}\n`);
    }
  }

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: dead.length === 0,
          counts: { total: all.length, standard: standard.length, partial: partial.length, dead: dead.length },
          byCategory: Object.fromEntries([...byCategory].sort()),
          results: all,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    if (partial.length > 0) {
      process.stdout.write('PARTIAL (alive, but the Messari core query did not resolve):\n');
      for (const result of partial) {
        process.stdout.write(`  ~ ${result.protocol}/${result.network} [${result.category}]\n      ${result.detail}\n`);
      }
      process.stdout.write('\n');
    }
    if (dead.length > 0) {
      process.stdout.write('DEAD:\n');
      for (const result of dead) {
        process.stdout.write(`  ✗ ${result.name} — ${result.detail}\n`);
      }
      process.stdout.write('\n');
    }

    process.stdout.write('by category:\n');
    for (const [name, counts] of [...byCategory].sort()) {
      process.stdout.write(
        `  ${name.padEnd(16)} standard=${String(counts.standard).padStart(3)}  partial=${String(counts.partial).padStart(3)}  dead=${String(counts.dead).padStart(3)}\n`,
      );
    }
    process.stdout.write(
      `\n  total=${all.length}  standard=${standard.length}  partial=${partial.length}  dead=${dead.length}\n`,
    );
    process.stdout.write(
      dead.length === 0
        ? '\nOK — every probed endpoint answered.\n'
        : `\nFAIL — ${dead.length} endpoint(s) did not answer.\n`,
    );
  }

  if (dead.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`probe failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
