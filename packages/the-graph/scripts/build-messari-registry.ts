#!/usr/bin/env tsx
/**
 * Regenerate `src/registry/messari-deployments.json` from Messari's own registry.
 *
 *   pnpm --filter @ethonline2026/graph-fno-indexer registry:messari
 *
 * ## Why this is a script and not a hand-written file
 *
 * Messari publishes 480 deployments across 256 protocols. Transcribing subgraph IDs
 * by hand is how a registry rots silently — a typo yields a 404 at query time, which
 * looks like an indexing outage rather than a bad constant. Generating the file makes
 * every ID traceable to one fetch of one URL, and re-running is the update path.
 *
 * ## The filter that matters
 *
 * Only deployments carrying `services.decentralized-network.query-id` are kept.
 * Messari's `services.hosted-service` entries point at The Graph's hosted service,
 * which was **shut down**, so a hosted-only entry is a dead endpoint. `morpho-blue`
 * is the worked example: it is a productive name to look for, and it has no
 * decentralized-network ID at all, so it is excluded rather than included broken.
 *
 * Liveness is not assumed from presence either — `scripts/messari-probe.ts` is the
 * gate that actually calls each endpoint.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Where Messari keeps the source of truth for its standardized subgraphs. */
const UPSTREAM =
  'https://raw.githubusercontent.com/messari/subgraphs/master/deployment/deployment.json';

const OUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'registry',
  'messari-deployments.json',
);

/**
 * Messari schema → this package's category.
 *
 * Messari's vocabulary and ours differ, and the mapping is not one-to-one: options
 * and perpetual futures are both F&O, and both land in our `perpetual` category,
 * which is the F&O slot the EMS consumes.
 */
const SCHEMA_TO_CATEGORY: Readonly<Record<string, string>> = {
  lending: 'lending',
  'dex-amm': 'dex',
  'derivatives-perpfutures': 'perpetual',
  'derivatives-options': 'perpetual',
};

/**
 * The liquid-staking protocol set.
 *
 * Messari files every liquid-staking protocol under its **`generic`** schema, which
 * is a catch-all also used by bridges and NFT projects — so the schema alone cannot
 * identify the category and an explicit allowlist is required. Keeping it explicit
 * and auditable is the point: a new LSD protocol is a deliberate addition here, not a
 * silent widening of what `generic` means.
 *
 * These are the LSD protocols Messari carries that have a usable network deployment.
 */
const LIQUID_STAKING_PROTOCOLS: readonly string[] = [
  'benqi-staked-avax',
  'binance-staked-eth',
  'coinbase-wrapped-staked-eth',
  'creth2',
  'eigenlayer',
  'eigenpie',
  'frax-ether-staking',
  'lido',
  'mantle-staked-eth',
  'prime-staked-eth',
  'rocket-pool',
  'stader',
  'stake-link-liquid',
  'stakestone',
  'stakewise-v2',
  'swell-liquid-staking',
  'yieldyak-staked-avax',
];

/** Schemas we deliberately do not carry, and why. Recorded so the omission is auditable. */
const EXCLUDED_SCHEMAS: Readonly<Record<string, string>> = {
  bridge: 'Not a fixed-income category.',
  governance: 'Governance data has no role in a fixed-income mandate.',
  'nft-marketplace': 'Not a fixed-income category.',
  'yield-aggregator': 'Yield routing, not a direct yield source the mandate allocates to.',
  erc20: 'Bare token metadata; no protocol or yield surface.',
  erc721: 'Bare NFT metadata; no protocol or yield surface.',
};

interface UpstreamDeployment {
  readonly network?: string;
  readonly status?: string;
  readonly versions?: Readonly<Record<string, string>>;
  readonly services?: Readonly<Record<string, { readonly 'query-id'?: string }>>;
}

interface UpstreamProtocol {
  readonly schema?: string;
  readonly protocol?: string;
  readonly project?: string;
  readonly deployments?: Readonly<Record<string, UpstreamDeployment>>;
}

