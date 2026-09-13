import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import {
  InvalidTickRange,
  V4_POOLS,
  ZERO_ADDRESS,
  encodeModifyLiquidity,
  encodePoolKey,
  isAligned,
  tickRangeFor,
  type PoolKey,
} from "../src/index.js";

const USDC = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" as const;
const DAI = "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1" as const;
const key: PoolKey = { currency0: USDC, currency1: DAI, fee: 100, tickSpacing: 1, hooks: ZERO_ADDRESS };

describe("tickRangeFor", () => {
  it("snaps both bounds outward, never inward", () => {
    // Inward snapping would silently under-provision, which reads as a smaller position rather than
    // as a bug — the failure mode worth designing out.
    const range = tickRangeFor({ currentTick: 103, tickSpacing: 10, halfWidth: 27 });

    expect(range).toEqual({ lower: 70, upper: 130 });
    expect(range.lower).toBeLessThanOrEqual(103 - 27);
    expect(range.upper).toBeGreaterThanOrEqual(103 + 27);
  });

  it("produces aligned ticks", () => {
    for (const spacing of [1, 10, 60, 200]) {
      const range = tickRangeFor({ currentTick: -1234, tickSpacing: spacing, halfWidth: 777 });
      expect(isAligned(range, spacing)).toBe(true);
    }
  });

  it("handles negative ticks on both sides of zero", () => {
    const range = tickRangeFor({ currentTick: -5, tickSpacing: 10, halfWidth: 3 });

    expect(range).toEqual({ lower: -10, upper: 0 });
  });

  it("widens a narrow request to at least one spacing rather than collapsing it", () => {
    // Snapping outward is what makes this true: a width far smaller than the spacing still yields a
    // representable range, because both bounds move away from the tick rather than toward it. The
    // empty-range guard is therefore defensive — nowhere reachable through this function.
    const range = tickRangeFor({ currentTick: 100, tickSpacing: 60, halfWidth: 1 });

    expect(range).toEqual({ lower: 60, upper: 120 });
    expect(isAligned(range, 60)).toBe(true);
  });

  it("refuses a range outside v4's representable ticks", () => {
    expect(() => tickRangeFor({ currentTick: 887000, tickSpacing: 10, halfWidth: 5000 })).toThrow(InvalidTickRange);
  });

  it("refuses a non-positive spacing", () => {
    expect(() => tickRangeFor({ currentTick: 0, tickSpacing: 0, halfWidth: 10 })).toThrow(InvalidTickRange);
  });
});

describe("encodeModifyLiquidity", () => {
  it("encodes a call the abi can read back, with the key in v4's field order", () => {
    const range = tickRangeFor({ currentTick: 0, tickSpacing: 10, halfWidth: 50 });
    const data = encodeModifyLiquidity({ key, range, liquidityDelta: 1234n });

    const decoded = decodeFunctionData({
      abi: [
        {
          type: "function",
          name: "modifyLiquidity",
          inputs: [
            {
              name: "key",
              type: "tuple",
              components: [
                { name: "currency0", type: "address" },
                { name: "currency1", type: "address" },
                { name: "fee", type: "uint24" },
                { name: "tickSpacing", type: "int24" },
                { name: "hooks", type: "address" },
              ],
            },
            {
              name: "params",
              type: "tuple",
              components: [
                { name: "tickLower", type: "int24" },
                { name: "tickUpper", type: "int24" },
                { name: "liquidityDelta", type: "int256" },
                { name: "salt", type: "bytes32" },
              ],
            },
            { name: "hookData", type: "bytes" },
          ],
        },
      ] as const,
      data,
    });

    expect(decoded.functionName).toBe("modifyLiquidity");
    const [decodedKey, params] = decoded.args as unknown as [
      { fee: number; tickSpacing: number; hooks: string },
      { tickLower: number; tickUpper: number; liquidityDelta: bigint },
    ];
    expect(decodedKey.fee).toBe(100);
    expect(decodedKey.tickSpacing).toBe(1);
    expect(decodedKey.hooks).toBe(ZERO_ADDRESS);
    expect(params).toMatchObject({ tickLower: -50, tickUpper: 50, liquidityDelta: 1234n });
  });

  it("carries a negative delta, which is how a position is withdrawn with the same function", () => {
    // One function covers both legs of a rebalance, so the sign has to survive encoding.
    const range = tickRangeFor({ currentTick: 0, tickSpacing: 10, halfWidth: 50 });
    const data = encodeModifyLiquidity({ key, range, liquidityDelta: -1234n });

    const decoded = decodeFunctionData({
      abi: [
        {
          type: "function",
          name: "modifyLiquidity",
          inputs: [
            {
              name: "key",
              type: "tuple",
              components: [
                { name: "currency0", type: "address" },
                { name: "currency1", type: "address" },
                { name: "fee", type: "uint24" },
                { name: "tickSpacing", type: "int24" },
                { name: "hooks", type: "address" },
              ],
            },
            {
              name: "params",
              type: "tuple",
              components: [
                { name: "tickLower", type: "int24" },
                { name: "tickUpper", type: "int24" },
                { name: "liquidityDelta", type: "int256" },
                { name: "salt", type: "bytes32" },
              ],
            },
            { name: "hookData", type: "bytes" },
          ],
        },
      ] as const,
      data,
    });

    const [, params] = decoded.args as unknown as [unknown, { liquidityDelta: bigint }];
    expect(params.liquidityDelta).toBe(-1234n);
  });

  it("refuses an unaligned range rather than letting the PoolManager say so", () => {
    // Spacing 10, so 3 and 97 are both misaligned. The PoolManager would reject this too, but only
    // after the caller has paid to find out.
    const spaced: PoolKey = { ...key, tickSpacing: 10 };

    expect(() =>
      encodeModifyLiquidity({ key: spaced, range: { lower: 3, upper: 97 }, liquidityDelta: 1n }),
    ).toThrow(RangeError);
  });

  it("accepts a range taken from a pinned pool's own spacing", () => {
    // Every registry pool, so the encoder is exercised against the spacings actually in use.
    for (const pool of V4_POOLS) {
      const range = tickRangeFor({ currentTick: 0, tickSpacing: pool.key.tickSpacing, halfWidth: 100 });
      expect(() => encodeModifyLiquidity({ key: pool.key, range, liquidityDelta: 1n })).not.toThrow();
    }
  });
});

describe("encodePoolKey", () => {
  it("pads each field to a full word, which is what a hash needs", () => {
    // 5 words: two addresses, a uint24, an int24, an address. A caller who packed these would get a
    // plausible-looking key that hashes to a pool that does not exist.
    expect((encodePoolKey(key).length - 2) / 2).toBe(160);
  });
});
