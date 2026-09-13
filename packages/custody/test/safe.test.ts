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
import { DeviceActionStatus } from "@ledgerhq/device-management-kit";
import { of, Subject } from "rxjs";
import { SafeClient } from "../src/safe/SafeClient.js";
import {
  awaitDeviceAction,
  classifyDeviceError,
  encodeDeviceSignature,
  isDeviceRejection,
} from "../src/safe/LedgerSignerAdapter.js";
import type {
  DeviceActionHandle,
  LedgerSignerAdapter,
} from "../src/safe/LedgerSignerAdapter.js";
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

// ── the device-action bridge ────────────────────────────────────────────────
// The riskiest part of the DMK integration: a device action emits many states,
// so the naive `firstValueFrom` resolves on `NotStarted` — reporting success
// before the user has approved anything.

/** A device action that emits the given states in order. */
function handleOf<Output>(
  states: ReadonlyArray<{ status: DeviceActionStatus; output?: Output; error?: unknown }>,
): DeviceActionHandle<Output> {
  return { observable: of(...states), cancel: () => undefined };
}

describe("awaitDeviceAction", () => {
  it("waits past non-terminal states instead of resolving on the first emission", async () => {
    const output = await awaitDeviceAction(
      handleOf<{ address: string }>([
        { status: DeviceActionStatus.NotStarted },
        { status: DeviceActionStatus.Pending },
        { status: DeviceActionStatus.Completed, output: { address: "0xabc" } },
      ]),
      1_000,
    );
    expect(output).toEqual({ address: "0xabc" });
  });

  it("resolves to undefined when the action only needed confirmation", async () => {
    const output = await awaitDeviceAction(
      handleOf<void>([{ status: DeviceActionStatus.Completed }]),
      1_000,
    );
    expect(output).toBeUndefined();
  });

  it("reports a user rejection distinctly from a failure", async () => {
    await expect(
      awaitDeviceAction(
        handleOf<unknown>([
          { status: DeviceActionStatus.Error, error: { _tag: "RefusedByUserDAError" } },
        ]),
        1_000,
      ),
    ).rejects.toThrow(/cancelled on the device/i);
  });

  it("maps a device error to an actionable message", async () => {
    await expect(
      awaitDeviceAction(
        handleOf<unknown>([{ status: DeviceActionStatus.Error, error: { errorCode: "6807" } }]),
        1_000,
      ),
    ).rejects.toThrow(/not installed/i);
  });

  it("treats a stopped action as cancelled", async () => {
    await expect(
      awaitDeviceAction(handleOf<unknown>([{ status: DeviceActionStatus.Stopped }]), 1_000),
    ).rejects.toThrow(/cancelled on the device/i);
  });

  it("times out and cancels a device that never answers", async () => {
    let cancelled = false;
    await expect(
      awaitDeviceAction(
        {
          observable: new Subject<{ status: DeviceActionStatus }>(),
          cancel: () => {
            cancelled = true;
          },
        },
        10,
      ),
    ).rejects.toThrow(/Timed out/i);
    expect(cancelled).toBe(true);
  });
});

describe("isDeviceRejection", () => {
  it("recognises each documented rejection shape", () => {
    expect(isDeviceRejection({ _tag: "RefusedByUserDAError" })).toBe(true);
    expect(isDeviceRejection({ errorCode: "5501" })).toBe(true);
    expect(isDeviceRejection({ errorCode: "6985" })).toBe(true);
    // Unrecognised codes are buried inside originalError.
    expect(
      isDeviceRejection({
        _tag: "UnknownDeviceExchangeError",
        originalError: { errorCode: "6985" },
      }),
    ).toBe(true);
  });

  it("does not mistake a genuine failure for a rejection", () => {
    expect(isDeviceRejection({ _tag: "DeviceLockedError", errorCode: "5515" })).toBe(false);
    expect(isDeviceRejection(null)).toBe(false);
  });
});

describe("classifyDeviceError", () => {
  it("maps the locked, missing-app and blind-signing cases", () => {
    expect(classifyDeviceError({ _tag: "DeviceLockedError" })).toMatch(/locked/i);
    expect(classifyDeviceError({ errorCode: "6807" })).toMatch(/not installed/i);
    expect(classifyDeviceError({ errorCode: "6a80" })).toMatch(/blind signing/i);
  });

  it("falls back to a neutral message rather than leaking raw detail", () => {
    expect(classifyDeviceError({ something: "internal" })).toMatch(/unexpected error/i);
  });
});

describe("encodeDeviceSignature recovery ids", () => {
  it("accepts the 0/1 form as well as 27/28", () => {
    expect(encodeDeviceSignature(1, "aa".repeat(32), "bb".repeat(32))).toMatch(/01$/);
  });

  it("rejects an id that is neither, rather than emitting a bad signature", () => {
    expect(() => encodeDeviceSignature(29, "aa".repeat(32), "bb".repeat(32))).toThrow(
      /recovery id/,
    );
  });
});
