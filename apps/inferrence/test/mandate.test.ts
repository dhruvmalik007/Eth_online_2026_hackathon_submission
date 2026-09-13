import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PoolResolutionError,
  createYieldsFeed,
  funnelRows,
  resolveMandate,
  resolvePool,
  symbolTokens,
  type YieldsFeed,
} from "../src/mandate/resolve.js";
import { MandateSchema, PoolSelectorSchema, type YieldsPoolRow } from "../src/mandate/schema.js";

/**
 * The fixture carries the two traps that a naive resolver falls into, so the assertions can be about
 * the choice rather than about the filtering:
 *
 * - `spike-pool` has a **297,995% spot APY** against a 1.1% 30-day mean. It is the shape a live Morpho
 *   query actually returned. Ranking on spot `apy` picks it.
 * - `unknown-tvl` reports **null** TVL. A TVL floor is pointless if an unreported figure passes it.
 */
const ROWS: readonly YieldsPoolRow[] = [
  {
    pool: "aave-base-usdc",
    project: "aave-v3",
    chain: "Base",
    symbol: "USDC",
    tvlUsd: 40_000_000,
    apy: 3.1,
    apyMean30d: 4.2,
    apyBase: 4.2,
    apyReward: null,
    exposure: "single",
    stablecoin: true,
  },
  {
    pool: "spike-pool",
    project: "aave-v3",
    chain: "Base",
    symbol: "USDC",
    tvlUsd: 9_000_000,
    apy: 297_995.8,
    apyMean30d: 1.1,
    apyBase: null,
    apyReward: null,
    exposure: "single",
    stablecoin: true,
  },
  {
    pool: "uni-v4-base-usdc-usdt",
    project: "uniswap-v4",
    chain: "Base",
    symbol: "USDC-USDT",
    tvlUsd: 12_000_000,
    apy: 5.5,
    apyMean30d: 6.1,
    apyBase: 3.0,
    apyReward: 2.5,
    exposure: "multi",
    stablecoin: true,
    ilRisk: "low",
  },
  {
    pool: "tiny",
    project: "aave-v3",
    chain: "Base",
    symbol: "USDC",
    tvlUsd: 1_000,
    apy: 90,
    apyMean30d: 90,
    exposure: "single",
    stablecoin: true,
  },
  {
    pool: "unknown-tvl",
    project: "aave-v3",
    chain: "Base",
    symbol: "USDC",
    tvlUsd: null,
    apy: 50,
    apyMean30d: 50,
    exposure: "single",
    stablecoin: true,
  },
  {
    pool: "aave-op-usdc",
    project: "aave-v3",
    chain: "Optimism",
    symbol: "USDC",
    tvlUsd: 40_000_000,
    apy: 5,
    apyMean30d: 5,
    exposure: "single",
    stablecoin: true,
  },
];

const AAVE_SELECTOR = PoolSelectorSchema.parse({
  project: "aave-v3",
  chain: "Base",
  symbols: ["USDC"],
  exposure: "single",
  stablecoin: true,
  minTvlUsd: 5_000_000,
});

function feedOf(rows: readonly YieldsPoolRow[]) {
  let calls = 0;
  const feed: YieldsFeed = {
    snapshot: async () => {
      calls += 1;
      return { rows, scrapedAt: "2026-09-13T00:00:00.000Z", url: "https://yields.test/pools" };
    },
  };
  return { feed, calls: () => calls };
}

function template(): unknown {
  return JSON.parse(
    readFileSync(new URL("../mandates/fi-lend-lp-base-v1.json", import.meta.url), "utf8"),
  );
}

describe("symbolTokens", () => {
  it("normalises the separators DefiLlama actually uses", () => {
    expect(symbolTokens("USDC-WETH")).toEqual(["USDC", "WETH"]);
    expect(symbolTokens("USDC / USDT")).toEqual(["USDC", "USDT"]);
    expect(symbolTokens("  usdc  ")).toEqual(["USDC"]);
  });
});

describe("funnelRows", () => {
  it("records the survivor count at each stage, naming the filter that emptied the set", () => {
    const { stages, survivors } = funnelRows(ROWS, AAVE_SELECTOR);
    expect(survivors.map((row) => row.pool)).toEqual(["aave-base-usdc", "spike-pool"]);
    // `minTvlUsd` is what removes `tiny` and `unknown-tvl`; if it were absent the funnel would end
    // higher and the operator would have nothing to relax.
    const last = stages.at(-1);
    expect(last?.filter).toBe("minTvlUsd");
    expect(last?.remaining).toBe(2);
  });
});

