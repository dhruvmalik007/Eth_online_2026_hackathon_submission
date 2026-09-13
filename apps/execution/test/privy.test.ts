/**
 * Phase 4 — the signing port and its Privy adapter.
 *
 * The tests are offline: `fetch` is injected and the authorization key is
 * generated per run. What they pin is the routing and the refusals — the two
 * places a signing layer goes wrong in ways that only show up in production, as
 * a signature that verifies nowhere or a transaction on the wrong chain.
 */
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PrivySignerError, PrivyWalletSigner, type WalletSigner } from "../src/privy.js";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

function signer(kind: "smart" | "eoa", fetchImpl: typeof fetch): PrivyWalletSigner {
  return new PrivyWalletSigner(kind, {
    appId: "app_test_123",
    authorizationKey: privateKey,
    fetchImpl,
  });
}

/** A fetch that records the call and replies with the given body. */
function stubFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

const TX = {
  walletId: "wallet_1",
  kind: "smart" as const,
  chainId: 137,
  to: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
  value: "0x0",
  data: "0xdeadbeef",
};

describe("the port is what the service depends on", () => {
  it("exposes both operations, because a userOp-only signer cannot trade Polymarket", () => {
    // A structural check on the contract rather than on Privy: the service codes
    // against this shape, so a provider swap cannot quietly drop typed-data.
    const fake: WalletSigner = {
      kind: "eoa",
      signTransaction: async (request) => ({ kind: request.kind, chainId: 1, hash: "0xabc" }),
      signTypedData: async () => "0xsignature",
    };
    expect(Object.keys(fake)).toContain("signTypedData");
  });
});

describe("PrivyWalletSigner — request shaping", () => {
  it("posts to the wallet RPC endpoint with the app id and a signature", async () => {
    const fetchImpl = stubFetch({ data: { hash: "0xtx", user_operation_hash: "0xop" } });
    await signer("smart", fetchImpl).signTransaction(TX);

    const call = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(call?.[0]).toBe("https://api.privy.io/v1/wallets/wallet_1/rpc");

    const headers = call?.[1].headers as Record<string, string>;
    expect(headers["privy-app-id"]).toBe("app_test_123");
    // The signature's exact encoding is Privy's to define; that it is present and
    // non-empty is the part our code controls.
    expect(headers["privy-authorization-signature"]).toBeTruthy();
  });

  it("pins the chain, so the calldata cannot land on another network", async () => {
    const fetchImpl = stubFetch({ data: { hash: "0xtx" } });
    await signer("smart", fetchImpl).signTransaction(TX);

    const body = JSON.parse(
      ((fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]?.[1]
        .body ?? "{}") as string,
    ) as { caip2?: string; method?: string };
    expect(body.caip2).toBe("eip155:137");
    expect(body.method).toBe("eth_sendTransaction");
  });

  it("returns the userOp hash for a smart account, and omits it for an EOA", async () => {
    const smart = await signer(
      "smart",
      stubFetch({ data: { hash: "0xtx", user_operation_hash: "0xop" } }),
    ).signTransaction(TX);
    expect(smart.userOperationHash).toBe("0xop");

    const eoa = await signer("eoa", stubFetch({ data: { hash: "0xtx" } })).signTransaction({
      ...TX,
      kind: "eoa",
    });
    expect(eoa.userOperationHash).toBeUndefined();
  });
});

describe("PrivyWalletSigner — refusals", () => {
  it("refuses typed data from a smart account", async () => {
    // The Polymarket constraint, as a test: an off-chain verifier checks the EOA,
    // so a smart-account signature verifies nowhere and the order is simply lost.
    await expect(
      signer("smart", stubFetch({ data: { signature: "0x" } })).signTypedData({
        walletId: "wallet_1",
        kind: "smart",
        typedData: {},
      }),
    ).rejects.toThrow(/requires an EOA/);
  });

  it("refuses a request whose kind does not match the signer's", async () => {
    await expect(
      signer("eoa", stubFetch({ data: { hash: "0xtx" } })).signTransaction({ ...TX, kind: "smart" }),
    ).rejects.toThrow(/handles "eoa" accounts/);
  });

  it("surfaces Privy's own message rather than a bare status", async () => {
    await expect(
      signer("smart", stubFetch({ error: { message: "wallet not found" } }, 404)).signTransaction(TX),
    ).rejects.toThrow(/wallet not found/);
  });

  it("refuses a success that carries no hash", async () => {
    await expect(signer("smart", stubFetch({ data: {} })).signTransaction(TX)).rejects.toThrow(
      /no transaction hash/,
    );
  });

  it("refuses an empty signature rather than returning it", async () => {
    await expect(
      signer("eoa", stubFetch({ data: { signature: "" } })).signTypedData({
        walletId: "wallet_1",
        kind: "eoa",
        typedData: {},
      }),
    ).rejects.toThrow(PrivySignerError);
  });
});
