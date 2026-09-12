/**
 * Tests for the Safe custody layer.
 *
 * Scope note: a Ledger device and a live chain are both absent here, so these
 * cover what is *decidable without them* — signature encoding, owner
 * derivation, the mode split, and the constructor's guards. The end-to-end
 * proposal path is exercised by `scripts/smoke-dry.ts`, which needs an RPC.
 */
import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { SafeClient } from "../src/safe/SafeClient.js";
import { encodeDeviceSignature } from "../src/safe/LedgerSignerAdapter.js";
import type { LedgerSignerAdapter } from "../src/safe/LedgerSignerAdapter.js";
import { safeOwners, loadEnv } from "../src/config/env.js";
import { isAddress } from "../src/utils/address.js";

/** A public client stand-in. Construction reads only `chain.id`. */
function fakePublicClient(chainId: number): PublicClient {
  return { chain: { id: chainId } } as unknown as PublicClient;
}

/** A device stand-in answering with a fixed address; no transport involved. */
function fakeLedger(address: `0x${string}`): LedgerSignerAdapter {
  return { address: async () => address } as unknown as LedgerSignerAdapter;
}

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const SECOND_OWNER = "0x2222222222222222222222222222222222222222" as const;

describe("encodeDeviceSignature", () => {
  const r = "aa".repeat(32);
  const s = "bb".repeat(32);

  it("packs v as a single byte after r and s, normalised from the 27/28 form", () => {
    // Golden values: the device returns v in the 27/28 form; Safe expects the
    // 0/1 recovery id appended to r||s.
    expect(encodeDeviceSignature(27, r, s)).toBe(`0x${r}${s}00`);
    expect(encodeDeviceSignature(28, r, s)).toBe(`0x${r}${s}01`);
  });

  it("produces 65 bytes of signature material", () => {
    // 0x + 32-byte r + 32-byte s + 1-byte v
    expect(encodeDeviceSignature(27, r, s)).toHaveLength(2 + 64 + 64 + 2);
  });
});

describe("isAddress", () => {
  it("accepts a 20-byte hex address in either case", () => {
    expect(isAddress(OWNER)).toBe(true);
    expect(isAddress(OWNER.toUpperCase().replace("0X", "0x"))).toBe(true);
  });

  it("rejects short, long and non-hex values", () => {
    expect(isAddress("0x1234")).toBe(false);
    expect(isAddress(`${OWNER}00`)).toBe(false);
    expect(isAddress("0x" + "zz".repeat(20))).toBe(false);
    expect(isAddress("not-an-address")).toBe(false);
  });
});

describe("safeOwners", () => {
  const envWith = (owners: string | undefined) =>
    loadEnv({ ...process.env, CUSTODY_SAFE_OWNERS: owners } as NodeJS.ProcessEnv);

  it("returns null when unset, so the caller falls back to the resolved owner", () => {
    expect(safeOwners(envWith(undefined))).toBeNull();
  });

  it("returns null for an empty or whitespace-only value", () => {
    expect(safeOwners(envWith(""))).toBeNull();
    expect(safeOwners(envWith("  ,  "))).toBeNull();
  });

  it("parses a comma-separated owner set and trims entries", () => {
    expect(safeOwners(envWith(`${OWNER}, ${SECOND_OWNER}`))).toEqual([OWNER, SECOND_OWNER]);
  });

  it("fails loudly on a malformed address rather than building an unusable Safe", () => {
    expect(() => safeOwners(envWith(`${OWNER},0xnope`))).toThrow(/invalid address: 0xnope/);
  });
});

describe("SafeClient construction", () => {
  it("requires a chain on the public client", () => {
    expect(
      () => new SafeClient({ publicClient: fakePublicClient(0), ownerAddress: OWNER }),
    ).toThrow(/requires a public client with a chain set/);
  });

  it("is dry when an owner address is supplied, with no device", () => {
    const client = new SafeClient({
      publicClient: fakePublicClient(11155111),
      ownerAddress: OWNER,
    });
    expect(client.mode).toBe("dry");
  });

  it("is live when a device-backed owner is supplied", () => {
    const client = new SafeClient({
      publicClient: fakePublicClient(11155111),
      ledger: fakeLedger(OWNER),
    });
    expect(client.mode).toBe("live");
  });

  it("resolves the owner from config in dry mode", async () => {
    const client = new SafeClient({
      publicClient: fakePublicClient(11155111),
      ownerAddress: OWNER,
    });
    await expect(client.ownerAddress()).resolves.toBe(OWNER);
  });

  it("resolves the owner from the device in live mode", async () => {
    const client = new SafeClient({
      publicClient: fakePublicClient(11155111),
      ledger: fakeLedger(SECOND_OWNER),
    });
    await expect(client.ownerAddress()).resolves.toBe(SECOND_OWNER);
  });

  it("refuses to sign in dry mode, naming the reason", async () => {
    const client = new SafeClient({
      publicClient: fakePublicClient(11155111),
      ownerAddress: OWNER,
    });
    // The transaction argument is never reached: the mode check comes first.
    await expect(client.signWithLedger({} as never)).rejects.toThrow(/dry mode/);
  });
});
