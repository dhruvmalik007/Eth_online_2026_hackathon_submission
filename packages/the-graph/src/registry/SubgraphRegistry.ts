import { SubgraphClient } from '../clients/SubgraphClient.js';
import { GraphQLClientTransport } from '../clients/SubgraphTransport.js';
import type { EndpointRef, Env } from '../config/index.js';
import { makeClient, networkEndpoint, resolveEndpoints } from '../config/index.js';
import { findMessariDeployment, messariNetworksFor } from './messariRegistry.js';

/** How a caller names the data source it wants. */
export interface ClientForOptions {
  /** Messari protocol slug (`aave-v3`), a protocol on a curated endpoint, or an endpoint name. */
  readonly protocol: string;
  /** Chain to disambiguate a multi-chain protocol. Required when a protocol has several. */
  readonly network?: string;
}

/**
 * Registry of endpoint refs -> live SubgraphClient instances.
 * The EMS resolves "which subgraph do I hit for protocol X on chain Y" here,
 * and can fall back across tiers (studio -> network) per SUBGRAPH_SPEC.md §4.
 */
export class SubgraphRegistry {
  private readonly clients = new Map<string, SubgraphClient>();

  constructor(
    private readonly env: Env,
    private readonly refs: EndpointRef[],
  ) {}

  static fromEnv(env: Env): SubgraphRegistry {
    return new SubgraphRegistry(env, resolveEndpoints(env));
  }

  list(): EndpointRef[] {
    return this.refs;
  }

  get(name: string): SubgraphClient {
    const cached = this.clients.get(name);
    if (cached) return cached;

    const ref = this.refs.find((r) => r.name === name);
    if (!ref) {
      const available = this.refs.map((r) => r.name).join(', ') || '(none configured)';
      throw new Error(`Unknown endpoint "${name}". Configured: ${available}`);
    }

    const client = new SubgraphClient(
      new GraphQLClientTransport(makeClient(ref, this.env), ref.name),
      ref.name,
    );
    this.clients.set(name, client);
    return client;
  }

  /**
   * Resolve a data source by protocol, and hand back a live client for it.
   *
   * Resolution order, first match wins:
   *
   *   1. a curated endpoint **name** (so `clientFor('aaveV3Ethereum')` still works),
   *   2. a curated endpoint by **protocol** (+ network),
   *   3. the **Messari registry** by protocol (+ network) — this is what opens up
   *      coverage from the 5 hand-wired endpoints to 197 deployments.
   *
   * A protocol that exists on several chains with no `network` given is reported as
   * ambiguous rather than resolved to the first match. Silently choosing a chain would
   * mean a fixed-income number computed against a chain the caller never named.
   */
  clientFor(target: string | ClientForOptions): SubgraphClient {
    const protocol = typeof target === 'string' ? target : target.protocol;
    const network = typeof target === 'string' ? undefined : target.network;
    const cacheKey = network === undefined ? `protocol:${protocol}` : `protocol:${protocol}:${network}`;

    const cached = this.clients.get(cacheKey);
    if (cached) return cached;

    // An exact curated endpoint name is unambiguous on its own, so it short-circuits.
    let ref: EndpointRef | null = this.refs.find((r) => r.name === protocol) ?? null;

    if (ref === null && network !== undefined) {
      ref =
        this.refs.find((r) => r.protocol === protocol && r.network === network) ??
        this.messariRef(protocol, network);
    } else if (ref === null) {
      /*
       * No network given. Resolve only if the protocol lives on exactly one chain,
       * counting **both** sources — the curated refs and the registry.
       *
       * Checking only the registry was wrong: `clientFor('uniswap-v3')` resolved the
       * curated Ethereum endpoint silently, while the same call against a registry-only
       * protocol was correctly refused. Same promise, two behaviours.
       */
      const chains = this.candidateNetworks(protocol);
      if (chains.length > 1) {
        throw new Error(
          `Protocol "${protocol}" is deployed on ${chains.length} networks (${chains.join(', ')}). ` +
            'Name the network: clientFor({ protocol, network }).',
        );
      }
      const only = chains[0];
      if (only !== undefined) {
        ref =
          this.refs.find((r) => r.protocol === protocol && r.network === only) ??
          this.messariRef(protocol, only);
      }
    }

    if (ref === null) {
      throw new Error(this.explainMiss(protocol, network));
    }

    const client = new SubgraphClient(
      new GraphQLClientTransport(makeClient(ref, this.env), ref.name),
      ref.name,
    );
    this.clients.set(cacheKey, client);
    return client;
  }

