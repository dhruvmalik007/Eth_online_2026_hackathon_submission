/**
 * The snapshot store — a port with two adapters.
 *
 * Snapshots live in Google Cloud Storage because the ETL runs on Cloud Run:
 * staying in-GCP avoids cross-cloud egress on every sweep, and the always-free
 * tier covers this workload. A local-directory adapter exists so the whole
 * pipeline can run and be tested without any cloud access, which is what keeps
 * development free and the test suite offline.
 *
 * Both adapters sit behind {@link RiskStore}, so the repository never knows which
 * one it has. That is the dependency-inversion seam: the read path depends on the
 * abstraction, and the composition root decides the concrete store.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { StoreError } from './errors.js';

/** A stored object: its key and verbatim body. */
export interface StoredObject {
  readonly key: string;
  readonly body: string;
}

/**
 * Port: read and write snapshot objects.
 *
 * Deliberately narrow (four methods). A repository needs to fetch one snapshot,
 * list a family, write, and test for existence — nothing more, so nothing more
 * is offered.
 */
export interface RiskStore {
  /**
   * Read one object.
   *
   * @param key - Key relative to the configured prefix.
   * @returns The body, or `null` when the object does not exist. Absence is a
   *   normal state (a first run has no snapshots), so it is not an error.
   * @throws {StoreError} When the store is reachable but the read failed.
   */
  get(key: string): Promise<string | null>;

  /**
   * Write one object, overwriting any existing value.
   *
   * @param key - Key relative to the configured prefix.
   * @param body - The serialized content.
   * @throws {StoreError} When the write fails.
   */
  put(key: string, body: string): Promise<void>;

  /**
   * List the keys under a prefix.
   *
   * @param prefix - Key prefix, e.g. `chains/`.
   * @returns The matching keys, relative to the configured prefix.
   * @throws {StoreError} When the listing fails.
   */
  list(prefix: string): Promise<string[]>;

  /**
   * Whether an object exists.
   *
   * @param key - Key relative to the configured prefix.
   * @returns `true` when present.
   * @throws {StoreError} When the store cannot be reached.
   */
  exists(key: string): Promise<boolean>;
}

/**
 * A store backed by the local filesystem.
 *
 * Used for development, for the offline test suite, and as the `--no-cloud`
 * target of the scraper. Keys map to paths beneath a root directory, with the
 * parent created on demand.
 */
export class LocalDirStore implements RiskStore {
  /**
   * @param root - Directory that keys resolve beneath.
   */
  constructor(private readonly root: string) {}

  /**
   * Read one object from the filesystem.
   *
   * @param key - Key relative to the root directory.
   * @returns The file body, or `null` when it does not exist.
   * @throws {StoreError} When the file exists but cannot be read.
   */
  async get(key: string): Promise<string | null> {
    try {
      return readFileSync(this.pathFor(key), 'utf8');
    } catch (err) {
      if (isNotFound(err)) return null;
      throw new StoreError('read', key, describe(err), err);
    }
  }

  /**
   * Write one object, creating parent directories as needed.
   *
   * @param key - Key relative to the root directory.
   * @param body - The content to write.
   * @throws {StoreError} When the file cannot be written.
   */
  async put(key: string, body: string): Promise<void> {
    const path = this.pathFor(key);
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body, 'utf8');
    } catch (err) {
      throw new StoreError('write', key, describe(err), err);
    }
  }

  /**
   * List the JSON objects beneath a prefix directory.
   *
   * @param prefix - Key prefix, e.g. `chains/`.
   * @returns The matching keys, sorted. Empty when the directory is absent.
   * @throws {StoreError} When the directory exists but cannot be read.
   */
  async list(prefix: string): Promise<string[]> {
    const dir = this.pathFor(prefix);
    try {
      return readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => `${prefix.replace(/\/$/, '')}/${name}`)
        .sort();
    } catch (err) {
      if (isNotFound(err)) return [];
      throw new StoreError('list', prefix, describe(err), err);
    }
  }

  /**
   * Whether an object exists on disk.
   *
   * @param key - Key relative to the root directory.
   * @returns `true` when the file is present.
   */
  async exists(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  /**
   * Resolve a key to an absolute path.
   *
   * @param key - Key relative to the root.
   * @returns The absolute path.
   */
  private pathFor(key: string): string {
    return join(this.root, key);
  }
}

