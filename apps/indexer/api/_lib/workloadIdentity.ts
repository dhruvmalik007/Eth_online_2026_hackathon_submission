import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

/**
 * Keyless Google credentials.
 *
 * Vercel has no `gcloud` session and this deployment should not hold a private key, so it federates:
 * it presents the OIDC token Vercel signs for the invocation, GCP's Security Token Service exchanges
 * it for a short-lived access token for `GCP_SERVICE_ACCOUNT_EMAIL`, and nobody stores a secret. The
 * identity that may be impersonated is pinned in IAM to this project and these environments, so the
 * token is worthless anywhere else.
 *
 * ## Why a file, and why the platform boundary writes it
 *
 * The credential clients in `@ethonline2026/*` take their credentials from Application Default
 * Credentials and cannot be handed an auth object. ADC supports an `external_account` config whose
 * subject token is read from a file, so that is the seam used here: the config is static and written
 * once, and the token file is refreshed per request. Keeping the token in the environment instead
 * would not work — Vercel exposes it only on the request, never at module scope.
 */

/** Set by Vercel on every function invocation. Never trusted from anywhere else. */
export const OIDC_HEADER = 'x-vercel-oidc-token';

const CONFIG_PATH = '/tmp/indexer-gac.json';
const TOKEN_PATH = '/tmp/vercel-oidc-token';

/**
 * The last token written, so a busy instance does not rewrite the file on every request.
 *
 * Tokens are fungible — every invocation in an environment carries one that authorises the same
 * subject — so keeping the most recent is correct rather than merely cheap.
 */
let lastToken: string | undefined;

/**
 * Remember the invocation's OIDC token.
 *
 * Called from the platform boundary, which is the only place that sees the raw Node request. A
 * malformed value is ignored: the exchange would reject it anyway, and storing it would replace a
 * working token with one that cannot be exchanged.
 */
export function rememberOidcToken(token: string): void {
  const trimmed = token.trim();
  // A JWT has three dot-separated segments. Checking the shape keeps a stray header value from
  // displacing a usable token for the life of the instance.
  if (trimmed.split('.').length !== 3) return;
  if (trimmed === lastToken) return;

  try {
    mkdirSync('/tmp', { recursive: true });
    writeFileSync(TOKEN_PATH, trimmed, { mode: 0o600 });
    lastToken = trimmed;
  } catch (error) {
    // A failed write must not fail the request: it only degrades the GCP calls that follow.
    console.error(
      '[indexer] could not write the workload identity token:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Point ADC at a workload identity federation config, if this deployment has one.
 *
 * Returns false when the federation variables are absent, which is the case locally and on any
 * deployment still using a key — the caller then falls back to the key path rather than failing.
 */
export function prepareWorkloadIdentity(env: NodeJS.ProcessEnv = process.env): boolean {
  const projectNumber = required(env, 'GCP_PROJECT_NUMBER');
  const pool = required(env, 'GCP_WORKLOAD_IDENTITY_POOL_ID');
  const provider = required(env, 'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID');
  const serviceAccount = required(env, 'GCP_SERVICE_ACCOUNT_EMAIL');
  if (
    projectNumber === undefined ||
    pool === undefined ||
    provider === undefined ||
    serviceAccount === undefined
  ) {
    return false;
  }

  const config = {
    type: 'external_account',
    audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${pool}/providers/${provider}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    // Impersonation is what makes signing possible without a key: `getSignedUrl` calls
    // `generateAccessToken`/`signBlob` as this service account, which is why it holds
    // `serviceAccountTokenCreator` on itself and nothing else.
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccount}:generateAccessToken`,
    credential_source: { file: TOKEN_PATH },
  };

  try {
    mkdirSync('/tmp', { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(config), { mode: 0o600 });
    // ADC reads the token file lazily, so it must exist before the first exchange. Created empty,
    // which fails the exchange rather than the file read — a clearer error by one step.
    if (!existsSync(TOKEN_PATH)) writeFileSync(TOKEN_PATH, '', { mode: 0o600 });
    env['GOOGLE_APPLICATION_CREDENTIALS'] = CONFIG_PATH;
    return true;
  } catch (error) {
    console.error(
      '[indexer] could not write the workload identity config:',
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}
