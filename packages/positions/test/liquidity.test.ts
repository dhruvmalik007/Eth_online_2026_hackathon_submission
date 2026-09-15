import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { readLiquidity, type ChainRef, type LiquidityPort } from "../src/liquidity.js";

const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as Address;
const WETH = "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619" as Address;
const ACCOUNT = "0x63185C0f059dE46DBeEa6813ab461A8863E40e21" as Address;

function chain(chainId: number, label: string, tokens: ChainRef["tokens"]): ChainRef {
  return { chainId, label, nativeSymbol: "ETH", nativeDecimals: 18, tokens };
}

const CHAINS: readonly ChainRef[] = [
  chain(1, "Ethereum", [{ address: USDC, symbol: "USDC", decimals: 6 }]),
  chain(137, "Polygon", [
    { address: USDC, symbol: "USDC", decimals: 6 },
    { address: WETH, symbol: "WETH", decimals: 18 },
  ]),
];

/** A port built from a table, so each test states only what it is about. */
function portOf(table: Record<string, bigint>): LiquidityPort {
  return {
    async nativeBalance(chainId) {
      const value = table[`${chainId}:native`];
      if (value === undefined) throw new Error(`no native read for ${chainId}`);
      return value;
    },
    async tokenBalance(chainId, token) {
      const value = table[`${chainId}:${token}`];
      if (value === undefined) throw new Error(`no read for ${token}`);
      return value;
    },
  };
}

describe("readLiquidity", () => {
  it("returns only what is actually held", async () => {
    const chains = await readLiquidity({
      account: ACCOUNT,
      chains: CHAINS,
      port: portOf({
        "1:native": 0n,
        "1:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359": 150_000n,
        "137:native": 2n * 10n ** 18n,
        "137:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359": 0n,
        "137:0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": 0n,
      }),
    });

    const [ethereum, polygon] = chains as [typeof chains[number], typeof chains[number]];
    // A zero balance is not a holding: a portfolio listing 6 zero rows buries the 2 that matter.
    expect(ethereum.native).toBeNull();
    expect(ethereum.tokens.map((t) => t.symbol)).toEqual(["USDC"]);
    expect(ethereum.tokens[0]?.formatted).toBe("0.15");
    expect(ethereum.status).toBe("ok");

    expect(polygon.native?.formatted).toBe("2");
    expect(polygon.tokens).toEqual([]);
  });

  it("keeps the chains in the order they were given", async () => {
    const chains = await readLiquidity({
      account: ACCOUNT,
      chains: CHAINS,
      port: portOf({
        "1:native": 1n,
        "1:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359": 1n,
        "137:native": 1n,
        "137:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359": 1n,
        "137:0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": 1n,
      }),
    });
    expect(chains.map((c) => c.chainId)).toEqual([1, 137]);
  });

  it("does not let one dead chain blank the others", async () => {
    const chains = await readLiquidity({
      account: ACCOUNT,
      chains: CHAINS,
      // Polygon is absent from the table, so every read on it throws.
      port: portOf({ "1:native": 5n, "1:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359": 7n }),
    });

    const polygon = chains[1];
    expect(polygon?.status).toBe("unavailable");
    expect(polygon?.note).toContain("3/3");
    expect(polygon?.native).toBeNull();
    // The chain that answered still reports its holdings.
    expect(chains[0]?.status).toBe("ok");
    expect(chains[0]?.tokens[0]?.formatted).toBe("0.000007");
  });

  it("reports a partial read as a floor rather than a total", async () => {
    const chains = await readLiquidity({
      account: ACCOUNT,
      chains: CHAINS,
      port: portOf({
        "1:native": 1n,
        "1:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359": 250_000n,
        "137:native": 1n * 10n ** 18n,
        // WETH read is missing → that one token fails, the chain still resolves.
      }),
    });

    const polygon = chains[1];
    expect(polygon?.status).toBe("partial");
    expect(polygon?.note).toContain("2/3");
    expect(polygon?.native?.formatted).toBe("1");
    expect(polygon?.tokens).toEqual([]);
  });
});
