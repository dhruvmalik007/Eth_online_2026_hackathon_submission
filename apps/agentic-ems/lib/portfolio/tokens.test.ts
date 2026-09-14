import { afterEach, describe, expect, it } from "vitest";
import { clearTokenBookCache, loadTokenBook } from "./tokens";

function reply(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

function entry(over: Record<string, unknown>): Record<string, unknown> {
  return { address: "0x0000000000000000000000000000000000000001", symbol: "USDC", decimals: 6, priceUSD: "1", verificationStatus: "verified", ...over };
}

afterEach(() => clearTokenBookCache());

describe("loadTokenBook", () => {
  it("keeps tracked, verified tokens and drops the rest", async () => {
    const books = await loadTokenBook(
      reply({
        tokens: {
          "137": [
            entry({ symbol: "USDC", address: "0x00000000000000000000000000000000000000aa" }),
            entry({ symbol: "PEPE2", address: "0x00000000000000000000000000000000000000bb" }),
            // A clone wearing a real symbol: LI.FI checked it and refused it.
            entry({ symbol: "USDT", address: "0x00000000000000000000000000000000000000cc", verificationStatus: "spam" }),
            // Malformed entries must not reach a balance call.
            entry({ symbol: "DAI", address: "not-an-address" }),
            entry({ symbol: "DAI", address: "0x00000000000000000000000000000000000000dd", decimals: 99 }),
          ],
        },
      }),
    );

    const polygon = books.get(137);
    expect(polygon?.tokens.map((token) => token.symbol)).toEqual(["USDC"]);
    expect(polygon?.tokens[0]?.decimals).toBe(6);
  });

  it("prices the native coin from its wrapped token", async () => {
    const books = await loadTokenBook(
      reply({
        tokens: {
          "1": [entry({ symbol: "WETH", address: "0x00000000000000000000000000000000000000ee", decimals: 18, priceUSD: "3000.5" })],
          8453: [entry({ symbol: "WETH", address: "0x00000000000000000000000000000000000000ef", decimals: 18, priceUSD: "3001.5" })],
        },
      }),
    );

    expect(books.get(1)?.nativePriceUsd).toBeCloseTo(3000.5);
    expect(books.get(8453)?.nativePriceUsd).toBeCloseTo(3001.5);
    // A chain with no wrapped-native entry prices nothing rather than guessing.
    expect(books.get(10)?.nativePriceUsd).toBeNull();
  });

  it("reports no price as null instead of zero", async () => {
    const books = await loadTokenBook(
      reply({ tokens: { "137": [entry({ symbol: "USDC", address: "0x00000000000000000000000000000000000000aa", priceUSD: "0" })] } }),
    );
    expect(books.get(137)?.prices.get("0x00000000000000000000000000000000000000aa")).toBeNull();
  });

  it("is deterministic, so two loads do not reshuffle the rows", async () => {
    const list = [
      entry({ symbol: "USDT", address: "0x0000000000000000000000000000000000000002" }),
      entry({ symbol: "DAI", address: "0x0000000000000000000000000000000000000003" }),
      entry({ symbol: "USDC", address: "0x0000000000000000000000000000000000000004" }),
    ];
    const first = (await loadTokenBook(reply({ tokens: { "137": list } }))).get(137)?.tokens.map((t) => t.symbol);
    clearTokenBookCache();
    const second = (await loadTokenBook(reply({ tokens: { "137": [...list].reverse() } }))).get(137)?.tokens.map((t) => t.symbol);
    expect(first).toEqual(second);
  });

  it("surfaces a failed fetch rather than reporting an empty portfolio", async () => {
    const failing = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(loadTokenBook(failing)).rejects.toThrow("503");
  });
});
