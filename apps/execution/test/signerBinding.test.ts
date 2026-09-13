import { describe, expect, it } from "vitest";
import {
  bindSigner,
  DEFAULT_SIGNER_CHAIN,
  signerChainByName,
} from "../src/signerBinding.js";

/**
 * `bindSigner` decides whether a deployment can move funds, so its failure modes carry more weight
 * than its happy path. The two worth pinning are the ones that would otherwise be silent: a
 * malformed key that reads as "no signer", and a fallback that masks a broken primary.
 */
const KEY_A = `0x${"11".repeat(32)}` as const;
const KEY_B = `0x${"22".repeat(32)}` as const;

describe("bindSigner", () => {
  it("returns undefined when no key is configured", () => {
    // Keeps the existing behaviour: the two routes that need a signer answer 503, which is a
    // deployment statement rather than a failed operation.
    expect(bindSigner({})).toBeUndefined();
  });

  it("treats a blank key as absent", () => {
    expect(bindSigner({ EXECUTION_SIGNER_PRIVATE_KEY: "   " })).toBeUndefined();
  });

  it("binds the primary key when present", async () => {
    const bound = bindSigner({ EXECUTION_SIGNER_PRIVATE_KEY: KEY_A });
    expect(bound?.source).toBe("primary");
    expect(await bound?.signer.getAddress()).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("accepts a key without the 0x prefix", async () => {
    const bound = bindSigner({ EXECUTION_SIGNER_PRIVATE_KEY: "11".repeat(32) });
    expect(await bound?.signer.getAddress()).toBe(
      await bindSigner({ EXECUTION_SIGNER_PRIVATE_KEY: KEY_A })?.signer.getAddress(),
    );
  });

  it("uses the fallback only when the primary is absent", () => {
    const bound = bindSigner({ EXECUTION_FALLBACK_SIGNER_PRIVATE_KEY: KEY_B });
    expect(bound?.source).toBe("fallback");
  });

  it("prefers the primary over the fallback", () => {
    const bound = bindSigner({
      EXECUTION_SIGNER_PRIVATE_KEY: KEY_A,
      EXECUTION_FALLBACK_SIGNER_PRIVATE_KEY: KEY_B,
    });
    expect(bound?.source).toBe("primary");
  });

  it("throws on a malformed primary rather than falling back to the fallback", () => {
    // The important one. Silently swapping keys would hide a typo behind a deployment that still
    // works — until the day the fallback is empty too, and the failure surfaces at the worst moment.
    expect(() =>
      bindSigner({
        EXECUTION_SIGNER_PRIVATE_KEY: "not-a-key",
        EXECUTION_FALLBACK_SIGNER_PRIVATE_KEY: KEY_B,
      }),
    ).toThrow(/EXECUTION_SIGNER_PRIVATE_KEY is set but is not a 32-byte hex private key/);
  });

  it("names the variable that was wrong", () => {
    expect(() => bindSigner({ EXECUTION_FALLBACK_SIGNER_PRIVATE_KEY: "0xdead" })).toThrow(
      /EXECUTION_FALLBACK_SIGNER_PRIVATE_KEY/,
    );
  });

  it("defaults to the chain the demonstration wallet is funded on", () => {
    const bound = bindSigner({ EXECUTION_SIGNER_PRIVATE_KEY: KEY_A });
    expect(bound?.chain.name.toLowerCase()).toContain("base sepolia");
    expect(DEFAULT_SIGNER_CHAIN).toBe("base-sepolia");
  });

  it("honours an explicit chain, case-insensitively", () => {
    expect(bindSigner({ EXECUTION_SIGNER_PRIVATE_KEY: KEY_A, EXECUTION_SIGNER_CHAIN: "Polygon-Amoy" })?.chain.id).toBe(80002);
  });

  it("rejects an unknown chain by name, listing the known ones", () => {
    expect(() =>
      bindSigner({ EXECUTION_SIGNER_PRIVATE_KEY: KEY_A, EXECUTION_SIGNER_CHAIN: "dogechain" }),
    ).toThrow(/Unknown EXECUTION_SIGNER_CHAIN "dogechain".*Known chains:/s);
  });
});

describe("signerChainByName", () => {
  it("resolves the demo chains", () => {
    expect(signerChainByName("base-sepolia").id).toBe(84532);
    expect(signerChainByName("base").id).toBe(8453);
    expect(signerChainByName("polygon-amoy").id).toBe(80002);
  });
});
