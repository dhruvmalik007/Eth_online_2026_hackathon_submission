/**
 * The vault rules, tested offline.
 *
 * Every fixture here mirrors something the real Morpho API returns: a zero-asset
 * vault, a vault holding the wrong stablecoin, and — in the ranking tests — a
 * vault reporting an APY high enough that selecting it would be a bug rather than
 * a win.
 */

import { describe, expect, it } from "vitest";
import {
  chooseVault,
  validateVault,
  type Address,
  type MorphoVaultRef,
  type VaultCandidate,
  type VaultReadings,
} from "../src/index.js";

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7" as const;
const VAULT_A = "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB" as const;
const VAULT_B = "0xdd0f28e19C1780eb6396170735D45153D261490d" as const;
/** Deliberately lower than VAULT_B, to pin the tie-break by address. */
const VAULT_C = "0xaa0f28e19C1780eb6396170735D45153D261490d" as const;

function readings(overrides: Partial<VaultReadings> = {}): VaultReadings {
  return {
    address: VAULT_A,
    asset: USDC,
    shareDecimals: 18,
    totalAssets: 67_827_752_000_000n,
    totalSupply: 61_000_000_000_000n,
    oneShareToAssets: 1_100_000n,
    ...overrides,
  };
}

function candidate(
  address: Address,
  options: {
    readonly smoothedApyBps?: number;
    readonly redeemable?: boolean;
    readonly live?: boolean;
  } = {},
): VaultCandidate {
  const ref: MorphoVaultRef = {
    address,
    name: `vault ${address.slice(0, 6)}`,
    asset: USDC,
    observedTotalAssetsUsdc: 1_000_000,
    observedApyPct: 4,
    source: "test fixture",
  };

  const source = readings(options.live === false ? { address, totalAssets: 0n } : { address });

  return {
    ref,
    validity: validateVault(source, { address, asset: USDC }),
    redeemable: options.redeemable ?? true,
    ...(options.smoothedApyBps === undefined ? {} : { smoothedApyBps: options.smoothedApyBps }),
  };
}

describe("validateVault", () => {
  it("rejects an address with no code", () => {
    const verdict = validateVault(null, { address: VAULT_A, asset: USDC });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("no_code");
  });

  it("rejects a vault whose asset() is the zero address", () => {
    const verdict = validateVault(readings({ asset: "0x0000000000000000000000000000000000000000" }), {
      address: VAULT_A,
      asset: USDC,
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("asset_unreadable");
  });

  it("rejects a live, liquid vault that holds the wrong stablecoin", () => {
    // The mistake that matters most: a USDT vault is not a worse USDC vault, it
    // is not a USDC vault. Depositing would silently change the book's currency
    // exposure while every other check passes.
    const verdict = validateVault(readings({ asset: USDT }), { address: VAULT_A, asset: USDC });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("asset_mismatch");
    expect(verdict.detail).toContain(USDT);
  });

  it("rejects a vault with no assets", () => {
    // The most common thing the API returns, and the reason a naive
    // `totalAssets`-ordered query is unsafe to consume directly.
    const verdict = validateVault(readings({ totalAssets: 0n }), { address: VAULT_A, asset: USDC });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("empty");
  });

  it("rejects a vault whose share is worthless", () => {
    const verdict = validateVault(readings({ oneShareToAssets: 0n }), { address: VAULT_A, asset: USDC });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("no_share_value");
  });

  it("rejects an unexpected share-decimals reading", () => {
    const verdict = validateVault(readings({ shareDecimals: 6 }), {
      address: VAULT_A,
      asset: USDC,
      shareDecimals: 18,
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("decimals_mismatch");
  });

  it("accepts a live vault holding the expected asset, and passes the readings through", () => {
    const source = readings();
    const verdict = validateVault(source, { address: VAULT_A, asset: USDC });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error("unreachable");
    expect(verdict.readings).toBe(source);
  });
});

describe("chooseVault", () => {
  it("picks the highest trailing-mean yield", () => {
    const choice = chooseVault([
      candidate(VAULT_A, { smoothedApyBps: 409 }),
      candidate(VAULT_B, { smoothedApyBps: 410 }),
    ]);
    expect(choice.chosen?.ref.address).toBe(VAULT_B);
    expect(choice.rejected.map((entry) => entry.reason)).toEqual(["lower_yield"]);
  });

  it("rejects an implausible yield rather than chasing it", () => {
    // The real API reports 297,995% on several vaults. A "highest yield wins"
    // rule without a plausibility bound selects garbage, which is why the bound
    // is load-bearing rather than defensive padding.
    const choice = chooseVault([
      candidate(VAULT_A, { smoothedApyBps: 409 }),
      candidate(VAULT_B, { smoothedApyBps: 2_979_958 }),
    ]);
    expect(choice.chosen?.ref.address).toBe(VAULT_A);
    expect(choice.rejected[0]?.reason).toBe("implausible_yield");
    expect(choice.rejected[0]?.detail).toContain("plausibility bound");
  });

  it("excludes a vault it cannot redeem from, rather than down-ranking it", () => {
    // A vault we cannot exit is a trap, not a worse destination.
    const choice = chooseVault([
      candidate(VAULT_A, { smoothedApyBps: 500, redeemable: false }),
      candidate(VAULT_B, { smoothedApyBps: 400 }),
    ]);
    expect(choice.chosen?.ref.address).toBe(VAULT_B);
    expect(choice.rejected[0]?.reason).toBe("not_redeemable");
  });

  it("propagates the validity reason for an unfit vault", () => {
    const choice = chooseVault([candidate(VAULT_A, { live: false, smoothedApyBps: 900 })]);
    expect(choice.chosen).toBeNull();
    expect(choice.rejected[0]?.reason).toBe("empty");
  });

  it("rejects a vault with no measured yield", () => {
    const choice = chooseVault([candidate(VAULT_A)]);
    expect(choice.chosen).toBeNull();
    expect(choice.rejected[0]?.reason).toBe("no_yield_reading");
  });

  it("breaks a tie by address, so the same state yields the same choice", () => {
    // Determinism matters: a policy that reorders on a tie produces a different
    // plan for identical inputs, which makes the evidence unreproducible.
    const higher = candidate(VAULT_B, { smoothedApyBps: 410 });
    const lower = candidate(VAULT_C, { smoothedApyBps: 410 });
    expect(chooseVault([higher, lower]).chosen?.ref.address).toBe(VAULT_C);
    expect(chooseVault([lower, higher]).chosen?.ref.address).toBe(VAULT_C);
  });

  it("returns null with an empty rejection list when given nothing", () => {
    // Not an error: `decideFlight` reads an empty list as "no venue on this chain".
    expect(chooseVault([])).toEqual({ chosen: null, rejected: [] });
  });
});
