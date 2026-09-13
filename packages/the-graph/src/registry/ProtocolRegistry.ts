import { SubgraphClient } from '../clients/SubgraphClient.js';
import { GraphQLClientTransport } from '../clients/SubgraphTransport.js';
import type { EndpointRef, Env } from '../config/index.js';
import { getEndpointsByCategory, getEndpointsByProtocol, makeClient, resolveEndpoints } from '../config/index.js';

/**
 * Protocol category types for the fixed income EMS.
 *
 * Re-exported from `config/endpoints.ts`, where the union is defined, so a category
 * added there cannot disagree with the one the registry accepts. The five categories
 * are lending, perpetual, dex, prediction, and liquid-staking — the last being the
 * staking-yield leg a fixed-income mandate allocates to.
 */
export type { ProtocolCategory } from '../config/index.js';
import type { ProtocolCategory } from '../config/index.js';

/**
 * Protocol source resolution — maps a protocol + network to its data source.
 * The EMS resolves "which subgraph do I hit for protocol X on chain Y" here.
 */
export interface ProtocolSource {
  readonly protocol: string;
  readonly network: string;
  readonly category: ProtocolCategory;
  readonly endpoint: EndpointRef;
  readonly client: SubgraphClient;
}

/**
 * Registry of all supported DeFi protocols across categories.
 * Provides protocol → endpoint resolution for the agentic EMS.
 */
export class ProtocolRegistry {
  private readonly clients = new Map<string, SubgraphClient>();

  constructor(
    private readonly env: Env,
    private readonly refs: EndpointRef[],
  ) {}

  static fromEnv(env: Env): ProtocolRegistry {
    return new ProtocolRegistry(env, resolveEndpoints(env));
  }

  /**
   * List all configured endpoint references.
   */
  list(): EndpointRef[] {
    return this.refs;
  }

  /**
   * Get all endpoints for a specific category.
   */
  getByCategory(category: ProtocolCategory): EndpointRef[] {
    return getEndpointsByCategory(this.refs, category);
  }

  /**
   * Get all endpoints for a specific protocol (across networks).
   */
  getByProtocol(protocol: string): EndpointRef[] {
    return getEndpointsByProtocol(this.refs, protocol);
  }

  /**
   * Resolve a specific protocol + network to its data source.
   */
  getSource(protocol: string, network: string): ProtocolSource | null {
    const endpoint = this.refs.find(
      (r) => r.protocol === protocol && r.network === network,
    );
    if (!endpoint) return null;

    return {
      protocol,
      network,
      category: endpoint.category,
      endpoint,
      client: this.getOrCreateClient(endpoint),
    };
  }

  /**
   * Get the first healthy endpoint for a category.
   */
  async getFirstHealthyByCategory(category: ProtocolCategory): Promise<ProtocolSource | null> {
    const endpoints = this.getByCategory(category);
    for (const endpoint of endpoints) {
      try {
        const client = this.getOrCreateClient(endpoint);
        await client.health({ timeoutMs: 8_000 });
        return {
          protocol: endpoint.protocol,
          network: endpoint.network,
          category,
          endpoint,
          client,
        };
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Every source in a category, each with a cached client.
   *
   * One helper rather than one near-identical getter per category: adding the fifth
   * category should be a line, not another eight-line copy to keep in sync.
   */
  private sourcesIn(category: ProtocolCategory): ProtocolSource[] {
    return this.getByCategory(category).map((endpoint) => ({
      protocol: endpoint.protocol,
      network: endpoint.network,
      category,
      endpoint,
      client: this.getOrCreateClient(endpoint),
    }));
  }

  /** Get all lending protocol sources. */
  getLendingProtocols(): ProtocolSource[] {
    return this.sourcesIn('lending');
  }

  /** Get all DEX protocol sources. */
  getDexProtocols(): ProtocolSource[] {
    return this.sourcesIn('dex');
  }

  /** Get all perpetual / F&O protocol sources. */
  getPerpetualProtocols(): ProtocolSource[] {
    return this.sourcesIn('perpetual');
  }

  /** Get all prediction market protocol sources. */
  getPredictionProtocols(): ProtocolSource[] {
    return this.sourcesIn('prediction');
  }

  /**
   * Get all liquid-staking protocol sources.
   *
   * Curated to the protocols the mandate allocates to (Lido, Rocket Pool). The Messari
   * registry carries 25 liquid-staking deployments; the remainder are reachable by name
   * through `SubgraphRegistry.clientFor` rather than probed by `healthReport`.
   */
  getLiquidStakingProtocols(): ProtocolSource[] {
    return this.sourcesIn('liquid-staking');
  }

  /**
   * Health report for all configured endpoints.
   */
  async healthReport(): Promise<
    Array<{ name: string; category: string; protocol: string; network: string; ok: boolean; detail: string }>
  > {
    const report: Array<{
      name: string;
      category: string;
      protocol: string;
      network: string;
      ok: boolean;
      detail: string;
    }> = [];

    for (const ref of this.refs) {
      try {
        const client = this.getOrCreateClient(ref);
        const h = await client.health({ timeoutMs: 8_000 });
        report.push({
          name: ref.name,
          category: ref.category,
          protocol: ref.protocol,
          network: ref.network,
          ok: true,
          detail: `block=${h.blockNumber} indexingErrors=${h.hasIndexingErrors}`,
        });
      } catch (err) {
        report.push({
          name: ref.name,
          category: ref.category,
          protocol: ref.protocol,
          network: ref.network,
          ok: false,
          detail: (err as Error).message,
        });
      }
    }

    return report;
  }

  private getOrCreateClient(endpoint: EndpointRef): SubgraphClient {
    const cached = this.clients.get(endpoint.name);
    if (cached) return cached;

    const client = new SubgraphClient(
      new GraphQLClientTransport(makeClient(endpoint, this.env), endpoint.name),
      endpoint.name,
    );
    this.clients.set(endpoint.name, client);
    return client;
  }
}