/**
 * The minimal surface of `@google-cloud/storage` this adapter uses.
 *
 * Declared structurally rather than importing the SDK's types, so the module can
 * be type-checked and unit-tested without the package present — the adapter is
 * the only place the SDK is touched (dependency inversion).
 */
export interface GcsBucketLike {
  file(key: string): {
    download(): Promise<[Buffer, ...unknown[]]>;
    save(body: string, options?: { contentType?: string }): Promise<unknown>;
    exists(): Promise<[boolean, ...unknown[]]>;
  };
  /**
   * The real SDK resolves `[files, nextQuery?, apiResponse?]`, so the tuple is
   * declared open-ended: only the file list is read, and a one-element tuple from
   * a test double still satisfies this.
   */
  getFiles(options: { prefix: string }): Promise<[Array<{ name: string }>, ...unknown[]]>;
}

/**
 * A store backed by a Google Cloud Storage bucket.
 *
 * The `bucket` is injected rather than constructed here, so a test can supply a
 * fake and the composition root owns the credential handling.
 */
export class GcsStore implements RiskStore {
  /**
   * @param bucket - The bucket handle (or a test double).
   * @param prefix - Key prefix within the bucket, e.g. `risk`.
   */
  constructor(
    private readonly bucket: GcsBucketLike,
    private readonly prefix: string,
  ) {}

  /**
   * Download one object from the bucket.
   *
   * @param key - Key relative to the configured prefix.
   * @returns The object body, or `null` when it does not exist.
   * @throws {StoreError} When the object exists but cannot be downloaded.
   */
  async get(key: string): Promise<string | null> {
    const file = this.bucket.file(this.pathFor(key));
    try {
      const [contents] = await file.download();
      return contents.toString('utf8');
    } catch (err) {
      // The SDK signals a missing object as a 404-shaped error; treat it as
      // absence rather than a failure, matching the port's contract.
      if (isNotFound(err)) return null;
      throw new StoreError('read', key, describe(err), err);
    }
  }

  /**
   * Upload one object to the bucket.
   *
   * @param key - Key relative to the configured prefix.
   * @param body - The content to upload.
   * @throws {StoreError} When the upload fails.
   */
  async put(key: string, body: string): Promise<void> {
    try {
      await this.bucket.file(this.pathFor(key)).save(body, { contentType: 'application/json' });
    } catch (err) {
      throw new StoreError('write', key, describe(err), err);
    }
  }

  /**
   * List the JSON objects beneath a prefix.
   *
   * @param prefix - Key prefix, e.g. `chains/`.
   * @returns The matching keys, relative to the configured prefix.
   * @throws {StoreError} When the listing fails.
   */
  async list(prefix: string): Promise<string[]> {
    const full = this.pathFor(prefix);
    try {
      const [files] = await this.bucket.getFiles({ prefix: full });
      return files
        .map((f) => f.name.slice(this.prefix.length + 1))
        .filter((key) => key.endsWith('.json'))
        .sort();
    } catch (err) {
      throw new StoreError('list', prefix, describe(err), err);
    }
  }

  /**
   * Whether an object exists in the bucket.
   *
   * @param key - Key relative to the configured prefix.
   * @returns `true` when the object is present.
   * @throws {StoreError} When the bucket cannot be reached.
   */
  async exists(key: string): Promise<boolean> {
    try {
      const [present] = await this.bucket.file(this.pathFor(key)).exists();
      return present;
    } catch (err) {
      throw new StoreError('read', key, describe(err), err);
    }
  }

  /**
   * Join the configured prefix onto a key.
   *
   * @param key - Key relative to the prefix.
   * @returns The full object name within the bucket.
   */
  private pathFor(key: string): string {
    return `${this.prefix.replace(/\/$/, '')}/${key}`;
  }
}

/**
 * Whether an error means "not found".
 *
 * Node's filesystem uses `ENOENT`; the GCS SDK surfaces a 404 code. Both are
 * absence, not failure, and the port's contract depends on telling them apart.
 *
 * @param err - The caught error.
 * @returns `true` when the error indicates a missing object.
 */
function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const candidate = err as { code?: unknown; status?: unknown };
  return candidate.code === 'ENOENT' || candidate.code === 404 || candidate.status === 404;
}

/**
 * Render an error for a {@link StoreError} message.
 *
 * @param err - The caught error.
 * @returns A human-readable description.
 */
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
