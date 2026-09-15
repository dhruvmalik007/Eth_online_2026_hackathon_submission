/**
 * The chains the desk reads, and what it looks for on each.
 *
 * Whether a chain belongs here is a product question — "where does a user's liquidity actually
 * live?" — so the answer is written down in one place rather than implied by whichever RPC happens
 * to be configured.
 */
import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains";
import type { Chain } from "viem";

export interface PortfolioChain {
  readonly chainId: number;
  readonly label: string;
  readonly chain: Chain;
  readonly nativeSymbol: string;
  readonly nativeDecimals: number;
  /**
   * The wrapped coin, and the only reason it is named here: it is where the *native* price comes
   * from. LI.FI prices WETH; nothing prices bare ETH, and a native balance without a price is a
   * number the user cannot add to anything.
   */
  readonly wrappedNativeSymbol: string;
}

export const PORTFOLIO_CHAINS: readonly PortfolioChain[] = [
  { chainId: 1, label: "Ethereum", chain: mainnet, nativeSymbol: "ETH", nativeDecimals: 18, wrappedNativeSymbol: "WETH" },
  { chainId: 8453, label: "Base", chain: base, nativeSymbol: "ETH", nativeDecimals: 18, wrappedNativeSymbol: "WETH" },
  { chainId: 42161, label: "Arbitrum", chain: arbitrum, nativeSymbol: "ETH", nativeDecimals: 18, wrappedNativeSymbol: "WETH" },
  { chainId: 10, label: "Optimism", chain: optimism, nativeSymbol: "ETH", nativeDecimals: 18, wrappedNativeSymbol: "WETH" },
  { chainId: 137, label: "Polygon", chain: polygon, nativeSymbol: "POL", nativeDecimals: 18, wrappedNativeSymbol: "WPOL" },
];

/**
 * The symbols worth asking about. This is an *allow*list on purpose: an address list would rot, and
 * "every token LI.FI knows" is 1,435 entries on Polygon alone — 1,435 `balanceOf` calls to render a
 * portfolio whose other 1,430 rows would all read zero.
 */
export const TRACKED_SYMBOLS: readonly string[] = [
  "USDC",
  "USDT",
  "DAI",
  "USDS",
  "SUSDS",
  "USDE",
  "SUSDE",
  "WETH",
  "WBTC",
  "CBBTC",
  "WSTETH",
  "LINK",
  "AAVE",
  "UNI",
  "ARB",
  "OP",
  "POL",
  "WPOL",
  "MORPHO",
  "ENA",
];

/** Per chain, a ceiling on the reads one dashboard load can fire. */
export const MAX_TOKENS_PER_CHAIN = 12;
