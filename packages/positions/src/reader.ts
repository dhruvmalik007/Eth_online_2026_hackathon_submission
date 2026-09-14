import { createPublicClient, http, parseAbi, type Address, type PublicClient } from "viem";

const ERC20 = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

const META_MORPHO = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
]);

/**
 * The chain reads a position needs.
 *
 * A port rather than viem calls inline, for the same reason the signing layer is one: the reader
 * logic is then testable against recorded values with no network, and a second provider — or a
 * caching reader — costs nothing to add later.
 */
export interface WalletReader {
  balanceOf(token: Address, account: Address): Promise<bigint>;
  convertToAssets(vault: Address, shares: bigint): Promise<bigint>;
  totalAssets(vault: Address): Promise<bigint>;
}

export function createViemReader(client: PublicClient): WalletReader {
  return {
    balanceOf: (token, account) =>
      client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [account] }),
    convertToAssets: (vault, shares) =>
      client.readContract({ address: vault, abi: META_MORPHO, functionName: "convertToAssets", args: [shares] }),
    totalAssets: (vault) =>
      client.readContract({ address: vault, abi: META_MORPHO, functionName: "totalAssets" }),
  };
}

export function createRpcReader(rpcUrl: string): WalletReader {
  return createViemReader(createPublicClient({ transport: http(rpcUrl) }));
}
