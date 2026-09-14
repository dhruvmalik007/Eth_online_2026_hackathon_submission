import { formatUnits, type Address } from "viem";
import type { WalletReader } from "./reader.js";
import type { ProtocolPosition } from "./types.js";

export interface MorphoVaultInput {
  readonly reader: WalletReader;
  readonly chainId: number;
  readonly user: Address;
  readonly vault: Address;
  /** Decimals of the underlying asset (USDC is 6). */
  readonly decimals: number;
  /** Decimals of the vault's shares — 18 for MetaMorpho. */
  readonly shareDecimals: number;
  readonly label: string;
}

/**
 * A MetaMorpho vault position, valued in the underlying.
 *
 * The vault tokenises the position, so a raw share balance is not a number a user recognises: one
 * share is not one USDC. `convertToAssets` is what turns shares into the figure the Morpho app
 * shows, and it is read for the user's actual share count rather than assumed at parity — the
 * exchange rate drifts as the vault earns.
 */
export async function readMorphoVaultPosition(input: MorphoVaultInput): Promise<ProtocolPosition> {
  const [sharesRaw, totalRaw] = await Promise.all([
    input.reader.balanceOf(input.vault, input.user),
    input.reader.totalAssets(input.vault),
  ]);

  // Skip the conversion for an empty position: it is one fewer call, and `convertToAssets(0)` is
  // not guaranteed to be 0 by every vault implementation.
  const assetsRaw = sharesRaw === 0n ? 0n : await input.reader.convertToAssets(input.vault, sharesRaw);

  return {
    protocol: "morpho",
    chainId: input.chainId,
    poolId: input.vault.toLowerCase(),
    label: input.label,
    units: Number(formatUnits(assetsRaw, input.decimals)),
    decimals: input.decimals,
    shares: Number(formatUnits(sharesRaw, input.shareDecimals)),
    totalAssets: Number(formatUnits(totalRaw, input.decimals)),
    apy: null,
    source: "onchain",
  };
}
