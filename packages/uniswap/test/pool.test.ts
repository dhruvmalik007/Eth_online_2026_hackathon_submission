import { describe, expect, it } from "vitest";
import {
  STATE_VIEW,
  V4_POOLS,
  ZERO_ADDRESS,
  gatesOperation,
  hookAdmission,
  hookPermissions,
  poolId,
  sortCurrencies,
  type Address,
  type PoolKey,
} from "../src/index.js";

const USDC = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" as const;
const DAI = "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1" as const;
const USDT = "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58" as const;

/** A real hook, from Uniswap's own registry: `BunniHook` on Base. */
const BUNNI = "0x000052423c1db6b7ff8641b85a7eefc7b2791888" as const;

describe("poolId", () => {
  it("reproduces the ids the chain reported", () => {
    // The strongest check available off-chain: these ids came from StateView on a live Optimism
    // fork. If the field order, the widths, or the currency sort were wrong, the hash would be a
    // different pool that does not exist — which is indistinguishable from a pool with no liquidity.
    expect(poolId(V4_POOLS[0]!.key)).toBe(V4_POOLS[0]!.id);
    expect(poolId(V4_POOLS[1]!.key)).toBe(V4_POOLS[1]!.id);
  });

  it("is independent of the order the currencies are given in", () => {
    // v4 sorts currencies itself, so a caller passing them backwards must still reach the same pool.
    const forward: PoolKey = {
      currency0: USDC,
      currency1: DAI,
      fee: 100,
      tickSpacing: 1,
      hooks: ZERO_ADDRESS,
    };
    const backward: PoolKey = { ...forward, currency0: DAI, currency1: USDC };

    expect(poolId(backward)).toBe(poolId(forward));
  });

  it("changes when the tick spacing changes, which is the width that is easy to get wrong", () => {
    const base: PoolKey = {
      currency0: USDC,
      currency1: USDT,
      fee: 100,
      tickSpacing: 1,
      hooks: ZERO_ADDRESS,
    };

    expect(poolId({ ...base, tickSpacing: 10 })).not.toBe(poolId(base));
    expect(poolId({ ...base, fee: 500 })).not.toBe(poolId(base));
    expect(poolId({ ...base, hooks: BUNNI })).not.toBe(poolId(base));
  });

  it("refuses a pool of one currency against itself", () => {
    expect(() => sortCurrencies(USDC, USDC)).toThrow(RangeError);
  });

  it("sorts case-insensitively, so checksumming cannot change the pool", () => {
    expect(sortCurrencies(DAI, USDC)).toEqual([USDC, DAI]);
  });
});

describe("hookPermissions", () => {
  it("decodes BunniHook's address into exactly the flags Uniswap declares for it", () => {
    // Uniswap's hooklist declares BunniHook with afterInitialize, beforeAddLiquidity, beforeSwap and
    // beforeSwapReturnsDelta set, and everything else clear. Its address ends 0x1888, which is those
    // four bits — so this pins the bit order against a real hook rather than against documentation.
    const permissions = hookPermissions(BUNNI);

    expect(
      Object.entries(permissions)
        .filter(([, set]) => set)
        .map(([name]) => name)
        .sort(),
    ).toEqual(
      ["afterInitialize", "beforeAddLiquidity", "beforeSwap", "beforeSwapReturnsDelta"].sort(),
    );
  });

  it("reads nothing out of the zero hook", () => {
    const permissions = hookPermissions(ZERO_ADDRESS);

    expect(Object.values(permissions).every((set) => !set)).toBe(true);
  });

  it("ignores bits above the fourteen permission bits", () => {
    // Only the low 14 bits carry permissions. A hook address whose higher bits are set must decode
    // the same as one whose are not, or every real hook would report spurious flags.
    const withHighBits = `0x${"f".repeat(26)}${BUNNI.slice(-14)}` as Address;

    expect(hookPermissions(withHighBits)).toEqual(hookPermissions(BUNNI));
  });
});

describe("gatesOperation", () => {
  it("never gates on the zero hook, for any operation", () => {
    for (const operation of ["addLiquidity", "removeLiquidity", "swap"] as const) {
      expect(gatesOperation(ZERO_ADDRESS, operation)).toBe(false);
    }
  });

  it("gates only the operations a hook is actually invoked on", () => {
    // The point of the mapping. BunniHook sets beforeAddLiquidity and beforeSwap but no remove
    // flags, so a position that is only ever withdrawn is not exposed to it.
    expect(gatesOperation(BUNNI, "addLiquidity")).toBe(true);
    expect(gatesOperation(BUNNI, "swap")).toBe(true);
    expect(gatesOperation(BUNNI, "removeLiquidity")).toBe(false);
  });

  it("does not infer anything from swapAccess", () => {
    // BunniHook declares swapAccess "none" — no allowlist, no access restriction — and still sets
    // beforeAddLiquidity. Treating "none" as "cannot block" is the mistake this guards.
    expect(gatesOperation(BUNNI, "addLiquidity")).toBe(true);
  });
});

describe("hookAdmission", () => {
  it("calls the zero hook ungated, on a property of the address", () => {
    const admission = hookAdmission(ZERO_ADDRESS);

    expect(admission.verdict).toBe("ungated");
    expect(admission.reachable).toEqual([]);
    expect(admission.detail).toContain("no external call happens");
  });

  it("calls an invoked hook unproven rather than rejected", () => {
    // Unproven is the honest verdict: the hook may be perfectly open, and the next step is a
    // simulation, not a refusal.
    const admission = hookAdmission(BUNNI);

    expect(admission.verdict).toBe("unproven");
    expect(admission.reachable).toEqual(["addLiquidity", "swap"]);
    expect(admission.detail).toContain("absence of proof");
  });
});

describe("the registry", () => {
  it("contains only pools whose admission needs no proof", () => {
    // Every entry was chosen on this basis, so it is asserted rather than trusted.
    for (const pool of V4_POOLS) {
      expect(hookAdmission(pool.key.hooks).verdict).toBe("ungated");
      expect(pool.key.hooks).toBe(ZERO_ADDRESS);
    }
  });

  it("records the depth it was chosen on, and it is not zero", () => {
    // Two probed pools were left out precisely because they are initialised with no depth:
    // USDC/USDT at 10000/200 reports liquidity 0 and at 500/10 reports 998. Depth is not existence.
    for (const pool of V4_POOLS) {
      expect(BigInt(pool.observedLiquidity)).toBeGreaterThan(0n);
      expect(BigInt(pool.observedSqrtPriceX96)).toBeGreaterThan(0n);
      expect(pool.provenance).toContain("Probed");
    }
  });

  it("keeps the stablecoin pairs the fixed-income case needs", () => {
    const labels = V4_POOLS.map((pool) => pool.label);

    expect(labels.some((label) => label.includes("USDC/DAI"))).toBe(true);
    expect(labels.some((label) => label.includes("USDC/USDT"))).toBe(true);
  });

  it("names a StateView for both chains in the matrix", () => {
    for (const chain of ["optimism", "polygon"] as const) {
      expect(STATE_VIEW[chain]).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });
});
