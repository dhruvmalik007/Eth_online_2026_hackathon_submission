/**
 * The read path — validated snapshot access.
 *
 * Every read goes through a schema before the caller sees it, so a drifted or
 * hand-edited snapshot fails loudly at the boundary rather than propagating an
 * unvalidated shape into the agent. That is the same "validation frontier"
 * discipline the timeseries package uses for database rows.
 *
 * The repository also reports *freshness*. A stale snapshot is more useful than
 * no snapshot, provided the staleness is visible — what is forbidden is
 * presenting old data as current. Each read therefore returns the record
 * together with its provenance, and the caller can decide.
 */

import { SnapshotContractError, StoreError } from './errors.js';
import type { RiskStore } from './store.js';
import {
  ChainRiskProfileSchema,
  MANIFEST_KEY,
  ManifestSchema,
  MarketMakerDetailSchema,
  MarketMakerProfileSchema,
  MarketMakerSummarySchema,
  ProtocolGovernanceProfileSchema,
  snapshotKey,
  type ChainRiskProfile,
  type Manifest,
  type MarketMakerDetail,
  type MarketMakerProfile,
  type MarketMakerSummary,
  type ProtocolGovernanceProfile,
} from './types.js';

/** A validated record plus the key it came from. */
export interface Loaded<T> {
  readonly key: string;
  readonly value: T;
}

/**
 * Port: read chain risk profiles.
 *
 * Interfaces are split by *what a consumer actually needs* rather than exposing
 * one wide reader. A route that serves chain risk has no business depending on
 * market-maker methods it will never call: an unused method in a port is a test
 * double that must stub it, a mock that must assert it, and a reason the
 * interface cannot change without touching unrelated code.
 */
export interface ChainRiskReader {
  /**
   * Read one chain's risk profile.
   *
   * @param slug - The chain slug.
   * @returns The profile, or `null` when no snapshot exists.
   * @throws {SnapshotContractError} When the snapshot exists but fails validation.
   */
  chain(slug: string): Promise<Loaded<ChainRiskProfile> | null>;

  /**
   * List the chain slugs that have snapshots.
   *
   * @returns The slugs, sorted.
   */
  chainSlugs(): Promise<string[]>;
}

/** Port: read protocol governance profiles. */
export interface ProtocolGovernanceReader {
  /**
   * Read one protocol's governance profile.
   *
   * @param slug - The protocol slug.
   * @returns The profile, or `null` when no snapshot exists.
   * @throws {SnapshotContractError} When the snapshot exists but fails validation.
   */
  protocol(slug: string): Promise<Loaded<ProtocolGovernanceProfile> | null>;

  /**
   * List the protocol slugs that have snapshots.
   *
   * @returns The slugs, sorted.
   */
  protocolSlugs(): Promise<string[]>;
}

/** Port: read market-maker liquidity data. */
export interface MarketMakerReader {
  /**
   * Read one market maker's summary profile.
   *
   * @param slug - The market-maker slug.
   * @returns The profile, or `null` when no snapshot exists.
   * @throws {SnapshotContractError} When the snapshot exists but fails validation.
   */
  marketMaker(slug: string): Promise<Loaded<MarketMakerProfile> | null>;

  /**
   * Read one market maker's full detail card.
   *
   * The detail card is a separate document from the profile because the drawer is
   * a separate collection step; a run can succeed at the leaderboard and fail at
   * the drawers.
   *
   * @param slug - The market-maker slug.
   * @returns The detail, or `null` when no snapshot exists.
   * @throws {SnapshotContractError} When the snapshot exists but fails validation.
   */
  marketMakerDetail(slug: string): Promise<Loaded<MarketMakerDetail> | null>;

  /**
   * Read the aggregate market-maker summary.
   *
   * @returns The summary, or `null` when none exists.
   * @throws {SnapshotContractError} When the snapshot exists but fails validation.
   */
  marketMakerSummary(): Promise<Loaded<MarketMakerSummary> | null>;

  /**
   * List the market-maker slugs that have profiles.
   *
   * @returns The slugs, sorted.
   */
  marketMakerSlugs(): Promise<string[]>;
}

/** Port: read the run manifest, which carries freshness and provenance. */
export interface RunManifestReader {
  /**
   * Read the run manifest.
   *
   * @returns The manifest, or `null` when the store holds none.
   * @throws {SnapshotContractError} When the manifest exists but fails validation.
   */
  manifest(): Promise<Loaded<Manifest> | null>;
}

/**
 * Port: read validated risk snapshots.
 *
 * The composite of the four narrow ports above, satisfied by
 * {@link RiskProfileRepository}. Consumers should depend on the narrow port they
 * need — this type exists for the composition root and for a caller that
 * genuinely reads several families.
 */
export interface RiskProfileReader
  extends ChainRiskReader,
    ProtocolGovernanceReader,
    MarketMakerReader,
    RunManifestReader {}

/**
 * The slice of a zod schema this repository uses.
 *
 * Declared structurally so the repository depends on *validation*, not on zod
 * specifically — any validator exposing `safeParse` satisfies it, which keeps the
 * read path testable without a schema library in the loop.
 *
 * @template T - The validated record type.
 */
export interface SchemaLike<T> {
  /**
   * Validate an untrusted value.
   *
   * @param input - The value to validate.
   * @returns A discriminated result carrying either the parsed value or the issues.
   */
  safeParse(
    input: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
}

/**
 * A {@link RiskProfileReader} over any {@link RiskStore}.
 *
 * The concrete store is injected, so the same reader serves GCS and the local
 * directory without change.
 */
export class RiskProfileRepository implements RiskProfileReader {
  /**
   * @param store - The snapshot store to read from.
   */
  constructor(private readonly store: RiskStore) {}