describe("resolvePool", () => {
  it("ranks by the 30-day mean, so a spiking spot APY cannot win", () => {
    // The decisive property: `spike-pool` reports 297,995.8% spot and would win any spot ranking.
    const chosen = resolvePool(ROWS, AAVE_SELECTOR, "leg-1");
    expect(chosen.poolId).toBe("aave-base-usdc");
    expect(chosen.apyMean30d).toBe(4.2);
  });

  it("carries an unreported APY component as null rather than zero", () => {
    // `spike-pool` wins a selector that excludes the base pool; its `apyBase` is null and must stay so —
    // a coerced 0 would read as "this leg earns nothing from base yield", which is a different claim.
    const selector = PoolSelectorSchema.parse({
      project: "aave-v3",
      chain: "Base",
      minTvlUsd: 5_000_000,
      symbols: [],
    });
    const chosen = resolvePool(ROWS, selector, "leg-1");
    expect(chosen.poolId).toBe("aave-base-usdc");
    expect(chosen.apyReward).toBeNull();
  });

  it("excludes a pool whose TVL is unreported, because a floor cannot admit the unknown", () => {
    const noFloor = PoolSelectorSchema.parse({
      project: "aave-v3",
      chain: "Optimism",
      minTvlUsd: 0,
      symbols: ["USDC"],
    });
    expect(resolvePool(ROWS, noFloor, "l").poolId).toBe("aave-op-usdc");
  });

  it("fails loudly, naming every filter and the stage that emptied the search", () => {
    const impossible = PoolSelectorSchema.parse({
      project: "aave-v3",
      chain: "Base",
      symbols: ["USDC"],
      exposure: "single",
      minTvlUsd: 999_000_000,
    });
    try {
      resolvePool(ROWS, impossible, "leg-1");
      throw new Error("expected a resolution failure");
    } catch (error) {
      expect(error).toBeInstanceOf(PoolResolutionError);
      const message = (error as Error).message;
      expect(message).toContain("leg-1");
      expect(message).toContain("project=aave-v3");
      expect(message).toContain("chain=Base");
      expect(message).toContain("minTvlUsd=999000000");
      // The funnel is the actionable half: it says which filter to relax.
      expect(message).toContain("minTvlUsd → 0");
    }
  });

  it("breaks ties on the pool id, so the same snapshot always yields the same choice", () => {
    const tied: YieldsPoolRow[] = [
      { ...ROWS[0]!, pool: "zzz", apyMean30d: 4 },
      { ...ROWS[0]!, pool: "aaa", apyMean30d: 4 },
    ];
    expect(resolvePool(tied, AAVE_SELECTOR, "l").poolId).toBe("aaa");
    expect(resolvePool([...tied].reverse(), AAVE_SELECTOR, "l").poolId).toBe("aaa");
  });
});

describe("resolveMandate", () => {
  it("produces the pools and protocols that AgentRequest requires", async () => {
    // This is the payoff: these two arrays were empty on every browser-initiated run, which is why the
    // agent had no pool context and LangSmith showed none.
    const { feed } = feedOf(ROWS);
    const resolved = await resolveMandate(template(), feed);
    expect(resolved.protocols).toEqual(["aave-v3", "uniswap-v4"]);
    expect(resolved.pools).toEqual(["aave-base-usdc", "uni-v4-base-usdc-usdt"]);
    expect(resolved.legs).toHaveLength(2);
  });

  it("uses one snapshot for every leg, which is the rate-limit discipline", async () => {
    const { feed, calls } = feedOf(ROWS);
    await resolveMandate(template(), feed);
    expect(calls()).toBe(1);
  });

  it("records the pool ids and the moment they were chosen, so the choice is re-derivable", async () => {
    const { feed } = feedOf(ROWS);
    const resolved = await resolveMandate(template(), feed);
    expect(resolved.evidence.scrapedAt).toBe("2026-09-13T00:00:00.000Z");
    expect(resolved.evidence.source).toBe("defillama-yields");
    expect(resolved.evidence.pools.map((p) => p.legId)).toEqual(["leg-1", "leg-2"]);
  });

  it("reports a leg under its floor instead of dropping it", async () => {
    const { feed } = feedOf(ROWS);
    const base = template() as { legs: { id: string; minApyBps: number }[] };
    base.legs[0]!.minApyBps = 9999; // above the 4.2% mean
    const resolved = await resolveMandate(base, feed);
    expect(resolved.legs[0]!.belowFloor).toBe(true);
    expect(resolved.warnings.join(" ")).toContain("leg-1");
  });

  it("reports weights that do not sum to 100 rather than silently normalising them", async () => {
    const { feed } = feedOf(ROWS);
    const base = template() as { legs: { weightPct: number }[] };
    base.legs[1]!.weightPct = 20; // 65 + 20 = 85
    const resolved = await resolveMandate(base, feed);
    expect(resolved.warnings.join(" ")).toContain("85");
  });
});

describe("the template", () => {
  it("parses, and asks for no bridging or volatile exposure", () => {
    const mandate = MandateSchema.parse(template());
    expect(mandate.id).toBe("fi-lend-lp-base-v1");
    expect(mandate.chain).toBe("Base");
    // Every leg is on the data chain and selects stablecoins, which is what keeps the execution path
    // free of bridging and of price risk — the low-edge-case property the template exists to have.
    for (const leg of mandate.legs) {
      expect(leg.poolSelector.chain).toBe(mandate.chain);
      expect(leg.poolSelector.stablecoin).toBe(true);
    }
    expect(mandate.approval.mode).toBe("batch");
  });
});

describe("createYieldsFeed", () => {
  it("fetches once and reuses the snapshot", async () => {
    let calls = 0;
    const feed = createYieldsFeed({
      url: "https://yields.test/pools",
      fetchImpl: (async () => {
        calls += 1;
        return { ok: true, json: async () => ({ data: ROWS }) };
      }) as unknown as typeof fetch,
    });
    await feed.snapshot();
    await feed.snapshot();
    expect(calls).toBe(1);
  });

  it("survives rows it does not model, since the feed is third-party", async () => {
    const feed = createYieldsFeed({
      url: "https://yields.test/pools",
      fetchImpl: (async () => ({
        ok: true,
        json: async () => ({ data: [...ROWS, { unexpected: "shape" }] }),
      })) as unknown as typeof fetch,
    });
    const snapshot = await feed.snapshot();
    expect(snapshot.rows).toHaveLength(ROWS.length);
  });

  it("fails loudly when the feed is not the shape it claims", async () => {
    const feed = createYieldsFeed({
      url: "https://yields.test/pools",
      fetchImpl: (async () => ({
        ok: true,
        json: async () => ({ nope: true }),
      })) as unknown as typeof fetch,
    });
    await expect(feed.snapshot()).rejects.toThrow(/did not return a `data` array/);
  });
});
