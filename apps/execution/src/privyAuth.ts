/**
 * Privy access-token verification — the authenticator that may guard signing.
 *
 * ## Why this exists
 *
 * {@link HeaderAuthenticator} trusts a client-supplied `x-user-id`. That is fine for local work and
 * indefensible next to a broadcast key, which is why `assertDeployable` refuses to boot the two
 * together in `live` mode. This is the counterpart that makes live mode safe.
 *
 * ## The identity is never taken from the request
 *
 * A caller may put anything in a header, a body field or a query parameter, so none of them are
 * read for identity. The only thing accepted from the request is the *token*, and the user it
 * belongs to is whatever Privy signed into it. Everything below exists to preserve that: the token
 * is verified against the app's verification key, and `user_id` comes from the verified claims.
 *
 * ## Expiry is checked, and so is the audience
 *
 * Privy's verifier checks the signature, the expiry and that the token was issued for *this* app. A
 * token minted for a different Privy app is a valid signature over the wrong claim, which is the
 * failure a naive `jwtVerify` without an audience would accept.
 */
import { PrivyClient } from "@privy-io/node";
import type { FastifyRequest } from "fastify";
import { HttpError, type Authenticator } from "./http.js";

export interface PrivyAuthenticatorOptions {
  readonly appId: string;
  readonly appSecret: string;
  /**
   * The dashboard's verification key for this app.
   *
   * Optional. Without it the SDK fetches it from Privy on first use and caches it, which is one
   * extra round-trip at cold start; with it, verification has no network dependency on Privy at all
   * beyond the JWKS it is configured with.
   */
  readonly verificationKey?: string;
}

/**
 * `Authorization: Bearer <token>`.
 *
 * The header is the documented location when the app keeps its session in local storage, which is
 * the default and what `@privy-io/react-auth`'s `getAccessToken()` feeds. The `privy-token` cookie
 * is the alternative for a cookie-managed session; it is deliberately not read here, so that a
 * deployment cannot silently accept a second, less obvious credential path.
 */
function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== "string") return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

export class PrivyAuthenticator implements Authenticator {
  readonly #client: PrivyClient;

  constructor(options: PrivyAuthenticatorOptions) {
    this.#client = new PrivyClient({
      appId: options.appId,
      appSecret: options.appSecret,
      ...(options.verificationKey === undefined
        ? {}
        : { jwtVerificationKey: options.verificationKey }),
    });
  }

  async authenticate(request: FastifyRequest): Promise<string> {
    const token = bearerToken(request);
    if (token === undefined) {
      throw new HttpError(
        "UNAUTHORIZED",
        "Missing bearer token. This deployment authenticates with a Privy access token.",
      );
    }

    try {
      // The client's own verification reads the app id from its configuration, so it takes the
      // token alone — unlike the standalone `verifyAccessToken`, which wants the whole triple.
      const claims = await this.#client.utils().auth().verifyAccessToken(token);
      // `user_id` is the Privy DID taken from the *verified* claims — the one value here a caller
      // could not have supplied.
      return claims.user_id;
    } catch (error) {
      // The verifier's message distinguishes an expired token from a forged one; that distinction is
      // useful in a log and useless to a caller deciding what to do, so the response stays uniform
      // while the detail is preserved for the operator.
      request.log.warn({ err: error }, "privy token verification failed");
      throw new HttpError(
        "UNAUTHORIZED",
        "The Privy access token could not be verified for this app.",
      );
    }
  }
}

export interface AuthenticatorEnv {
  readonly PRIVY_APP_ID?: string | undefined;
  readonly PRIVY_APP_SECRET?: string | undefined;
  readonly PRIVY_VERIFICATION_KEY?: string | undefined;
}

/**
 * The deployment's authenticator: Privy when it is configured, the development header otherwise.
 *
 * A half-configured pair is refused rather than downgraded. Falling back to the header authenticator
 * because only one of the two variables was set would turn a typo into a service that accepts
 * spoofed identities — the exact outcome the caller was trying to avoid by configuring Privy.
 */
export function createAuthenticator(
  env: AuthenticatorEnv,
  devFallback: () => Authenticator,
): Authenticator {
  const appId = env.PRIVY_APP_ID?.trim();
  const appSecret = env.PRIVY_APP_SECRET?.trim();
  const hasId = appId !== undefined && appId.length > 0;
  const hasSecret = appSecret !== undefined && appSecret.length > 0;

  if (hasId && hasSecret) {
    const verificationKey = env.PRIVY_VERIFICATION_KEY?.trim();
    return new PrivyAuthenticator({
      appId,
      appSecret,
      ...(verificationKey === undefined || verificationKey.length === 0
        ? {}
        : { verificationKey }),
    });
  }

  if (hasId !== hasSecret) {
    throw new Error(
      "Privy is half-configured: set both PRIVY_APP_ID and PRIVY_APP_SECRET, or neither. " +
        "Falling back to the development authenticator would accept spoofed identities.",
    );
  }

  return devFallback();
}
