/**
 * P1 — the position readers.
 *
 * The expected values are the values read from Polygon for the wallet this workspace executed
 * against, so these tests pin the readers to real chain state rather than to a shape they made up:
 *
 *   aPolUSDCn.balanceOf(signer) = 120005      -> 0.120005 USDC  (two supplies plus interest)
 *   mevUSDC.balanceOf(signer)   = 0.015e18    -> 0.015 shares
 *   mevUSDC.totalAssets()       = 8767619     -> 8.767619 USDC  (the vault is small)
 *   mevUSDC.convertToAssets()   = 15000       -> 0.015 USDC
 *
 * The reader is a port, so none of this touches the network.
 */
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  readAaveV3Supplied,
  readKnownPositions,
  readMorphoVaultPosition,
  type WalletReader,
} from "../src/index.js";

const USER = "0x63185C0f059dE46DBeEa6813ab461A8863E40e21" as Address;
const ATOKEN = "0xA4D94019934D8333Ef880ABFFbF2FDd611C762BD" as Address;
const VAULT = "0xF2532428472a4CbDF27f20Ca39E81DA6DEb420b5" as Address;

const RECORDED = {
  aTokenBalance: 120_005n,
  vaultShares: 15_000_000_000_000_000n,
  vaultTotalAssets: 8_767_619n,
  vaultAssets: 15_000n,
} as const;

/** Answers with the recorded values, and counts conversions so we can prove none is wasted. */
class RecordedReader implements WalletReader {
  convertCalls = 0;

  constructor(private readonly shares: bigint = RECORDED.vaultShares) {}

  async balanceOf(token: Address): Promise<bigint> {
    const key = token.toLowerCase();
    if (key === ATOKEN.toLowerCase()) return RECORDED.aTokenBalance;
    if (key === VAULT.toLowerCase()) return this.shares;
    throw new Error(`unexpected token ${token}`);
  }

  async convertToAssets(): Promise<bigint> {
    this.convertCalls += 1;
    return RECORDED.vaultAssets;
  }

  async totalAssets(): Promise<bigint> {
    return RECORDED.vaultTotalAssets;
  }
}

describe("readAaveV3Supplied", () => {
  it("reports the aToken balance as supplied, matching what aave.com shows", async () => {
    const position = await readAaveV3Supplied({
      reader: new RecordedReader(),
      chainId: 137,
      user: USER,
      aToken: ATOKEN,
      decimals: 6,
      label: "Aave V3 · USDC",
    });

    expect(position.units).toBeCloseTo(0.120005, 9);
    expect(position.protocol).toBe("aave-v3");
    expect(position.poolId).toBe(ATOKEN.toLowerCase());
  });

  it("leaves APY null rather than reporting zero", async () => {
    const position = await readAaveV3Supplied({
      reader: new RecordedReader(),
      chainId: 137,
      user: USER,
      aToken: ATOKEN,
      decimals: 6,
      label: "Aave V3 · USDC",
    });

    // Aave publishes the rate through its API. Reporting 0 here would render "0.00%" on a card for
    // a position that is in fact earning, and the user would have no way to tell it was a gap.
    expect(position.apy).toBeNull();
  });
});

describe("readMorphoVaultPosition", () => {
  it("converts shares to assets instead of assuming one share is one USDC", async () => {
    const reader = new RecordedReader();
    const position = await readMorphoVaultPosition({
      reader,
      chainId: 137,
      user: USER,
      vault: VAULT,
      decimals: 6,
      shareDecimals: 18,
      label: "Morpho · MEV Capital USDC",
    });

    expect(position.shares).toBeCloseTo(0.015, 18);
    expect(position.units).toBeCloseTo(0.015, 6);
    expect(reader.convertCalls).toBe(1);
  });

  it("reports the vault's total assets as TVL", async () => {
    const position = await readMorphoVaultPosition({
      reader: new RecordedReader(),
      chainId: 137,
      user: USER,
      vault: VAULT,
      decimals: 6,
      shareDecimals: 18,
      label: "Morpho · MEV Capital USDC",
    });

    expect(position.totalAssets).toBeCloseTo(8.767619, 6);
  });

  it("skips the conversion for an empty position", async () => {
    const reader = new RecordedReader(0n);
    const position = await readMorphoVaultPosition({
      reader,
      chainId: 137,
      user: USER,
      vault: VAULT,
      decimals: 6,
      shareDecimals: 18,
      label: "Morpho · MEV Capital USDC",
    });

    expect(position.units).toBe(0);
    // convertToAssets(0) is not guaranteed to return 0 by every vault, and it is a wasted call.
    expect(reader.convertCalls).toBe(0);
  });
});

describe("readKnownPositions", () => {
  it("returns one position per registry entry for the chain", async () => {
    const positions = await readKnownPositions(new RecordedReader(), { chainId: 137, user: USER });
    expect(positions.map((p) => p.protocol).sort()).toEqual(["aave-v3", "morpho"]);
    expect(positions.every((p) => p.chainId === 137)).toBe(true);
  });

  it("returns nothing for a chain we have not executed on", async () => {
    const positions = await readKnownPositions(new RecordedReader(), { chainId: 1, user: USER });
    expect(positions).toEqual([]);
  });
});
