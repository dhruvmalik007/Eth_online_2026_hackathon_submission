/**
 * The signer port and its implementations.
 *
 * No network, no custodian, no hardware: `LocalKeySigner` is a real ECDSA signer
 * over a test key, and `PrivyWalletSigner` is exercised through its transport
 * port with a fake. That split is deliberate — it means a failure later against
 * real Privy is a *transport* problem, not a cryptographic one.
 */
import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import type { Eip712TypedData } from "../src/eip712.js";
import { LocalKeySigner } from "../src/safe/LocalKeySigner.js";
import {
  PrivyWalletSigner,
  normalizeAuthorizationKey,
  type PrivySigningTransport,
} from "../src/safe/PrivyWalletSigner.js";
import { SafeSignerError } from "../src/safe/SafeTypedDataSigner.js";
import {
  encodeSignature,
  normalizeRecoveryId,
  splitSignature,
  toSafeSignature,
} from "../src/safe/signature.js";
import { toViemTypedData } from "../src/safe/viemEip712.js";

/** Hardhat account #1 — a public, worthless test key. */
const TEST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const TEST_ADDRESS = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as const;

const SAFE = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

/** A SafeTx payload, shaped exactly as protocol-kit generates one. */
const TYPED_DATA: Eip712TypedData = {
  domain: { chainId: 11155111, verifyingContract: SAFE },
  types: {
    SafeTx: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "nonce", type: "uint256" },
    ],
  },
  primaryType: "SafeTx",
  message: {
    to: RECIPIENT,
    value: "0",
    data: "0x",
    operation: 0,
    nonce: 7,
  },
};

describe("signature encoding", () => {
  const r = "aa".repeat(32);
  const s = "bb".repeat(32);

  it("normalises both the 0/1 and 27/28 recovery forms", () => {
    expect(normalizeRecoveryId(0)).toBe(0);
    expect(normalizeRecoveryId(1)).toBe(1);
    expect(normalizeRecoveryId(27)).toBe(0);
    expect(normalizeRecoveryId(28)).toBe(1);
  });

  it("rejects an id that is neither, rather than emitting an invalid signature", () => {
    expect(() => normalizeRecoveryId(29)).toThrow(/recovery id/);
  });

  it("packs r||s||v into 65 bytes", () => {
    expect(encodeSignature(27, r, s)).toBe(`0x${r}${s}00`);
    expect(encodeSignature(28, r, s)).toHaveLength(132);
  });

  it("splits and re-normalises a packed signature", () => {
    const packed = `0x${r}${s}01` as const;
    expect(splitSignature(packed)).toEqual({ r: `0x${r}`, s: `0x${s}`, v: 1 });
    expect(toSafeSignature(packed)).toBe(packed);
  });

  it("rejects a signature that is not 65 bytes", () => {
    expect(() => splitSignature("0xdeadbeef")).toThrow(/65-byte/);
  });
});

describe("LocalKeySigner", () => {
  it("derives the owner address from the key, lower-cased", async () => {
    const signer = new LocalKeySigner(TEST_KEY, { acknowledgeInsecureKey: true });
    expect(signer.kind).toBe("local-key");
    await expect(signer.address()).resolves.toBe(TEST_ADDRESS);
  });

  it("produces a Safe-packed signature identical to signing the same payload directly", async () => {
    const signer = new LocalKeySigner(TEST_KEY, { acknowledgeInsecureKey: true });
    const expected = toSafeSignature(
      await privateKeyToAccount(TEST_KEY).signTypedData(toViemTypedData(TYPED_DATA)),
    );
    await expect(signer.signTypedData(TYPED_DATA)).resolves.toBe(expected);
  });

  it("signs something that recovers to the owner — the property that matters", async () => {
    const signer = new LocalKeySigner(TEST_KEY, { acknowledgeInsecureKey: true });
    const signature = await signer.signTypedData(TYPED_DATA);
    const recovered = await recoverTypedDataAddress({
      ...toViemTypedData(TYPED_DATA),
      signature,
    } as Parameters<typeof recoverTypedDataAddress>[0]);
    expect(recovered.toLowerCase()).toBe(TEST_ADDRESS);
  });

  it("strips EIP712Domain from the types rather than letting viem reject it", async () => {
    const signer = new LocalKeySigner(TEST_KEY, { acknowledgeInsecureKey: true });
    const withDomainType: Eip712TypedData = {
      ...TYPED_DATA,
      types: {
        EIP712Domain: [{ name: "chainId", type: "uint256" }],
        ...TYPED_DATA.types,
      },
    };
    await expect(signer.signTypedData(withDomainType)).resolves.toMatch(/^0x[0-9a-f]{130}$/);
  });
});

describe("PrivyWalletSigner", () => {
  function fakeTransport(signature: string): PrivySigningTransport & { calls: unknown[] } {
    const calls: unknown[] = [];
    return {
      calls,
      signTypedData: vi.fn(async (input) => {
        calls.push(input);
        return signature;
      }),
    };
  }

  it("passes the typed data through and normalises the returned signature", async () => {
    const transport = fakeTransport(`0x${"aa".repeat(32)}${"bb".repeat(32)}1c`);
    const signer = new PrivyWalletSigner({
      walletId: "wallet-1",
      authorizationPrivateKey: "wallet-auth:AbC123",
      knownAddress: TEST_ADDRESS,
      transport,
    });

    const signature = await signer.signTypedData(TYPED_DATA);

    // 1c (28) must become 01 — a Safe reads the recovery id as 0/1.
    expect(signature.endsWith("01")).toBe(true);
    expect(signature).toHaveLength(132);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toMatchObject({
      walletId: "wallet-1",
      authorizationPrivateKey: "AbC123",
    });
  });

  it("requires the wallet address rather than inventing one", async () => {
    const signer = new PrivyWalletSigner({
      walletId: "wallet-1",
      authorizationPrivateKey: "key",
      transport: fakeTransport(`0x${"aa".repeat(65)}`),
    });
    await expect(signer.address()).rejects.toBeInstanceOf(SafeSignerError);
  });

  it("refuses to construct without a wallet id or authorization key", () => {
    expect(
      () =>
        new PrivyWalletSigner({
          walletId: "",
          authorizationPrivateKey: "key",
          transport: fakeTransport("0x"),
        }),
    ).toThrow(/wallet id/);
    expect(
      () =>
        new PrivyWalletSigner({
          walletId: "wallet-1",
          authorizationPrivateKey: "  ",
          transport: fakeTransport("0x"),
        }),
    ).toThrow(/authorization key/);
  });

  it("never leaks the authorization key in a failure message", async () => {
    const transport: PrivySigningTransport = {
      signTypedData: async () => {
        throw new Error("401 for wallet-auth:SUPERSECRETKEY123 — policy denied");
      },
    };
    const signer = new PrivyWalletSigner({
      walletId: "wallet-1",
      authorizationPrivateKey: "wallet-auth:SUPERSECRETKEY123",
      knownAddress: TEST_ADDRESS,
      transport,
    });

    await expect(signer.signTypedData(TYPED_DATA)).rejects.toThrow(/policy allows/) ;
    try {
      await signer.signTypedData(TYPED_DATA);
    } catch (error) {
      expect((error as SafeSignerError).debug).not.toContain("SUPERSECRETKEY123");
      expect((error as SafeSignerError).debug).toContain("[redacted]");
    }
  });

  it("normalises a prefixed authorization key exactly once", () => {
    expect(normalizeAuthorizationKey("wallet-auth:AAAA")).toBe("AAAA");
    expect(normalizeAuthorizationKey("AAAA")).toBe("AAAA");
  });
});
