import { SubgraphClient } from '../clients/SubgraphClient.js';
import { GraphQLClientTransport } from '../clients/SubgraphTransport.js';
import type { EndpointRef, Env } from '../config/index.js';
import { makeClient, resolveEndpoints } from '../config/index.js';

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