interface RegistryEntry {
  readonly protocol: string;
  readonly category: string;
  readonly messariSchema: string;
  readonly network: string;
  readonly queryId: string;
  readonly status: string | null;
  readonly versions: Readonly<Record<string, string>>;
}

async function main(): Promise<void> {
  const response = await fetch(UPSTREAM, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`Messari registry fetch failed: ${response.status} ${response.statusText}`);
  }
  const upstream = (await response.json()) as Record<string, UpstreamProtocol>;

  const entries: RegistryEntry[] = [];
  let upstreamDeployments = 0;
  let hostedOnly = 0;
  let excludedBySchema = 0;
  let excludedByAllowlist = 0;

  for (const protocol of Object.keys(upstream).sort()) {
    const record = upstream[protocol];
    if (record === undefined) continue;
    const schema = record.schema ?? 'unknown';

    for (const deploymentKey of Object.keys(record.deployments ?? {}).sort()) {
      const deployment = record.deployments?.[deploymentKey];
      if (deployment === undefined) continue;
      upstreamDeployments += 1;

      const queryId = deployment.services?.['decentralized-network']?.['query-id'];
      if (queryId === undefined || queryId.length === 0) {
        hostedOnly += 1;
        continue;
      }

      let category = SCHEMA_TO_CATEGORY[schema];
      if (category === undefined) {
        if (schema === 'generic') {
          if (!LIQUID_STAKING_PROTOCOLS.includes(protocol)) {
            excludedByAllowlist += 1;
            continue;
          }
          category = 'liquid-staking';
        } else {
          excludedBySchema += 1;
          continue;
        }
      }

      entries.push({
        protocol,
        category,
        messariSchema: schema,
        network: deployment.network ?? 'unknown',
        queryId,
        status: deployment.status ?? null,
        versions: { ...(deployment.versions ?? {}) },
      });
    }
  }

  entries.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.protocol.localeCompare(b.protocol) ||
      a.network.localeCompare(b.network),
  );

  const byCategory: Record<string, number> = {};
  for (const entry of entries) {
    byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
  }

  const document = {
    $schema: 'internal://messari-deployments/v1',
    source: {
      url: UPSTREAM,
      repository: 'https://github.com/messari/subgraphs',
      generator: 'scripts/build-messari-registry.ts',
      verifiedAt: new Date().toISOString().slice(0, 10),
      rule:
        'Only deployments carrying services.decentralized-network.query-id. ' +
        "Messari's hosted-service endpoints died with The Graph hosted-service shutdown.",
      upstreamProtocols: Object.keys(upstream).length,
      upstreamDeployments,
      retained: entries.length,
      droppedHostedOnly: hostedOnly,
      droppedBySchemaExclusion: excludedBySchema,
      droppedByLiquidStakingAllowlist: excludedByAllowlist,
      excludedSchemas: EXCLUDED_SCHEMAS,
      liquidStakingProtocols: LIQUID_STAKING_PROTOCOLS,
      categories: byCategory,
    },
    deployments: entries,
  };

  writeFileSync(OUT_PATH, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  process.stdout.write(`wrote ${path.relative(process.cwd(), OUT_PATH)}\n`);
  process.stdout.write(`  protocols upstream     ${Object.keys(upstream).length}\n`);
  process.stdout.write(`  deployments upstream   ${upstreamDeployments}\n`);
  process.stdout.write(`  retained               ${entries.length}\n`);
  process.stdout.write(`  dropped (hosted-only)  ${hostedOnly}\n`);
  process.stdout.write(`  dropped (schema)       ${excludedBySchema}\n`);
  process.stdout.write(`  dropped (not an LSD)   ${excludedByAllowlist}\n`);
  for (const [category, count] of Object.entries(byCategory).sort()) {
    process.stdout.write(`    ${category.padEnd(16)} ${count}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`registry build failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
