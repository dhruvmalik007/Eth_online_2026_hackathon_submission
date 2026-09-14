import { formatUnits, type Address } from "viem";
import type { WalletReader } from "./reader.js";
import type { ProtocolPosition } from "./types.js";

export interface AaveSuppliedInput {
  readonly reader: WalletReader;
  readonly chainId: number;
  readonly user: Address;
  readonly aToken: Address;
  readonly decimals: number;
  readonly label: string;
}

/**
 * The supplied balance of an Aave V3 reserve, in underlying units.
 *
 * `aToken.balanceOf` is what Aave's own "Supplied" figure reflects: the aToken is a rebasing claim
 * on the pool, so its balance already includes interest accrued since the supply. Reading the pool's
 * reserve struct instead would mean decoding a layout that changes between Aave releases — which is
 * exactly how the first attempt at this produced a wrong number.
 */
export async function readAaveV3Supplied(input: AaveSuppliedInput): Promise<ProtocolPosition> {
  const raw = await input.reader.balanceOf(input.aToken, input.user);

  return {
    protocol: "aave-v3",
    chainId: input.chainId,
    poolId: input.aToken.toLowerCase(),
    label: input.label,
    units: Number(formatUnits(raw, input.decimals)),
    decimals: input.decimals,
    shares: null,
    totalAssets: null,
    apy: null,
    source: "onchain",
  };
}
