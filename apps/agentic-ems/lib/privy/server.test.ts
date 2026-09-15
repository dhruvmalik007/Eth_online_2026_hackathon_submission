import { generateKeyPairSync, sign as signWith } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The verifier decides whether a route may act on a caller's behalf, so its refusals matter more
 * than its happy path — and the refusals it has to get right are the ones a real attacker produces.
 *
 * The tokens here are minted locally against a throwaway P-256 key, which is the point: the checks
 * being exercised are the signature, the expiry, the issuer and the audience, and none of them can
 * be tested by feeding the verifier a token that was never signed. `@privy-io/node` verifies with
 * `jose` using ES256, `privy.io` as issuer, and the app id as audience, so the fixtures have to
 * match that shape exactly or the tests would pass for the wrong reason.
 */
const APP_ID = "cmtx97qgx008q0ck04fad145i";
const DID = "did:privy:cmtest0000000000000000001";

const ours = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

/** A second, unrelated key — what a forged token would actually be signed with. */
const theirs = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const base64url = (value: string): string => Buffer.from(value).toString("base64url");

interface MintOptions {
  readonly audience?: string;
  readonly subject?: string;
  readonly expiresInSeconds?: number;
  readonly signingKey?: string;
}

/** A Privy-shaped access token: ES256, `privy.io` issuer, the app id as audience. */
function mintToken(options: MintOptions = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const signingInput = [
    base64url(JSON.stringify({ alg: "ES256", typ: "JWT" })),
    base64url(
      JSON.stringify({
        iss: "privy.io",
        aud: options.audience ?? APP_ID,
        sub: options.subject ?? DID,
        sid: "session-fixture",
        iat: now,
        exp: now + (options.expiresInSeconds ?? 3600),
      }),
    ),
  ].join(".");

  // ES256 is the raw R‖S pair; node emits DER unless asked otherwise, and a DER signature is
  // rejected by every ES256 verifier.
  const signature = signWith("sha256", Buffer.from(signingInput), {
    key: options.signingKey ?? ours.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");

  return `${signingInput}.${signature}`;
}

/**
 * Fresh module graph per case.
 *
 * Both `PRIVY_APP_ID` and `serverEnv()` are captured when their modules are first evaluated, so
 * changing `process.env` after an import would have no effect and every case would silently test
 * whatever the first one configured.
 *
 * `null` means "this variable is absent", which is deliberately not the same as `""`: the catalog's
 * format check rejects an empty string outright, so a blank value fails validation rather than
 * reading as unconfigured.
 */
async function loadVerifier(
  env: { appId?: string | null; verificationKey?: string | null } = {},
) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", typeof env.appId === "string" ? env.appId : APP_ID);
  vi.stubEnv(
    "PRIVY_VERIFICATION_KEY",
    typeof env.verificationKey === "string" ? env.verificationKey : (ours.publicKey as string),
  );
  if (env.appId === null) delete process.env["NEXT_PUBLIC_PRIVY_APP_ID"];
  if (env.verificationKey === null) delete process.env["PRIVY_VERIFICATION_KEY"];
  return import("./server");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("verifyPrivyToken", () => {
  it(
    "returns the DID from a well-formed token",
    async () => {
      const { verifyPrivyToken } = await loadVerifier();
      const session = await verifyPrivyToken(mintToken());
      expect(session.did).toBe(DID);
      expect(session.sessionId).toBe("session-fixture");
      expect(session.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    },
    // This case is first in the file, so it pays the entire cold cost of transforming and importing
    // the crypto stack. Alone that is about a second; under `turbo run test`, with nineteen packages
    // in parallel, it measured 6.6s — past vitest's 5s default, so it failed on a busy machine and
    // passed on an idle one. A budget rather than a fixture, because the work is real.
    20_000,
  );

  it("rejects a token minted for a different Privy app", async () => {
    // A valid signature over the wrong audience. A naive jwtVerify without an audience check accepts
    // this, and it is the reason the app id is passed to the verifier rather than assumed.
    const { verifyPrivyToken } = await loadVerifier();
    await expect(verifyPrivyToken(mintToken({ audience: "clsomeoneelsesapp" }))).rejects.toThrow(
      /could not be verified/,
    );
  });

  it("rejects an expired token", async () => {
    const { verifyPrivyToken } = await loadVerifier();
    await expect(verifyPrivyToken(mintToken({ expiresInSeconds: -60 }))).rejects.toThrow(
      /could not be verified/,
    );
  });

  it("rejects a token signed by another key", async () => {
    const { verifyPrivyToken } = await loadVerifier();
    await expect(
      verifyPrivyToken(mintToken({ signingKey: theirs.privateKey as string })),
    ).rejects.toThrow(/could not be verified/);
  });

  it("rejects a token whose payload was altered after signing", async () => {
    // Swap the subject in the payload and keep the original signature.
    const [header, , signature] = mintToken().split(".");
    const forgedPayload = base64url(
      JSON.stringify({
        iss: "privy.io",
        aud: APP_ID,
        sub: "did:privy:cmsomeoneelse00000000000",
        sid: "session-fixture",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
    const { verifyPrivyToken } = await loadVerifier();
    await expect(verifyPrivyToken(`${header}.${forgedPayload}.${signature}`)).rejects.toThrow(
      /could not be verified/,
    );
  });

  it("rejects a blank token without reaching the library", async () => {
    const { verifyPrivyToken } = await loadVerifier();
    await expect(verifyPrivyToken("   ")).rejects.toThrow(/could not be verified/);
  });

  it("refuses to verify anything when the deployment is not configured", async () => {
    // Absence of configuration must not read as "trust everyone". A well-formed, correctly signed
    // token is still refused, because there is no key to have checked it against.
    const missingKey = await loadVerifier({ verificationKey: null });
    expect(missingKey.privyVerificationConfigured()).toBe(false);
    await expect(missingKey.verifyPrivyToken(mintToken())).rejects.toThrow(/not configured/);

    const missingApp = await loadVerifier({ appId: null });
    expect(missingApp.privyVerificationConfigured()).toBe(false);
    await expect(missingApp.verifyPrivyToken(mintToken())).rejects.toThrow(/not configured/);
  });
});