  /** Every chain a protocol is known on, across curated refs and the Messari registry. */
  private candidateNetworks(protocol: string): string[] {
    const curated = this.refs
      .filter((ref) => ref.protocol === protocol)
      .map((ref) => ref.network);
    return [...new Set([...curated, ...messariNetworksFor(protocol)])].sort();
  }

  /** Build an endpoint ref from a Messari deployment, or null when it isn't one. */
  private messariRef(protocol: string, network: string | undefined): EndpointRef | null {
    // Every Messari deployment is gateway-hosted and therefore needs the API key.
    if (!this.env.GATEWAY_API_KEY) return null;
    const deployment = findMessariDeployment(protocol, network);
    if (deployment === null) return null;
    return {
      name: `messari:${deployment.protocol}:${deployment.network}`,
      url: networkEndpoint(deployment.queryId),
      tier: 'network',
      requiresAuth: true,
      category: deployment.category,
      protocol: deployment.protocol,
      network: deployment.network,
    };
  }

  /** Say *why* a lookup failed, so the caller can act without reading source. */
  private explainMiss(protocol: string, network: string | undefined): string {
    const networks = messariNetworksFor(protocol);

    /*
     * The registry is local data, so it is readable even with no API key — only
     * *building the client* needs the key. Reporting a chain mismatch for a protocol
     * that is present, on the chain that was asked for, would send the caller looking
     * for a typo that isn't there.
     */
    if (networks.length > 0) {
      if (network !== undefined && !networks.includes(network)) {
        return `Protocol "${protocol}" has no deployment on network "${network}", but does on: ${networks.join(', ')}.`;
      }
      if (network === undefined && networks.length > 1) {
        return (
          `Protocol "${protocol}" is deployed on ${networks.length} networks (${networks.join(', ')}). ` +
          'Name the network: clientFor({ protocol, network }).'
        );
      }
      return (
        `Protocol "${protocol}" is registered on ${network ?? networks[0]}, but GATEWAY_API_KEY is not set, ` +
        'so its gateway endpoint cannot be built.'
      );
    }

    const curated = this.refs.map((r) => r.name).join(', ') || '(none configured)';
    if (!this.env.GATEWAY_API_KEY) {
      return (
        `Unknown protocol "${protocol}". Not in the Messari registry nor among the curated endpoints ` +
        `(${curated}). GATEWAY_API_KEY is also unset, so a gateway lookup was not possible.`
      );
    }
    return `Unknown protocol "${protocol}". Not in the Messari registry nor among the curated endpoints (${curated}).`;
  }

  /** First endpoint that answers health successfully, in ref order. */
  async firstHealthy(): Promise<SubgraphClient> {
    const errors: string[] = [];
    for (const ref of this.refs) {
      try {
        const client = this.get(ref.name);
        await client.health({ timeoutMs: 8_000 });
        return client;
      } catch (err) {
        errors.push(`${ref.name}: ${(err as Error).message}`);
      }
    }
    throw new Error(`No healthy subgraph endpoint.\n${errors.join('\n')}`);
  }

  /** Sequential health report; never throws. */
  async healthReport(): Promise<Array<{ name: string; tier: string; ok: boolean; detail: string }>> {
    const report: Array<{ name: string; tier: string; ok: boolean; detail: string }> = [];
    for (const ref of this.refs) {
      try {
        const h = await this.get(ref.name).health({ timeoutMs: 8_000 });
        report.push({
          name: ref.name,
          tier: ref.tier,
          ok: true,
          detail: `block=${h.blockNumber} indexingErrors=${h.hasIndexingErrors}`,
        });
      } catch (err) {
        report.push({ name: ref.name, tier: ref.tier, ok: false, detail: (err as Error).message });
      }
    }
    return report;
  }
}
