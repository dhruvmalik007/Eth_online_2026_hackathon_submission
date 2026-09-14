import "server-only";
import { verifyAccessToken } from "@privy-io/node";
import { PRIVY_APP_ID } from "@/lib/privy/config";
import { serverEnv } from "@/lib/env";

/**
 * Verifying a Privy access token, server-side.
 *
 * ## Why this exists
 *
 * The desk's API routes currently trust whoever calls them. `/api/inference` attributes every
 * browser caller to one configured identity (`INFERENCE_USER_ID`, defaulting to
 * `"agentic-ems-desk"`), `/api/reactor/token` will mint a Reactor JWT for anyone, and
 * `/api/upsample` will spend the server's OpenAI key for anyone. This is the piece that lets a
 * route answer "who is actually calling" before it does any of that.
 *
 * `apps/execution/src/privyAuth.ts` already proves the shape of the answer: take the token from
 * `Authorization: Bearer`, verify it, and read the identity out of the *verified claims*. Nothing
 * else in the request may be believed. This mirrors that logic rather than re-inventing it.
 *
 * ## Why the standalone verifier, and not the client
 *
 * `verifyAccessToken({access_token, app_id, verification_key})` needs the app id and the
 * verification key — and **not the app secret**. That is load-bearing here rather than incidental:
 * `lib/privy/config.ts` states that this app deliberately never reads the App Secret, because
 * sign-in and wallet provisioning are entirely client-side and there is then no secret to leak.
 * Verifying with the verification key keeps that property true, so a compromise of this app's
 * environment still does not yield a credential that can act as the app.
 *
 * It also makes verification a local signature check with no round-trip to Privy, which is what a
 * serverless cold start wants.
 *
 * ## The App ID comes from the same place the browser gets it
 *
 * One value, one read. `lib/privy/config.ts` already holds `PRIVY_APP_ID`, read as a literal
 * `process.env.NEXT_PUBLIC_PRIVY_APP_ID` member access because that is the only form Next can inline
 * — and `lib/envRules.test.ts` fails the build when a public variable is read any other way. This
 * module imports that constant rather than reading the variable a second time. The App ID is public
 * by design, so it is safe on both sides; the verification key is the half that must never reach the
 * browser, and it is read from `serverEnv()`.
 */

/** The dashboard's verification key for this app, or `undefined` when unset. */
function configuredVerificationKey(): string | undefined {
  const key = serverEnv().PRIVY_VERIFICATION_KEY?.trim();
  return key === undefined || key.length === 0 ? undefined : key;
}

/** The app id, or `undefined` when this deployment has no Privy app configured. */
function configuredAppId(): string | undefined {
  const id = PRIVY_APP_ID.trim();
  return id.length === 0 ? undefined : id;
}

/**
 * Whether this deployment can attribute a request to a Privy user at all.
 *
 * False is not a licence to skip verification: callers must treat it as "cannot authenticate
 * anyone" and refuse, which is what {@link verifyPrivyToken} does. The distinction is only useful
 * for a route that wants to say *why* it is refusing.
 */
export function privyVerificationConfigured(): boolean {
  return configuredAppId() !== undefined && configuredVerificationKey() !== undefined;
}

/** What a verified token proves. */
export interface VerifiedPrivySession {
  /**
   * The Privy DID.
   *
   * Taken from the token's `sub` claim after the signature has been checked — the one value in the
   * whole request a caller could not have supplied.
   */
  readonly did: string;
  /** The Privy session the token was issued for. */
  readonly sessionId: string;
  /** Expiry as Unix seconds, straight from the token. */
  readonly expiresAt: number;
}

/**
 * Thrown when a token cannot be attributed to a verified Privy user.
 *
 * The message is safe to surface; the verifier's own detail — expired versus forged versus minted
 * for a different app — is logged rather than returned, because that distinction is useful to an
 * operator and useful to an attacker.
 */
export class PrivyVerificationError extends Error {
  constructor(message = "The Privy access token could not be verified for this app.") {
    super(message);
    this.name = "PrivyVerificationError";
  }
}

/**
 * Verify a Privy access token and return the session it proves.
 *
 * The library checks the signature, the expiry, the issuer (`privy.io`), and — the check a naive
 * `jwtVerify` omits — that the token's audience is *this* app. A token minted for another Privy app
 * is a valid signature over the wrong claim, and would otherwise be accepted.
 *
 * @throws {PrivyVerificationError} for a blank token, an unconfigured deployment, or any token that
 *   does not verify.
 */
export async function verifyPrivyToken(token: string): Promise<VerifiedPrivySession> {
  const appId = configuredAppId();
  const verificationKey = configuredVerificationKey();
  if (appId === undefined || verificationKey === undefined) {
    throw new PrivyVerificationError(
      "Privy verification is not configured: set NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_VERIFICATION_KEY.",
    );
  }

  const trimmed = token.trim();
  if (trimmed.length === 0) throw new PrivyVerificationError();

  try {
    const claims = await verifyAccessToken({
      access_token: trimmed,
      app_id: appId,
      verification_key: verificationKey,
    });
    return {
      did: claims.user_id,
      sessionId: claims.session_id,
      expiresAt: claims.expiration,
    };
  } catch (error) {
    console.error(
      "[privy] access token verification failed:",
      error instanceof Error ? error.message : String(error),
    );
    throw new PrivyVerificationError();
  }
}
