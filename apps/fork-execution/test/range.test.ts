import { describe, expect, it } from "vitest";
import { chunkRange, parseBlockNumber } from "../api/_lib/range.js";

describe("chunkRange", () => {
  it("splits an inclusive range into bounded chunks", () => {
    expect(chunkRange({ fromBlock: 0n, toBlock: 9n }, 4n)).toEqual([
      { fromBlock: 0n, toBlock: 3n },
      { fromBlock: 4n, toBlock: 7n },
      { fromBlock: 8n, toBlock: 9n },
    ]);
  });

  it("covers the range exactly, with no gap or overlap", () => {
    const chunks = chunkRange({ fromBlock: 100n, toBlock: 1_000n }, 137n);
    expect(chunks[0]?.fromBlock).toBe(100n);
    expect(chunks.at(-1)?.toBlock).toBe(1_000n);
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index]?.fromBlock).toBe((chunks[index - 1]?.toBlock ?? 0n) + 1n);
    }
  });

  it("returns nothing for an inverted range", () => {
    expect(chunkRange({ fromBlock: 10n, toBlock: 1n }, 5n)).toEqual([]);
  });

  it("refuses a non-positive chunk size", () => {
    expect(() => chunkRange({ fromBlock: 0n, toBlock: 1n }, 0n)).toThrowError(/positive/);
  });
});

describe("parseBlockNumber", () => {
  it("parses decimal and hex", () => {
    expect(parseBlockNumber("123")).toBe(123n);
    expect(parseBlockNumber("0x10")).toBe(16n);
  });

  it("returns null for nonsense", () => {
    expect(parseBlockNumber("latest")).toBeNull();
    expect(parseBlockNumber("")).toBeNull();
  });
});
