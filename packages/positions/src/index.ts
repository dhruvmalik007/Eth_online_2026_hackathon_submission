export type { ProtocolId, ProtocolPosition } from "./types.js";
export { createRpcReader, createViemReader, type WalletReader } from "./reader.js";
export { readAaveV3Supplied, type AaveSuppliedInput } from "./aave.js";
export { readMorphoVaultPosition, type MorphoVaultInput } from "./morpho.js";
export { POLYGON_KNOWN_POSITIONS, type KnownPosition } from "./registry.js";
export {
  readLiquidity,
  type ChainLiquidity,
  type ChainRef,
  type Holding,
  type LiquidityPort,
  type TokenRef,
} from "./liquidity.js";

import { readAaveV3Supplied } from "./aave.js";
import { readMorphoVaultPosition } from "./morpho.js";
import type { WalletReader } from "./reader.js";
import { POLYGON_KNOWN_POSITIONS, type KnownPosition } from "./registry.js";
import type { ProtocolPosition } from "./types.js";
import type { Address } from "viem";

/**
 * Read every registered position for one wallet on one chain.
 *
 * Sequential rather than parallel: a dashboard that fires four calls at a public RPC from one
 * request is how a rate limit is discovered in production. Adding positions is a registry entry,
 * not a code change.
 */
export async function readKnownPositions(
  reader: WalletReader,
  args: { chainId: number; user: Address; positions?: readonly KnownPosition[] },
): Promise<readonly ProtocolPosition[]> {
  const known = (args.positions ?? POLYGON_KNOWN_POSITIONS).filter((p) => p.chainId === args.chainId);
  const out: ProtocolPosition[] = [];

  for (const position of known) {
    if (position.protocol === "aave-v3") {
      out.push(
        await readAaveV3Supplied({
          reader,
          chainId: position.chainId,
          user: args.user,
          aToken: position.aToken,
          decimals: position.decimals,
          label: position.label,
        }),
      );
      continue;
    }

    out.push(
      await readMorphoVaultPosition({
        reader,
        chainId: position.chainId,
        user: args.user,
        vault: position.vault,
        decimals: position.decimals,
        shareDecimals: position.shareDecimals,
        label: position.label,
      }),
    );
  }

  return out;
}