  /**
   * Read and validate one chain's risk profile.
   *
   * @param slug - The chain slug, e.g. `base`.
   * @returns The validated profile, or `null` when no snapshot exists.
   * @throws {SnapshotContractError} When the snapshot exists but fails validation.
   */
  async chain(slug: string): Promise<Loaded<ChainRiskProfile> | null> {
    return this.read(snapshotKey('chains', slug), ChainRiskProfileSchema);
  }

  /**
   * List the chain slugs that have snapshots.
   *
   * @returns The slugs, sorted. Empty on a first run.
   * @throws {StoreError} When the store cannot be listed.
   */
  async chainSlugs(): Promise<string[]> {
    const keys = await this.store.list('chains/');
    return keys.map((key) => key.replace(/^chains\//, '').replace(/\.json$/, '')).sort();
  }

  /**
   * List the protocol slugs that have snapshots.
   *
   * @returns The slugs, sorted. Empty on a first run.
   * @throws {StoreError} When the store cannot be listed.
   */
  async protocolSlugs(): Promise<string[]> {
    const keys = await this.store.list('protocols/');
    return keys.map((key) => key.replace(/^protocols\//, '').replace(/\.json$/, '')).sort();
  }

  /**
   * List the market-maker slugs that have profiles.
   *
   * The detail documents (`{slug}.detail.json`) and the aggregate summary live
   * under the same prefix, so both are filtered out: a slug list that included
   * `summary` or a `.detail` suffix would produce a read that always misses.
   *
   * @returns The slugs, sorted. Empty on a first run.
   * @throws {StoreError} When the store cannot be listed.
   */
  async marketMakerSlugs(): Promise<string[]> {
    const keys = await this.store.list('market-makers/');
    return keys
      .filter((key) => !key.endsWith('.detail.json') && !key.endsWith('summary.json'))
      .map((key) => key.replace(/^market-makers\//, '').replace(/\.json$/, ''))
      .sort();
  }

  /**
   * Read and validate one protocol's governance profile.
   *
   * @param slug - The protocol slug, e.g. `aave`.
   * @returns The validated profile, or `null` when no snapshot exists.
   * @throws {SnapshotContractError} When the snapshot exists but fails validation.
   */
  async protocol(slug: string): Promise<Loaded<ProtocolGovernanceProfile> | null> {
    return this.read(snapshotKey('protocols', slug), ProtocolGovernanceProfileSchema);
  }

  /**
   * Read and validate one market maker's summary profile.
   *
   * @param slug - The market-maker slug, e.g. `flowdesk`.
   * @returns The validated profile, or `null` when no snapshot exists.
   * @throws {SnapshotContractError} When the snapshot exists but fails validation.
   */
  async marketMaker(slug: string): Promise<Loaded<MarketMakerProfile> | null> {
    return this.read(snapshotKey('market-makers', slug), MarketMakerProfileSchema);
  }

  /**
   * Read and validate one market maker's full detail card.
   *
   * The detail card is a separate document from the profile because the drawer
   * is a separate collection step; a run can succeed at the leaderboard and fail
   * at the drawers.
   *
   * @param slug - The market-maker slug.
   * @returns The validated detail card, or `null` when none exists.
   * @throws {SnapshotContractError} When the snapshot exists but fails validation.
   */
  async marketMakerDetail(slug: string): Promise<Loaded<MarketMakerDetail> | null> {
    return this.read(`market-makers/${slug}.detail.json`, MarketMakerDetailSchema);
  }

  /**
   * Read and validate the aggregate market-maker summary.
   *
   * @returns The validated summary, or `null` when none exists.
   * @throws {SnapshotContractError} When the snapshot exists but fails validation.
   */
  async marketMakerSummary(): Promise<Loaded<MarketMakerSummary> | null> {
    return this.read('market-makers/summary.json', MarketMakerSummarySchema);
  }

  /**
   * Read and validate the run manifest.
   *
   * @returns The validated manifest, or `null` when the store holds none.
   * @throws {SnapshotContractError} When the manifest exists but fails validation.
   */
  async manifest(): Promise<Loaded<Manifest> | null> {
    return this.read(MANIFEST_KEY, ManifestSchema);
  }

  /**
   * Read and validate one snapshot.
   *
   * @template T - The validated record type.
   * @param key - The snapshot key.
   * @param schema - The schema the body must satisfy.
   * @returns The validated record, or `null` when absent.
   * @throws {SnapshotContractError} When the body exists but fails validation,
   *   naming the first offending field so the failure is actionable.
   */
  private async read<T>(key: string, schema: SchemaLike<T>): Promise<Loaded<T> | null> {
    let body: string | null;
    try {
      body = await this.store.get(key);
    } catch (err) {
      if (err instanceof StoreError) throw err;
      throw new StoreError('read', key, err instanceof Error ? err.message : String(err), err);
    }
    if (body === null) return null;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(body);
    } catch (err) {
      throw new SnapshotContractError(
        key,
        `body is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const result = schema.safeParse(parsedJson);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new SnapshotContractError(
        key,
        `${issue?.path.join('.') ?? 'root'}: ${issue?.message ?? 'failed validation'}`,
      );
    }
    return { key, value: result.data };
  }
}
