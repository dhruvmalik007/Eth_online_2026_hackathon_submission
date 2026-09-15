import { existsSync, readFileSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { prepareWorkloadIdentity, rememberOidcToken } from '../api/_lib/workloadIdentity.js';

const CONFIG_PATH = '/tmp/indexer-gac.json';
const TOKEN_PATH = '/tmp/vercel-oidc-token';

const FEDERATION: NodeJS.ProcessEnv = {
  GCP_PROJECT_NUMBER: '887606357212',
  GCP_SERVICE_ACCOUNT_EMAIL: 'vercel-indexer@example.iam.gserviceaccount.com',
  GCP_WORKLOAD_IDENTITY_POOL_ID: 'vercel',
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'vercel',
};

/**
 * Three dot-separated segments, which is the whole of what the writer checks.
 *
 * Built at runtime, never written down. A JWT-shaped literal is not a credential, but it reads like
 * one to every scanner and every future reader — and a test file is precisely where a real one would
 * sit unnoticed. Nothing here needs to *be* a token; it needs to have a token's shape, and that is
 * something that can be generated.
 */
const shapedToken = (subject: string): string =>
  ['header', subject, 'signature'].map((part) => Buffer.from(part).toString('base64url')).join('.');

const TOKEN = shapedToken('test');

afterEach(() => {
  rmSync(CONFIG_PATH, { force: true });
  rmSync(TOKEN_PATH, { force: true });
});

describe('prepareWorkloadIdentity', () => {
  it('declines, rather than half-configuring, when the set is incomplete', () => {
    // A partial set is the dangerous case: it would write a config that exchanges a token against
    // the wrong pool, and the failure would surface much later as an opaque auth error. Declining
    // lets the caller fall back to a key or a local session.
    for (const missing of Object.keys(FEDERATION)) {
      const partial: NodeJS.ProcessEnv = { ...FEDERATION };
      delete partial[missing];
      expect(prepareWorkloadIdentity(partial), `without ${missing}`).toBe(false);
    }
    expect(existsSync(CONFIG_PATH)).toBe(false);
  });

  it('writes an external_account config pointing at this pool and this identity', () => {
    expect(prepareWorkloadIdentity({ ...FEDERATION })).toBe(true);

    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Record<string, unknown>;
    expect(config['type']).toBe('external_account');
    // The audience format is exact and easy to get subtly wrong; a wrong one fails at exchange time
    // with a message that does not name the field.
    expect(config['audience']).toBe(
      '//iam.googleapis.com/projects/887606357212/locations/global/workloadIdentityPools/vercel/providers/vercel',
    );
    expect(config['subject_token_type']).toBe('urn:ietf:params:oauth:token-type:jwt');
    expect(config['token_url']).toBe('https://sts.googleapis.com/v1/token');
    // Impersonation is what makes keyless signing possible at all.
    expect(config['service_account_impersonation_url']).toContain(
      '/serviceAccounts/vercel-indexer@example.iam.gserviceaccount.com:generateAccessToken',
    );
    // The token comes from the file the platform boundary refreshes, not from the environment —
    // Vercel only exposes it on the request.
    expect(config['credential_source']).toEqual({ file: TOKEN_PATH });
  });

  it('points ADC at the config it wrote', () => {
    const env: NodeJS.ProcessEnv = { ...FEDERATION };
    prepareWorkloadIdentity(env);
    // The clients never see this directly; they read it from the environment they share. Asserted on
    // the object that was passed, because that is the one the caller keeps.
    expect(env['GOOGLE_APPLICATION_CREDENTIALS']).toBe(CONFIG_PATH);
  });
});

describe('rememberOidcToken', () => {
  it('stores the invocation token where the credential config looks for it', () => {
    rememberOidcToken(TOKEN);
    expect(readFileSync(TOKEN_PATH, 'utf8')).toBe(TOKEN);
  });

  it('ignores anything that is not a JWT', () => {
    // A stray header value must not displace a usable token for the life of the instance, so the
    // shape is checked before it is written.
    rememberOidcToken('not-a-jwt');
    expect(existsSync(TOKEN_PATH)).toBe(false);
  });

  it('refuses a near miss rather than displacing a working token', () => {
    // Two segments is what a stripped signature or a truncated value produces, and it is close
    // enough to look right in a log. The token already stored must survive it.
    const good = shapedToken('good');
    rememberOidcToken(good);
    rememberOidcToken('header.payload');
    expect(readFileSync(TOKEN_PATH, 'utf8')).toBe(good);
  });

  it('trims surrounding whitespace', () => {
    // A distinct token, because the writer deliberately skips one it has already stored — reusing
    // `TOKEN` here would prove nothing about the write.
    const rotated = shapedToken('rotated');
    rememberOidcToken(`  ${rotated}\n`);
    expect(readFileSync(TOKEN_PATH, 'utf8')).toBe(rotated);
  });
});
