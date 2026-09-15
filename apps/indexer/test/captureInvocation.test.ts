import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every route adapter must capture the invocation's OIDC token.
 *
 * This guard exists because the opposite shipped once. The capture lived inside `toWebRequest`, which
 * made it depend on whether an adapter *happened* to translate the request — and the four adapters
 * that never do (`health`, `cache/manifest`, `risk/chains`, `risk/protocols`) are three-quarters GCS
 * readers, so the routes that most needed credentials were exactly the ones that never got them. It
 * surfaced only in production, as an empty token file that the credential library reported as
 * `Unable to parse the subject_token from the credential_source file`.
 *
 * A test is the only thing that catches a missing call in a new adapter, since nothing about it fails
 * to compile.
 */

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'api');

function adapterFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '_lib') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...adapterFiles(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

const ADAPTERS = adapterFiles(API_DIR);
const relative = (path: string): string => path.slice(API_DIR.length + 1);

describe('route adapters', () => {
  it('finds them all', () => {
    // Without this the rest passes vacuously the moment the walk breaks.
    expect(ADAPTERS.length).toBeGreaterThanOrEqual(13);
  });

  it('captures the invocation token in every adapter', () => {
    const missing = ADAPTERS.filter(
      (path) => !readFileSync(path, 'utf8').includes('captureInvocation(request)'),
    ).map(relative);
    expect(missing, 'these adapters never capture the OIDC token').toEqual([]);
  });

  it('imports it rather than calling something it never pulled in', () => {
    const unimported = ADAPTERS.filter(
      (path) => !/import \{[^}]*captureInvocation[^}]*\} from/.test(readFileSync(path, 'utf8')),
    ).map(relative);
    expect(unimported).toEqual([]);
  });

  it('captures it before anything that could need credentials', () => {
    // Mid-body would work today and quietly stop working the first time a handler grows a line above
    // it, so the call belongs on the first line after the signature.
    const late = ADAPTERS.filter((path) => {
      const body = readFileSync(path, 'utf8').split('Promise<void> {\n')[1] ?? '';
      return !body.startsWith('  captureInvocation(request);');
    }).map(relative);
    expect(late).toEqual([]);
  });
});
