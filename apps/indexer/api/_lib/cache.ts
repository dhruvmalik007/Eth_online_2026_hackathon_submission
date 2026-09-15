import { Storage } from '@google-cloud/storage';

/**
 * The CDN cache, as the deployment reads it.
 *
 * The bucket is private, so a browser cannot fetch an object from it — the console is authenticated to
 * Vercel, not to GCS. That leaves one workable shape: this deployment reads the private manifest with
 * its own credentials and hands back short-lived signed URLs, and the browser fetches the payloads
 * from Google's edge. The manifest hop is dynamic and tiny; the bytes never pass through a function.
 *
 * Signatures are minted per request rather than written into the manifest by the refresh job. A
 * job-minted URL would have to outlive that job's two-hour cadence, which means a stalled cron
 * eventually serves a console whose URLs have quietly expired with no other symptom. Per-request
 * signing has no expiry cliff, and staleness then shows up where it belongs — in `generatedAt`.
 */

/** Matches the refresh job's prefix. A shape change is a new prefix, never a reinterpretation. */
const PREFIX = 'cache/v1';
const MANIFEST_PATH = `${PREFIX}/manifest.json`;

/** The shape the console must understand. A newer manifest is refused, not partially read. */
export const CACHE_SCHEMA_VERSION = 1;

/**
 * Long enough for a page load and the requests it fans out; short enough that a URL copied out of a
 * developer console is not a standing grant.
 */
const SIGNED_URL_TTL_MS = 60 * 60 * 1000;

export interface CacheEntry {
  readonly key: string;
  readonly path: string;
  readonly fetchedAt: string;
  readonly changedAt: string;
  readonly sha256: string;
  readonly bytes: number | null;
}

export interface CacheFailure {
  readonly key: string;
  readonly error: string;
}

export interface CacheManifest {
  readonly version: number;
  readonly generatedAt: string;
  readonly durationMs: number | null;
  readonly entries: readonly CacheEntry[];
  readonly failures: readonly CacheFailure[];
  readonly healthStatus: string | null;
}

/** A manifest entry plus the URL that can actually be fetched right now. */
export interface SignedCacheEntry extends CacheEntry {
  readonly url: string;
}

export interface SignedManifest extends Omit<CacheManifest, 'entries'> {
  /** Shared by every entry, so one timestamp describes the whole grant. */
  readonly expiresAt: string;
  readonly entries: readonly SignedCacheEntry[];
}

let client: Storage | undefined;

/**
 * Lazily constructed, deliberately.
 *
 * The runtime materialises `GOOGLE_SERVICE_ACCOUNT_KEY` to a temp file and points ADC at it while it
 * is being created. Building this at module scope would construct the client before that happens, and
 * it would then be anonymous.
 */
function storage(): Storage {
  client ??= new Storage();
  return client;
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

function entryFrom(raw: unknown): CacheEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;

  // `path` and `sha256` are not decoration: without a path there is nothing to sign, and without a
  // hash the console cannot tell "unchanged for three days" from "nobody looked".
  const key = asString(record['key']);
  const path = asString(record['path']);
  const fetchedAt = asString(record['fetchedAt']);
  const sha256 = asString(record['sha256']);
  if (key === null || path === null || fetchedAt === null || sha256 === null) return null;

  return {
    key,
    path,
    fetchedAt,
    changedAt: asString(record['changedAt']) ?? fetchedAt,
    sha256,
    bytes:
      typeof record['bytes'] === 'number' && Number.isFinite(record['bytes'])
        ? record['bytes']
        : null,
  };
}

function failureFrom(raw: unknown): CacheFailure | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const key = asString(record['key']);
  if (key === null) return null;
  return { key, error: asString(record['error']) ?? 'unknown' };
}

/**
 * Read and validate the manifest.
 *
 * Returns `undefined` when the object is absent — the state before the job has ever run, which the
 * route reports as "not started" rather than as a failure. Throws for a manifest that exists but
 * carries a schema this deployment cannot read, because that is a real mismatch and treating it as
 * empty would hide a full cache behind an empty state.
 */
export async function readManifest(bucketName: string): Promise<CacheManifest | undefined> {
  const file = storage().bucket(bucketName).file(MANIFEST_PATH);

  let buffer: Buffer;
  try {
    [buffer] = await file.download();
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }

  const parsed = JSON.parse(buffer.toString('utf8')) as Record<string, unknown>;
  const version = typeof parsed['version'] === 'number' ? parsed['version'] : null;
  if (version !== CACHE_SCHEMA_VERSION) {
    throw new Error(
      `cache manifest is schema version ${String(version)}; this deployment reads ${CACHE_SCHEMA_VERSION}`,
    );
  }

  return {
    version,
    generatedAt: asString(parsed['generatedAt']) ?? new Date(0).toISOString(),
    durationMs: typeof parsed['durationMs'] === 'number' ? parsed['durationMs'] : null,
    entries: Array.isArray(parsed['entries'])
      ? parsed['entries'].map(entryFrom).filter((entry): entry is CacheEntry => entry !== null)
      : [],
    failures: Array.isArray(parsed['failures'])
      ? parsed['failures'].map(failureFrom).filter((failure): failure is CacheFailure => failure !== null)
      : [],
    healthStatus: asString(parsed['healthStatus']),
  };
}

/** Sign every entry in one pass, so the whole manifest shares a single expiry. */
export async function signManifest(
  bucketName: string,
  manifest: CacheManifest,
): Promise<SignedManifest> {
  const expires = Date.now() + SIGNED_URL_TTL_MS;
  const bucket = storage().bucket(bucketName);

  const entries = await Promise.all(
    manifest.entries.map(async (entry): Promise<SignedCacheEntry> => {
      const [url] = await bucket.file(entry.path).getSignedUrl({
        version: 'v4',
        action: 'read',
        expires,
      });
      return { ...entry, url };
    }),
  );

  return {
    version: manifest.version,
    generatedAt: manifest.generatedAt,
    durationMs: manifest.durationMs,
    expiresAt: new Date(expires).toISOString(),
    entries,
    failures: manifest.failures,
    healthStatus: manifest.healthStatus,
  };
}

/** GCS reports a missing object with a numeric `code` of 404. */
function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 404;
}
