/**
 * What a wallet holds, chain by chain.
 *
 * This is balances only — deliberately no USD anywhere. A price is a network call to an outside
 * service, and mixing it in here would make the one part of the portfolio that can be tested offline
 * depend on an API that is up sometimes. Pricing happens where the price source already lives (the
 * app's LI.FI client), and this stays a pure function of the chain and an injectable port.
 *
 * ## Why an injectable port
 *
 * The same reason `reader.ts` has one: a test that needs five RPC endpoints is a test that fails
 * when someone else's node is busy. Every rule below — which failures are survivable, when a chain
 * is reported as partially read, what happens to a zero balance — is decidable without a network.
 *
 * ## The failure rule
 *
 * One chain's RPC being down must not blank the portfolio. A user with liquidity on five chains
 * needs to see the four that answered, and needs to *know* the fifth did not — a portfolio that
 * silently drops a chain reads as "you have nothing there", which is the opposite of the truth and
 * exactly the kind of error someone would make a decision on.
 */
import { formatUnits, type Address } from "viem";

/** A token to look for, resolved to an address by the caller. */
export interface TokenRef {
  readonly address: Address;
  readonly symbol: string;
  readonly decimals: number;
}

/** A chain to look on, and what to look for there. */
export interface ChainRef {
  readonly chainId: number;
  readonly label: string;
  readonly nativeSymbol: string;
  readonly nativeDecimals: number;
  readonly tokens: readonly TokenRef[];
}

/** The edge: whatever can answer "how much does this account hold". */
export interface LiquidityPort {
  nativeBalance(chainId: number, account: Address): Promise<bigint>;
  tokenBalance(chainId: number, token: Address, account: Address): Promise<bigint>;
}

/** A non-zero balance. */
export interface Holding {
  readonly symbol: string;
  /** `null` for the chain's own coin. */
  readonly address: Address | null;
  readonly decimals: number;
  readonly amount: bigint;
  /** Exact decimal string — never rounded, so the UI decides how to shorten it. */
  readonly formatted: string;
}

export interface ChainLiquidity {
  readonly chainId: number;
  readonly label: string;
  readonly nativeSymbol: string;
  /**
   * `unavailable` means nothing on this chain could be read; `partial` means some reads failed and
   * what is shown is a floor, not a total.
   */
  readonly status: "ok" | "partial" | "unavailable";
  readonly note?: string;
  readonly native: Holding | null;
  readonly tokens: readonly Holding[];
}

export interface readLiquidityInput {
  readonly account: Address;
  readonly chains: readonly ChainRef[];
  readonly port: LiquidityPort;
}

function holdingOf(token: TokenRef, amount: bigint): Holding {
  return {
    symbol: token.symbol,
    address: token.address,
    decimals: token.decimals,
    amount,
    formatted: formatUnits(amount, token.decimals),
  };
}

async function settle<T>(work: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await work };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Read every chain, isolating each one's failures.
 *
 * Chains are read concurrently and results come back in the order they were given, so the portfolio
 * does not reshuffle itself between two loads.
 */
export async function readLiquidity(input: readLiquidityInput): Promise<readonly ChainLiquidity[]> {
  const { account, port } = input;

  return Promise.all(
    input.chains.map(async (chain): Promise<ChainLiquidity> => {
      const nativeRead = settle(port.nativeBalance(chain.chainId, account));
      const tokenReads = chain.tokens.map((token) => settle(port.tokenBalance(chain.chainId, token.address, account)));

      const [native, ...tokens] = await Promise.all([nativeRead, ...tokenReads]);

      const failures = [native, ...tokens].filter((result) => !result.ok).length;
      const attempts = 1 + chain.tokens.length;

      if (failures === attempts) {
        return {
          chainId: chain.chainId,
          label: chain.label,
          nativeSymbol: chain.nativeSymbol,
          status: "unavailable",
          note: `No read succeeded on this chain (${failures}/${attempts}).`,
          native: null,
          tokens: [],
        };
      }

      const nativeHolding =
        native.ok && native.value > 0n
          ? {
              symbol: chain.nativeSymbol,
              address: null,
              decimals: chain.nativeDecimals,
              amount: native.value,
              formatted: formatUnits(native.value, chain.nativeDecimals),
            }
          : null;

      const tokenHoldings = tokens
        .map((result, index) => {
          const token = chain.tokens[index] as TokenRef;
          return result.ok && result.value > 0n ? holdingOf(token, result.value) : null;
        })
        .filter((holding): holding is Holding => holding !== null);

      return {
        chainId: chain.chainId,
        label: chain.label,
        nativeSymbol: chain.nativeSymbol,
        status: failures === 0 ? "ok" : "partial",
        ...(failures === 0 ? {} : { note: `${failures}/${attempts} reads failed; these balances are a floor.` }),
        native: nativeHolding,
        tokens: tokenHoldings,
      };
    }),
  );
}
