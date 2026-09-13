import { describe, expect, it, vi } from "vitest";
import { HeaderAuthenticator } from "../src/http.js";
import { createAuthenticator, PrivyAuthenticator } from "../src/privyAuth.js";

/**
 * `createAuthenticator` decides which authenticator guards a deployment that may hold a broadcast
 * key, so its failure modes matter more than its happy path. The half-configured case is the one
 * worth pinning: silently downgrading to the header authenticator there would accept spoofed
 * identities in a deployment whose operator was trying to avoid exactly that.
 */
describe("createAuthenticator", () => {
  const dev = () => new HeaderAuthenticator();

  it("selects the development authenticator when Privy is not configured", () => {
    expect(createAuthenticator({}, dev)).toBeInstanceOf(HeaderAuthenticator);
  });

  it("selects Privy when both credentials are present", () => {
    const authenticator = createAuthenticator(
      { PRIVY_APP_ID: "app-id", PRIVY_APP_SECRET: "privy_app_secret_x" },
      dev,
    );
    expect(authenticator).toBeInstanceOf(PrivyAuthenticator);
  });

  it("accepts a verification key without requiring it", () => {
    const withKey = createAuthenticator(
      { PRIVY_APP_ID: "a", PRIVY_APP_SECRET: "s", PRIVY_VERIFICATION_KEY: "-----BEGIN PUBLIC KEY-----" },
      dev,
    );
    expect(withKey).toBeInstanceOf(PrivyAuthenticator);
  });

  it("refuses a half-configured pair instead of falling back", () => {
    // The whole point: a typo must not become a service that trusts a header.
    expect(() => createAuthenticator({ PRIVY_APP_ID: "app-id" }, dev)).toThrow(/half-configured/);
    expect(() => createAuthenticator({ PRIVY_APP_SECRET: "secret" }, dev)).toThrow(/half-configured/);
  });

  it("treats blank strings as absent rather than configured", () => {
    // An unset variable in a Vercel project often arrives as "" rather than undefined.
    expect(createAuthenticator({ PRIVY_APP_ID: "  ", PRIVY_APP_SECRET: "" }, dev)).toBeInstanceOf(
      HeaderAuthenticator,
    );
  });
});

describe("PrivyAuthenticator", () => {
  /** A request stub carrying only what the authenticator reads. */
  function req(authorization?: string) {
    return {
      headers: authorization === undefined ? {} : { authorization },
      log: { warn: vi.fn() },
    } as never;
  }

  it("rejects a request with no bearer token", async () => {
    const authenticator = new PrivyAuthenticator({ appId: "a", appSecret: "s" });
    await expect(authenticator.authenticate(req())).rejects.toThrow(/Missing bearer token/);
  });

  it("rejects a header that is not a bearer token", async () => {
    const authenticator = new PrivyAuthenticator({ appId: "a", appSecret: "s" });
    await expect(authenticator.authenticate(req("Basic abc"))).rejects.toThrow(/Missing bearer token/);
  });

  it("reports a failed verification as a uniform 401", async () => {
    // A forged token and an expired one are different to an operator and identical to a caller:
    // neither may learn which they had.
    const authenticator = new PrivyAuthenticator({ appId: "a", appSecret: "privy_app_secret_x" });
    await expect(authenticator.authenticate(req("Bearer not-a-jwt"))).rejects.toThrow(
      /could not be verified/,
    );
  });
});
