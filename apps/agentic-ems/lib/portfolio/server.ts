/**
 * The user's liquidity, read from the chains.
 *
 * Balance reading is delegated to `@ethonline2026/positions`, which owns the rules about partial
 * reads; this module adds the two things that are this app's business: prices, and the shape the
 * dashboard renders.
 *
 * ## What is deliberately absent
 *
 * There is no fallback number. When a price is missing the holding comes back with `priceUsd: null`
 * and is counted in `unpriced` rather than valued at zero — a zero would quietly shrink the total
 * and the user would read it as "that position is worth nothing" instead of "we could not price it".
 * The same rule the risk pipeline applies to APY: `null` is not `0`.
 */
import { createPublicClient, erc20Abi, http, isAddress, type Address, type PublicClient } from "viem";
import { readLiquidity, type ChainRef, type Holding, type LiquidityPort } from "@ethonline2026/positions";
import { PORTFOLIO_CHAINS } from "./chains";
import { loadTokenBook, type ChainTokenBook } from "./tokens";

export interface PortfolioHolding {
  readonly symbol: string;
  /** `null` for the chain's native coin. */
  readonly address: string | null;
  readonly decimals: number;
  /** Exact decimal string, as read. */
  readonly amount: string;
  readonly formatted: string;
  readonly priceUsd: number | null;
  /** `null` when unpriceable — never `0`. */
  readonly valueUsd: number | null;
}

export interface PortfolioChainView {
  readonly chainId: number;
  readonly label: string;
  readonly nativeSymbol: string;
  readonly status: "ok" | "partial" | "unavailable";
  readonly note?: string;
  readonly native: PortfolioHolding | null;
  readonly tokens: readonly PortfolioHolding[];
  readonly pricedUsd: number;
  readonly unpriced: number;
}

export interface PortfolioView {
  readonly address: string;
  readonly readAt: string;
  readonly chains: readonly PortfolioChainView[];
  readonly pricedUsd: number;
  readonly unpriced: number;
  readonly unavailableChains: number;
  readonly tokenSource: "lifi" | "none";
  readonly provenance: "client-supplied";
  readonly note?: string;
}

/** One client per chain, built on the chain's own default RPC. */
function liquidityPort(): LiquidityPort {
  const clients = new Map<number, PublicClient>();
  const clientFor = (chainId: number): PublicClient => {
    const existing = clients.get(chainId);
    if (existing !== undefined) return existing;
    const definition = PORTFOLIO_CHAINS.find((chain) => chain.chainId === chainId);
    if (definition === undefined) throw new Error(`Chain ${chainId} is not in the portfolio registry.`);
    const client = createPublicClient({ chain: definition.chain, transport: http() }) as PublicClient;
    clients.set(chainId, client);
    return client;
  };

  return {
    nativeBalance: (chainId, account) => clientFor(chainId).getBalance({ address: account }),
    tokenBalance: (chainId, token, account) =>
      clientFor(chainId).readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
  };
}

function priceFor(book: ChainTokenBook | undefined, holding: Holding): number | null {
  if (book === undefined) return null;
  if (holding.address === null) return book.nativePriceUsd;
  return book.prices.get(holding.address.toLowerCase()) ?? null;
}

function toView(book: ChainTokenBook | undefined, holding: Holding | null): PortfolioHolding | null {
  if (holding === null) return null;
  const priceUsd = priceFor(book, holding);
  const amount = Number(holding.formatted);
  const valueUsd = priceUsd === null || !Number.isFinite(amount) ? null : amount * priceUsd;
  return {
    symbol: holding.symbol,
    address: holding.address,
    decimals: holding.decimals,
    amount: holding.amount.toString(),
    formatted: holding.formatted,
    priceUsd,
    valueUsd,
  };
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function readWalletPortfolio(address: string): Promise<PortfolioView> {
  if (!isAddress(address)) throw new Error(`Not an EVM address: ${address}`);
  const account: Address = address;

  let books: Map<number, ChainTokenBook> | undefined;
  let tokenSource: "lifi" | "none" = "lifi";
  let note: string | undefined;

  try {
    books = await loadTokenBook();
  } catch (cause) {
    // Losing the token list costs the token rows and the prices, not the portfolio: a native
    // balance is still a real thing the user holds, and saying so beats showing an empty page.
    tokenSource = "none";
    note = `Token list unavailable (${message(cause)}). Native balances are shown without prices.`;
  }

  const refs: ChainRef[] = PORTFOLIO_CHAINS.map((definition) => ({
    chainId: definition.chainId,
    label: definition.label,
    nativeSymbol: definition.nativeSymbol,
    nativeDecimals: definition.nativeDecimals,
    tokens: books?.get(definition.chainId)?.tokens ?? [],
  }));

  const chains = await readLiquidity({ account, chains: refs, port: liquidityPort() });

  let pricedUsd = 0;
  let unpriced = 0;

  const views: PortfolioChainView[] = chains.map((chain) => {
    const book = books?.get(chain.chainId);
    const native = toView(book, chain.native);
    const tokens = chain.tokens.map((holding) => toView(book, holding)).filter((v): v is PortfolioHolding => v !== null);

    let chainPriced = 0;
    let chainUnpriced = 0;
    for (const holding of [native, ...tokens]) {
      if (holding === null) continue;
      if (holding.valueUsd === null) chainUnpriced += 1;
      else chainPriced += holding.valueUsd;
    }

    pricedUsd += chainPriced;
    unpriced += chainUnpriced;

    return {
      chainId: chain.chainId,
      label: chain.label,
      nativeSymbol: chain.nativeSymbol,
      status: chain.status,
      ...(chain.note === undefined ? {} : { note: chain.note }),
      native,
      tokens,
      pricedUsd: chainPriced,
      unpriced: chainUnpriced,
    };
  });

  return {
    address,
    readAt: new Date().toISOString(),
    chains: views,
    pricedUsd,
    unpriced,
    unavailableChains: views.filter((chain) => chain.status === "unavailable").length,
    tokenSource,
    provenance: "client-supplied",
    ...(note === undefined ? {} : { note }),
  };
}
