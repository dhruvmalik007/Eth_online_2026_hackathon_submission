/**
 * Guards for the Messari registry, `clientFor` resolution, and the core query catalog.
 *
 * All offline. `clientFor` only *constructs* a client, so resolution can be tested
 * without a socket — which matters, because the rules worth pinning are the ones about
 * what resolution refuses to do (guess a chain, invent a URL), not what the network
 * returns. Liveness is `scripts/messari-probe.ts`'s job, and its verdict is asserted
 * here from the recorded artifact rather than by re-probing.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env.js';
import { SubgraphRegistry } from '../src/registry/SubgraphRegistry.js';
import {
  MESSARI_CATEGORIES,
  MessariDeploymentSchema,
  findMessariDeployment,
  listMessariDeployments,
  listMessariProtocols,
  messariNetworksFor,
  messariRegistry,
} from '../src/registry/messariRegistry.js';
import {
  messariProbe,
  messariProtocolFinancials,
  messariProtocols,
  messariProtocolPools,
  messariProtocolUsage,
  messariTokens,
} from '../src/queries/messari/protocolCore.js';

/**
 * The core `Protocol` fields the gate must exercise.
 *
 * Listed here rather than imported so this stays an independent statement of what the
 * core selection is: if someone trims a field out of the query, this test should notice
 * instead of following the change.
 */
const CORE_PROTOCOL_FIELDS = [
  'id',
  'name',
  'network',
  'type',
  'totalValueLockedUSD',
  'cumulativeTotalRevenueUSD',
  'cumulativeSupplySideRevenueUSD',
  'cumulativeProtocolSideRevenueUSD',
  'totalPoolCount',
] as const;

/** A minimal env: enough for `resolveEndpoints` to build the gateway-backed refs. */
function fakeEnv(withKey = true): Env {
  return {
    GATEWAY_API_KEY: withKey ? 'test-gateway-key' : '',
  } as unknown as Env;
}

