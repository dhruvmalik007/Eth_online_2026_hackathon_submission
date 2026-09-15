import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { bloomBitPositions, bloomMayContain, bloomMayContainAll, isBloomHex } from "../api/_lib/bloom.js";

const ADDRESS = "0x00000000000000000000000000000000000000a1";
const TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function emptyBloom(): Hex {
  return `0x${"00".repeat(256)}` as Hex;
}

/** Build a bloom that contains exactly `value` — the inverse of `bloomMayContain`. */
function bloomFor(values: readonly string[]): Hex {
  const bytes = new Uint8Array(256);
  for (const value of values) {
    for (const position of bloomBitPositions(value)) {
      const byteIndex = 256 - 1 - (position >> 3);
      bytes[byteIndex] = (bytes[byteIndex] ?? 0) | (1 << (position & 7));
    }
  }
  return `0x${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("")}` as Hex;
}

describe("isBloomHex", () => {
  it("accepts a 256-byte bloom", () => {
    expect(isBloomHex(emptyBloom())).toBe(true);
  });

  it("rejects the wrong length", () => {
    expect(isBloomHex("0x00")).toBe(false);
  });
});

describe("bloomBitPositions", () => {
  it("returns three positions inside the filter", () => {
    const positions = bloomBitPositions(ADDRESS);
    expect(positions).toHaveLength(3);
    for (const position of positions) {
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThan(2048);
    }
  });

  it("is deterministic", () => {
    expect(bloomBitPositions(TOPIC)).toEqual(bloomBitPositions(TOPIC));
  });
});

describe("bloomMayContain", () => {
  it("is a proof of absence for an empty bloom", () => {
    expect(bloomMayContain(emptyBloom(), ADDRESS)).toBe(false);
  });

  it("finds a value that was inserted", () => {
    expect(bloomMayContain(bloomFor([ADDRESS]), ADDRESS)).toBe(true);
    expect(bloomMayContain(bloomFor([TOPIC]), TOPIC)).toBe(true);
  });

  it("does not report an unrelated value as present", () => {
    expect(bloomMayContain(bloomFor([ADDRESS]), TOPIC)).toBe(false);
  });

  it("refuses a bloom of the wrong size", () => {
    expect(bloomMayContain("0x00" as Hex, ADDRESS)).toBe(false);
  });
});

describe("bloomMayContainAll", () => {
  it("requires every value to be present", () => {
    expect(bloomMayContainAll(bloomFor([ADDRESS, TOPIC]), [ADDRESS, TOPIC])).toBe(true);
    expect(bloomMayContainAll(bloomFor([ADDRESS]), [ADDRESS, TOPIC])).toBe(false);
  });
});
