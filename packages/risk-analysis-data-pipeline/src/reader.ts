/**
 * Reader factory — the composition root for the read path.
 *
 * The GCS SDK is imported **here and nowhere else**, and only when a bucket is
 * actually configured. Two reasons:
 *
 *  - **Layering.** The risk package owns its own I/O. A consumer such as the
 *    serverless indexer asks for a {@link RiskProfileReader} and never sees a
 *    bucket, a credential or an SDK type — which is what lets the reader be
 *    exercised against a fake in tests.
 *  - **Cold start.** A dynamic import keeps the SDK out of the module graph when
 *    only a local directory is configured, so `pnpm dev` and the offline suites
 *    do not pay to load it.
 *
 * Selection precedence is local directory, then GCS, then nothing. Local wins
 * because its presence is an explicit, deliberate act; a bucket name inherited
 * from a shared environment should not override a developer's local fixtures.
 * "Nothing" is a legitimate outcome — the caller reports risk as unconfigured
 * rather than failing, since the rest of the service works without it.
 */

import { GcsStore, LocalDirStore, type RiskStore } from './store.js';
import { RiskProfileRepository, type RiskProfileReader } from './repository.js';

/** Which backing store to read snapshots from. */
export interface RiskReaderConfig {
  /** GCS bucket holding the published snapshots. */
  readonly gcsBucket?: string | undefined;
  /** Key prefix within the bucket. Defaults to `risk`. */
  readonly gcsPrefix?: string | undefined;
  /** Local directory holding the same layout, for development. */
  readonly localDir?: string | undefined;
}

/** The default key prefix, matching the collection worker's default. */
export const DEFAULT_RISK_PREFIX = 'risk';

/**
 * Build a reader over whichever store the configuration names.
 *
 * @param config - The store selection. An empty configuration is valid and
 *   yields `undefined`.
 * @returns A validated reader, or `undefined` when no store is configured.
 * @example
 * ```ts
 * const reader = await createRiskProfileReader({ gcsBucket: process.env.RISK_GCS_BUCKET });
 * if (reader !== undefined) {
 *   const base = await reader.chain('base');
 * }
 * ```
 */
export async function createRiskProfileReader(
  config: RiskReaderConfig,
): Promise<RiskProfileReader | undefined> {
  const store = await createRiskStore(config);
  return store === undefined ? undefined : new RiskProfileRepository(store);
}

/**
 * Resolve the configured store, importing the GCS SDK only if it is needed.
 *
 * Exported separately from {@link createRiskProfileReader} so a caller that wants
 * the write surface (a local backfill, say) can reuse the same selection logic
 * without reaching for the reader.
 *
 * @param config - The store selection.
 * @returns The store, or `undefined` when nothing is configured.
 * @example
 * ```ts
 * const store = await createRiskStore({ localDir: './data/risk' });
 * ```
 */
export async function createRiskStore(config: RiskReaderConfig): Promise<RiskStore | undefined> {
  const localDir = config.localDir?.trim();
  if (localDir !== undefined && localDir.length > 0) {
    return new LocalDirStore(localDir);
  }

  const bucketName = config.gcsBucket?.trim();
  if (bucketName === undefined || bucketName.length === 0) {
    return undefined;
  }

  // Dynamic so the SDK stays out of the module graph for local-only runs, and so
  // its concrete types never appear in this package's public surface: GcsStore
  // takes a structural handle, so nothing downstream needs them.
  const { Storage } = await import('@google-cloud/storage');

  const prefix = config.gcsPrefix?.trim();
  return new GcsStore(
    new Storage().bucket(bucketName),
    prefix === undefined || prefix.length === 0 ? DEFAULT_RISK_PREFIX : prefix,
  );
}
