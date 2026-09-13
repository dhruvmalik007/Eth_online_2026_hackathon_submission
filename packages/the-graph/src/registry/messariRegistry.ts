/**
 * Messari standardized-subgraph deployment registry.
 *
 * ## What this is
 *
 * Messari publishes one deployment record per protocol × network for its
 * standardized subgraphs. That file is the source of truth for *which* subgraph
 * backs a given protocol on a given chain, which is a different question from
 * *which endpoints this package happens to have wired by hand* — the curated
 * `KNOWN_DEPLOYMENTS` list covers five endpoints; this covers 197.
 *
 * ## Why the data is a generated JSON file
 *
 * 197 subgraph IDs is past the point where transcription is safe: a single wrong
 * character yields a 404 that looks like an indexing outage. The file is produced by
 * `scripts/build-messari-registry.ts`, so every ID traces to one fetch of one URL and
 * regeneration is the update path.
 *
 * ## Only network-tier deployments are present
 *
 * The generator drops any deployment without
 * `services.decentralized-network.query-id`, because Messari's `hosted-service`
 * endpoints died with The Graph hosted-service shutdown. A hosted-only entry would be
 * a dead endpoint shipped as though it worked — `morpho-blue` is the worked example of
 * a well-known protocol that is therefore absent.
 *
 * Presence is not liveness. `scripts/messari-probe.ts` is the gate that actually calls
 * each endpoint; this module only reports what the registry claims.
 */
import { z } from 'zod';
import raw from './messari-deployments.json' with { type: 'json' };

/** The five categories the fixed-income agents read. Four come from Messari. */
export const MESSARI_CATEGORIES = ['lending', 'dex', 'perpetual', 'liquid-staking'] as const;
export type MessariCategory = (typeof MESSARI_CATEGORIES)[number];

export const MessariDeploymentSchema = z.object({
  /** Messari's protocol slug, e.g. `aave-v3`. */
  protocol: z.string().min(1),
  /** This package's category. */
  category: z.enum(MESSARI_CATEGORIES),
  /** Messari's own schema name, kept verbatim so a query can be matched to its schema. */
  messariSchema: z.string().min(1),
  network: z.string().min(1),
  /** The gateway subgraph ID. */
  queryId: z.string().min(1),
  status: z.string().nullable(),
  versions: z.record(z.string(), z.string()),
});
export type MessariDeployment = z.infer<typeof MessariDeploymentSchema>;

const MessariRegistrySchema = z.object({
  $schema: z.literal('internal://messari-deployments/v1'),
  source: z.object({
    url: z.string().url(),
    repository: z.string().url(),
    generator: z.string().min(1),
    /** ISO date the registry was regenerated. Re-verify if older than ~2 months. */
    verifiedAt: z.string().min(1),
    rule: z.string().min(1),
    upstreamProtocols: z.number().int().nonnegative(),
    upstreamDeployments: z.number().int().nonnegative(),
    retained: z.number().int().nonnegative(),
    droppedHostedOnly: z.number().int().nonnegative(),
    droppedBySchemaExclusion: z.number().int().nonnegative(),
    droppedByLiquidStakingAllowlist: z.number().int().nonnegative(),
    excludedSchemas: z.record(z.string(), z.string()),
    liquidStakingProtocols: z.array(z.string()),
    categories: z.record(z.string(), z.number().int().nonnegative()),
  }),
  deployments: z.array(MessariDeploymentSchema),
});

/**
 * Parsed at module load.
 *
 * A malformed registry is a build-time problem, not a runtime one: failing here means
 * `typecheck`/`test` catches a bad regeneration, rather than a query failing later
 * against an ID that was never valid.
 */
export const messariRegistry = MessariRegistrySchema.parse(raw);

/** Provenance for the loaded registry — surface this wherever the data is shown. */
export function messariRegistrySource(): typeof messariRegistry.source {
  return messariRegistry.source;
}

/** Every deployment, optionally narrowed to one category. */
export function listMessariDeployments(category?: MessariCategory): MessariDeployment[] {
  return category === undefined
    ? [...messariRegistry.deployments]
    : messariRegistry.deployments.filter((deployment) => deployment.category === category);
}

/**
 * Resolve a protocol (and optionally a network) to its deployment.
 *
 * When `network` is omitted and the protocol has exactly one deployment it is
 * returned; when it has several, that is ambiguous and reported as such rather than
 * silently picking the first — the caller must choose a chain, because picking one
 * for them would mean a fixed-income number computed against the wrong chain.
 */
export function findMessariDeployment(
  protocol: string,
  network?: string,
): MessariDeployment | null {
  const matches = messariRegistry.deployments.filter(
    (deployment) =>
      deployment.protocol === protocol &&
      (network === undefined || deployment.network === network),
  );
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0] ?? null;
  if (network !== undefined) return matches[0] ?? null;
  return null;
}

/** Networks a protocol is deployed on, for disambiguating before a lookup. */
export function messariNetworksFor(protocol: string): string[] {
  return messariRegistry.deployments
    .filter((deployment) => deployment.protocol === protocol)
    .map((deployment) => deployment.network)
    .sort();
}

/** Distinct protocols in the registry, optionally within one category. */
export function listMessariProtocols(category?: MessariCategory): string[] {
  return [...new Set(listMessariDeployments(category).map((deployment) => deployment.protocol))].sort();
}
