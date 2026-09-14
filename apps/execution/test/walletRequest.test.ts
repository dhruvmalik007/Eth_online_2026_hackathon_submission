/**
 * The gate that decides what a WalletConnect session may sign.
 *
 * These are the tests that matter most in this feature: the browser side can only ask, so every
 * refusal here is the difference between a dapp that can move an allowlisted position and one that
 * can move anything the key can reach.
 */
import { describe, expect, it } from "vitest";
import type { EvmSigner, EvmTypedDataPayload } from "../src/evmSigner.js";
import {
  WALLET_CHAIN_REF,
  WALLET_MAX_VALUE_WEI,
  WALLET_TARGET_ALLOWLIST,
  evaluateWalletRequest,
  executeWalletRequest,
  parseTypedData,
} from "../src/walletRequest.js";

const AAVE_POOL = WALLET_TARGET_ALLOWLIST[0] as string;
const STRANGER = "0x1111111111111111111111111111111111111111";

function send(to: string, value?: string) {
  return { method: "eth_sendTransaction", chainId: WALLET_CHAIN_REF, params: [{ to, ...(value === undefined ? {} : { value }) }] };
}

class FakeSigner implements EvmSigner {
  calls: string[] = [];

  async getAddress(): Promise<`0x${string}`> {
    this.calls.push("getAddress");
    return "0x63185C0f059dE46DBeEa6813ab461A8863E40e21";
  }

  async signTypedData(_payload: EvmTypedDataPayload): Promise<`0x${string}`> {
    this.calls.push("signTypedData");
    return "0xsignature";
  }

  async signMessage(_message: `0x${string}`): Promise<`0x${string}`> {
    this.calls.push("signMessage");
    return "0xsignature";
  }

  async sendTransaction(): Promise<{ transactionHash: string }> {
    this.calls.push("sendTransaction");
    return { transactionHash: "0xhash" };
  }
}

describe("evaluateWalletRequest", () => {
  it("refuses blind signing, naming the reason", () => {
    const decision = evaluateWalletRequest({ method: "eth_sign", chainId: WALLET_CHAIN_REF, params: [] });
    expect(decision).toMatchObject({ ok: false });
    if (!decision.ok) expect(decision.reason).toContain("pre-hashed");
  });

  it("refuses a signed transaction the dapp could broadcast later", () => {
    const decision = evaluateWalletRequest({ method: "eth_signTransaction", chainId: WALLET_CHAIN_REF, params: [] });
    expect(decision.ok).toBe(false);
  });

  it("refuses another chain instead of switching to it", () => {
    const decision = evaluateWalletRequest({ method: "eth_chainId", chainId: "eip155:1", params: [] });
    expect(decision).toMatchObject({ ok: false });
    if (!decision.ok) expect(decision.reason).toContain("eip155:1");
  });

  it("refuses an unknown method rather than guessing", () => {
    expect(evaluateWalletRequest({ method: "eth_getBalance", chainId: WALLET_CHAIN_REF, params: [] }).ok).toBe(false);
  });

  it("allows a transaction to an allowlisted contract", () => {
    expect(evaluateWalletRequest(send(AAVE_POOL)).ok).toBe(true);
  });

  it("refuses a transaction to a contract we never called", () => {
    const decision = evaluateWalletRequest(send(STRANGER));
    expect(decision).toMatchObject({ ok: false });
    if (!decision.ok) expect(decision.reason).toContain(STRANGER);
  });

  it("refuses native value above the ceiling", () => {
    const over = (WALLET_MAX_VALUE_WEI + 1n).toString();
    const decision = evaluateWalletRequest(send(AAVE_POOL, over));
    expect(decision).toMatchObject({ ok: false });
    if (!decision.ok) expect(decision.reason).toContain("ceiling");
  });

  it("allows value at the ceiling", () => {
    expect(evaluateWalletRequest(send(AAVE_POOL, WALLET_MAX_VALUE_WEI.toString())).ok).toBe(true);
  });

  it("refuses typed data whose verifying contract is not allowlisted", () => {
    const params = ["0x6318", JSON.stringify({ domain: { verifyingContract: STRANGER }, types: {}, primaryType: "Permit", message: {} })];
    const decision = evaluateWalletRequest({ method: "eth_signTypedData_v4", chainId: WALLET_CHAIN_REF, params });
    expect(decision).toMatchObject({ ok: false });
    if (!decision.ok) expect(decision.reason).toContain(STRANGER);
  });

  it("allows typed data against an allowlisted contract", () => {
    const params = ["0x6318", JSON.stringify({ domain: { verifyingContract: AAVE_POOL }, types: {}, primaryType: "Permit", message: {} })];
    expect(evaluateWalletRequest({ method: "eth_signTypedData_v4", chainId: WALLET_CHAIN_REF, params }).ok).toBe(true);
  });
});

describe("parseTypedData", () => {
  it("rejects unparseable and structurally incomplete payloads", () => {
    expect(parseTypedData(["0x6318", "not json"])).toBeUndefined();
    expect(parseTypedData(["0x6318", JSON.stringify({ domain: {} })])).toBeUndefined();
    expect(parseTypedData("nope")).toBeUndefined();
  });
});

describe("executeWalletRequest", () => {
  it("answers account and chain questions without touching the key", async () => {
    const signer = new FakeSigner();
    const accounts = await executeWalletRequest(signer, { method: "eth_accounts", chainId: WALLET_CHAIN_REF, params: [] });
    const chain = await executeWalletRequest(signer, { method: "eth_chainId", chainId: WALLET_CHAIN_REF, params: [] });

    expect(accounts).toEqual(["0x63185C0f059dE46DBeEa6813ab461A8863E40e21"]);
    expect(chain).toBe("0x89");
    // getAddress is a read; the point is that neither call signed anything.
    expect(signer.calls).not.toContain("signMessage");
    expect(signer.calls).not.toContain("signTypedData");
    expect(signer.calls).not.toContain("sendTransaction");
  });

  it("signs a message and sends a transaction through the signer", async () => {
    const signer = new FakeSigner();
    const signature = await executeWalletRequest(signer, { method: "personal_sign", chainId: WALLET_CHAIN_REF, params: ["0xdeadbeef"] });
    const hash = await executeWalletRequest(signer, send(AAVE_POOL));

    expect(signature).toBe("0xsignature");
    expect(hash).toBe("0xhash");
    expect(signer.calls).toEqual(["signMessage", "sendTransaction"]);
  });
});
