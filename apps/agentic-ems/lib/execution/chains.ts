import { base, optimism, polygon } from "viem/chains";
import type { ChainKey } from "./types";

/**
 * Chain metadata for the execution UI. Explorer URLs are derived from the viem
 * chain definition rather than hardcoded — the app had no block-explorer links
 * anywhere before this, and inventing URL shapes by hand is how they rot.
 */
export const CHAIN_META: Record<
  ChainKey,
  { label: string; chainId: number; explorerUrl: string; nativeToken: string }
> = {
  base: {
    label: "Base",
    chainId: base.id,
    explorerUrl: base.blockExplorers.default.url,
    nativeToken: "ETH",
  },
  optimism: {
    label: "Optimism",
    chainId: optimism.id,
    explorerUrl: optimism.blockExplorers.default.url,
    nativeToken: "ETH",
  },
  polygon: {
    label: "Polygon",
    chainId: polygon.id,
    explorerUrl: polygon.blockExplorers.default.url,
    nativeToken: "POL",
  },
};

export function chainLabel(chain: ChainKey): string {
  return CHAIN_META[chain].label;
}

export function explorerTxUrl(chain: ChainKey, hash: string): string {
  return `${CHAIN_META[chain].explorerUrl}/tx/${hash}`;
}

/**
 * Cross-chain messages are tracked separately from the source explorer — a source
 * transaction succeeding says nothing about whether the message was delivered.
 */
export function scanUrl(srcTxHashOrGuid: string): string {
  return `https://layerzeroscan.com/tx/${srcTxHashOrGuid}`;
}