describe('Messari deployment registry', () => {
  it('parses and validates every entry', () => {
    // The module already parses at load; re-validating keeps this a real assertion if
    // the load-time parse is ever relaxed.
    for (const deployment of messariRegistry.deployments) {
      expect(() => MessariDeploymentSchema.parse(deployment)).not.toThrow();
    }
    expect(messariRegistry.deployments.length).toBeGreaterThan(100);
  });

  it('retains only entries that have a gateway subgraph id', () => {
    for (const deployment of messariRegistry.deployments) {
      // A hosted-service-only entry would be a dead endpoint shipped as though it worked.
      expect(deployment.queryId.length, `${deployment.protocol}/${deployment.network}`).toBeGreaterThan(0);
      expect(deployment.protocol.length).toBeGreaterThan(0);
      expect(deployment.network.length).toBeGreaterThan(0);
    }
  });

  it('carries provenance, including the rule that dropped unusable entries', () => {
    const source = messariRegistry.source;
    expect(source.url).toContain('messari/subgraphs');
    expect(source.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(source.rule).toContain('decentralized-network');
    // The generator must have actually dropped something, or the rule did nothing.
    expect(source.droppedHostedOnly).toBeGreaterThan(0);
    expect(source.retained).toBe(messariRegistry.deployments.length);
  });

  it('labels every entry with one of the four Messari-backed categories', () => {
    for (const deployment of messariRegistry.deployments) {
      expect(MESSARI_CATEGORIES).toContain(deployment.category);
      // `prediction` is not a Messari schema, so it must never appear here.
      expect(deployment.category).not.toBe('prediction');
    }
  });

  it('covers all five fixed-income categories once prediction is included', () => {
    // Four from Messari; prediction comes from Polymarket's own deployment.
    const covered = new Set<string>([...MESSARI_CATEGORIES, 'prediction']);
    expect([...covered].sort()).toEqual([
      'dex',
      'lending',
      'liquid-staking',
      'perpetual',
      'prediction',
    ]);
  });

  it('has liquid-staking coverage, which is the category this package was missing', () => {
    const lsd = listMessariProtocols('liquid-staking');
    expect(lsd).toContain('lido');
    expect(lsd).toContain('rocket-pool');
    expect(lsd.length).toBeGreaterThan(5);
  });

  it('filters by category consistently', () => {
    const all = listMessariDeployments();
    for (const category of MESSARI_CATEGORIES) {
      const filtered = listMessariDeployments(category);
      expect(filtered.every((d) => d.category === category)).toBe(true);
    }
    const sum = MESSARI_CATEGORIES.reduce((n, c) => n + listMessariDeployments(c).length, 0);
    expect(sum).toBe(all.length);
  });

  it('resolves a protocol+network exactly', () => {
    const found = findMessariDeployment('lido', 'ethereum');
    expect(found).not.toBeNull();
    expect(found?.queryId.length ?? 0).toBeGreaterThan(0);
  });

  it('refuses to guess when a protocol spans several chains', () => {
    // Picking one would mean a fixed-income number computed against an unnamed chain.
    expect(findMessariDeployment('uniswap-v3')).toBeNull();
    expect(messariNetworksFor('uniswap-v3').length).toBeGreaterThan(1);
  });

  it('returns null for a protocol it does not carry', () => {
    expect(findMessariDeployment('not-a-real-protocol', 'ethereum')).toBeNull();
    expect(messariNetworksFor('not-a-real-protocol')).toEqual([]);
  });

  it('omits morpho-blue, which has no gateway deployment', () => {
    // A well-known protocol that is absent because Messari's record for it is
    // hosted-service-only. Included as a guard so a future regeneration that silently
    // starts returning a dead ID for it is caught.
    expect(findMessariDeployment('morpho-blue', 'ethereum')).toBeNull();
  });
});

describe('SubgraphRegistry.clientFor', () => {
  it('resolves a curated endpoint by name', () => {
    const registry = SubgraphRegistry.fromEnv(fakeEnv());
    expect(registry.clientFor('aaveV3Ethereum')).toBeDefined();
  });

  it('resolves a Messari protocol on a named network', () => {
    const registry = SubgraphRegistry.fromEnv(fakeEnv());
    const client = registry.clientFor({ protocol: 'lido', network: 'ethereum' });
    expect(client).toBeDefined();
    // Caching: the same lookup must not build a second client.
    expect(registry.clientFor({ protocol: 'lido', network: 'ethereum' })).toBe(client);
  });

  it('caches per network, so two chains are two clients', () => {
    const registry = SubgraphRegistry.fromEnv(fakeEnv());
    const eth = registry.clientFor({ protocol: 'uniswap-v3', network: 'ethereum' });
    const arb = registry.clientFor({ protocol: 'uniswap-v3', network: 'arbitrum' });
    expect(eth).not.toBe(arb);
  });

  it('explains an ambiguous protocol instead of resolving it', () => {
    const registry = SubgraphRegistry.fromEnv(fakeEnv());
    expect(() => registry.clientFor('uniswap-v3')).toThrow(/deployed on \d+ networks/i);
  });

  it('names the known networks when the requested one is wrong', () => {
    const registry = SubgraphRegistry.fromEnv(fakeEnv());
    expect(() => registry.clientFor({ protocol: 'lido', network: 'solana' })).toThrow(
      /has no deployment on network "solana"/,
    );
  });

  it('says the API key is missing when the registry could not be consulted', () => {
    const registry = SubgraphRegistry.fromEnv(fakeEnv(false));
    // Without a key the Messari registry is unreachable, and the message must say so
    // rather than implying the protocol does not exist.
    expect(() => registry.clientFor({ protocol: 'lido', network: 'ethereum' })).toThrow(
      /GATEWAY_API_KEY is not set/,
    );
  });

  it('lists the curated endpoints for a genuinely unknown protocol', () => {
    const registry = SubgraphRegistry.fromEnv(fakeEnv());
    expect(() => registry.clientFor('definitely-not-a-protocol')).toThrow(/Unknown protocol/);
  });
});

describe('Messari core queries', () => {
  const queries = [
    messariProtocols,
    messariProtocolFinancials,
    messariProtocolUsage,
    messariProtocolPools,
    messariTokens,
    messariProbe,
  ];

  it('has unique ids and operation names', () => {
    expect(new Set(queries.map((q) => q.id)).size).toBe(queries.length);
    expect(new Set(queries.map((q) => q.operationName)).size).toBe(queries.length);
  });

  it('namespaces every id under the-graph.messari', () => {
    for (const query of queries) {
      expect(query.id.startsWith('the-graph.messari.')).toBe(true);
    }
  });

  it('never interpolates a value into SDL', () => {
    for (const query of queries) {
      expect(query.sdl.includes('${'), query.id).toBe(false);
    }
  });

  it('selects only fields the standard schemas expose', () => {
    // `slug` is the specific trap: Aave's deployment has no `Protocol.slug`, so
    // selecting it turned a working deployment into a request-level error.
    for (const query of queries) {
      expect(query.sdl.includes('slug'), `${query.id} selects slug`).toBe(false);
    }
  });

  it('makes the probe select the same core fields as the data query', () => {
    // The gate is only meaningful if it tests what a caller will run.
    for (const field of CORE_PROTOCOL_FIELDS) {
      expect(messariProbe.sdl, `probe is missing ${field}`).toContain(field);
      expect(messariProtocols.sdl, `protocols is missing ${field}`).toContain(field);
    }
  });

  it('declares a variables schema key for every variable used', () => {
    for (const query of queries) {
      const declared = new Set(
        [...query.sdl.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)]
          .map((match) => match[1])
          .filter((name): name is string => typeof name === 'string'),
      );
      const keys = new Set(Object.keys((query.variables as { shape?: object }).shape ?? {}));
      for (const name of declared) {
        expect(keys.has(name), `${query.id} uses $${name} with no schema key`).toBe(true);
      }
    }
  });
});

