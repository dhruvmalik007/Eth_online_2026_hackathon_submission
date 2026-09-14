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
import livenessRaw from './messari-liveness.json' with { type: 'json' };

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

/**
 * The result of probing every registry entry.
 *
 * Kept separate from the deployment registry on purpose. That file says which endpoints exist; this
 * one says which of them answered. The distinction is the whole point: presence is not liveness, and
 * 88 of 204 entries are dead. A UI that showed the registry size as "subgraphs live" would overstate
 * the system by roughly double.
 *
 * Produced by `scripts/messari-probe.ts`, so `verifiedAt` is the date the endpoints were actually
 * called rather than the date this file happened to be read.
 */
/** One endpoint, as the probe found it. */
export const MessariProbeEntrySchema = z.object({
  protocol: z.string().min(1),
  network: z.string().min(1),
  category: z.string().min(1),
  /** The probe's own words, usually including the block height it read. */
  detail: z.string().min(1),
});
export type MessariProbeEntry = z.infer<typeof MessariProbeEntrySchema>;

export type MessariProbeStatus = 'standard' | 'partial' | 'dead';

export const MessariLivenessSchema = z.object({
  $schema: z.literal('internal://messari-liveness/v1'),
  probe: z.string().min(1),
  verifiedAt: z.string().min(1),
  note: z.string().min(1),
  counts: z.object({
    total: z.number().int().nonnegative(),
    standard: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    dead: z.number().int().nonnegative(),
  }),
  byCategory: z.record(
    z.string(),
    z.object({
      standard: z.number().int().nonnegative(),
      partial: z.number().int().nonnegative(),
      dead: z.number().int().nonnegative(),
    }),
  ),
  /**
   * The per-endpoint results themselves, not just the tallies.
   *
   * This is what makes the numbers checkable: each entry carries the block the endpoint reported,
   * so a display can show the evidence rather than assert a conclusion.
   */
  standard: z.array(MessariProbeEntrySchema),
  partial: z.array(MessariProbeEntrySchema),
  dead: z.array(MessariProbeEntrySchema),
});
export type MessariLiveness = z.infer<typeof MessariLivenessSchema>;

export const messariLiveness = MessariLivenessSchema.parse(livenessRaw);

export interface SubgraphStats {
  readonly liveness: MessariLiveness['counts'] & { readonly verifiedAt: string; readonly probe: string };
  /** Per category, from the probe — the categories here are the probe's, which include `prediction`. */
  readonly byCategory: readonly { readonly category: string; readonly standard: number; readonly partial: number; readonly dead: number }[];
  readonly deployments: { readonly total: number; readonly byCategory: readonly { readonly category: string; readonly count: number }[] };
  readonly networksByCategory: readonly { readonly category: string; readonly networks: readonly string[] }[];
}

/**
 * The registry in the shape a dashboard tile needs.
 *
 * Every number is counted from the two files rather than restated, so a regeneration of either one
 * moves the display without a code change — and a number that cannot be counted cannot be invented
 * here.
 *
 * The dead count is returned alongside the live one deliberately: "108 live" and "108 live, 88 dead"
 * are different claims about the same system, and only the second one is the truth.
 */
export function subgraphStats(): SubgraphStats {
  const networks = new Map<string, Set<string>>();
  const perCategory = new Map<string, number>();

  for (const deployment of messariRegistry.deployments) {
    if (!networks.has(deployment.category)) networks.set(deployment.category, new Set());
    networks.get(deployment.category)?.add(deployment.network);
    perCategory.set(deployment.category, (perCategory.get(deployment.category) ?? 0) + 1);
  }

  return {
    liveness: { ...messariLiveness.counts, verifiedAt: messariLiveness.verifiedAt, probe: messariLiveness.probe },
    byCategory: Object.entries(messariLiveness.byCategory)
      .map(([category, counts]) => ({ category, ...counts }))
      .sort((left, right) => right.standard - left.standard),
    deployments: {
      total: messariRegistry.deployments.length,
      byCategory: [...perCategory.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((left, right) => right.count - left.count),
    },
    networksByCategory: [...networks.entries()]
      .map(([category, set]) => ({ category, networks: [...set].sort() }))
      .sort((left, right) => left.category.localeCompare(right.category)),
  };
}

/** Distinct networks a category is deployed on. */
export function messariNetworksIn(category: MessariCategory): string[] {
  const set = new Set<string>();
  for (const deployment of messariRegistry.deployments) {
    if (deployment.category === category) set.add(deployment.network);
  }
  return [...set].sort();
}

/**
 * The probe's per-endpoint results, tagged with the status they resolved to.
 *
 * `standard` means the endpoint answered and implemented the Messari core. `partial` means it
 * answered but the core query hit a schema difference — a real endpoint that will not serve the
 * standard query, which is neither alive-for-our-purposes nor dead. `dead` must not be queried.
 */
export function messariProbe(): readonly { readonly status: MessariProbeStatus; readonly entry: MessariProbeEntry }[] {
  const out: { status: MessariProbeStatus; entry: MessariProbeEntry }[] = [];
  for (const status of ['standard', 'partial', 'dead'] as const) {
    for (const entry of messariLiveness[status]) out.push({ status, entry });
  }
  return out;
}

/** Every probed endpoint for one protocol, across its networks and statuses. */
export function messariProbeFor(protocol: string): readonly { readonly status: MessariProbeStatus; readonly entry: MessariProbeEntry }[] {
  return messariProbe().filter((result) => result.entry.protocol === protocol);
}
