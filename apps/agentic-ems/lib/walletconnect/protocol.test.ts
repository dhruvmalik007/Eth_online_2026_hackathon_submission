import { describe, expect, it } from "vitest";
import { ALLOWED_CHAIN_ID, buildNamespaces, parsePairingUri, refusalFor } from "./protocol";

describe("refusalFor", () => {
  it("refuses blind signing, with a reason a user can act on", () => {
    const reason = refusalFor("eth_sign");
    expect(reason).toContain("Blind signing");
  });

  it("refuses pre-signed transactions and chain switching", () => {
    expect(refusalFor("eth_signTransaction")).toBeTruthy();
    expect(refusalFor("wallet_switchEthereumChain")).toBeTruthy();
    expect(refusalFor("wallet_addEthereumChain")).toBeTruthy();
  });

  it("allows the methods the bridge exists to answer", () => {
    for (const method of ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4", "eth_chainId"]) {
      expect(refusalFor(method)).toBeNull();
    }
  });

  it("refuses anything else rather than guessing", () => {
    expect(refusalFor("eth_getBalance")).toBe("Unsupported method: eth_getBalance.");
  });
});

describe("parsePairingUri", () => {
  it("accepts a v2 uri", () => {
    const result = parsePairingUri("  wc:abc123@2?relay-protocol=irn&symKey=def  ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.uri).toBe("wc:abc123@2?relay-protocol=irn&symKey=def");
  });

  it("explains an empty box, a non-wc string and a v1 uri", () => {
    expect(parsePairingUri("")).toEqual({ ok: false, reason: "Paste the WalletConnect URI from the dapp first." });
    expect(parsePairingUri("https://app.morpho.org")).toMatchObject({ ok: false });
    expect(parsePairingUri("wc:abc@1?x=1")).toMatchObject({ ok: false, reason: expect.stringContaining("v1") });
  });
});

describe("buildNamespaces", () => {
  it("scopes the session to one chain and one account", () => {
    const namespaces = buildNamespaces(ALLOWED_CHAIN_ID, "0xABC");
    const eip155 = namespaces["eip155"];
    expect(eip155).toBeDefined();
    expect(eip155?.chains).toEqual(["eip155:137"]);
    expect(eip155?.accounts).toEqual(["eip155:137:0xABC"]);
    // The namespace advertises only what we will answer; a wider list would invite requests we refuse.
    expect(eip155?.methods).not.toContain("eth_sign");
  });
});