describe('recorded liveness verdict', () => {
  const livenessPath = path.join(import.meta.dirname, '..', 'src', 'registry', 'messari-liveness.json');
  const liveness = JSON.parse(readFileSync(livenessPath, 'utf8')) as {
    verifiedAt: string;
    counts: { total: number; standard: number; partial: number; dead: number };
    byCategory: Record<string, { standard: number; partial: number; dead: number }>;
    standard: { protocol: string; network: string; category: string }[];
    partial: { protocol: string; network: string; category: string }[];
    dead: { protocol: string; network: string; category: string }[];
  };

  it('accounts for every probed endpoint exactly once', () => {
    const { total, standard, partial, dead } = liveness.counts;
    expect(standard + partial + dead).toBe(total);
    expect(liveness.standard.length + liveness.partial.length + liveness.dead.length).toBe(total);
  });

  it('agrees with its own per-category breakdown', () => {
    const sum = (key: 'standard' | 'partial' | 'dead'): number =>
      Object.values(liveness.byCategory).reduce((n, bucket) => n + bucket[key], 0);
    expect(sum('standard')).toBe(liveness.counts.standard);
    expect(sum('partial')).toBe(liveness.counts.partial);
    expect(sum('dead')).toBe(liveness.counts.dead);
  });

  it('records a date and a non-empty verdict set', () => {
    expect(liveness.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(liveness.counts.total).toBeGreaterThan(0);
    // If this ever hits zero the gate has stopped probing anything, which is a
    // silent failure worth failing loudly on.
    expect(liveness.counts.standard).toBeGreaterThan(0);
  });

  it('verified live coverage in all five categories', () => {
    const verified = new Set([
      ...liveness.standard.map((r) => r.category),
      ...liveness.partial.map((r) => r.category),
    ]);
    expect([...verified].sort()).toEqual([
      'dex',
      'lending',
      'liquid-staking',
      'perpetual',
      'prediction',
    ]);
  });

  it('covers liquid staking with live endpoints, since that category is new', () => {
    const lsd = liveness.standard.filter((r) => r.category === 'liquid-staking');
    expect(lsd.map((r) => r.protocol)).toContain('lido');
    expect(lsd.map((r) => r.protocol)).toContain('rocket-pool');
  });
});
