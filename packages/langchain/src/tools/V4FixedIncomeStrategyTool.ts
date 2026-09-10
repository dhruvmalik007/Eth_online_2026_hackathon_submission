import { tool } from "@langchain/core/tools";
import * as z from "zod";
import { fetchMarketSnapshot, ZERO_HOOK, STABLES, rayToPercent } from "../pipeline/marketData.js";
import { computeStrategyFromSnapshot } from "../pipeline/strategy.js";

/**
 * v4FixedIncomeStrategy — end-to-end fixed-income strategy builder over Uniswap v4 books.
 *
 * Pipeline (all data live from The Graph — see docs/fixed-income-agent-walkthrough.md §3-5):
 *   1. v4 subgraph: volume-ordered pools + hooked books (DualPool-style candidates)
 *   2. per finalist: 14d day data → feeAPY; 168h hourly closes → realized vol sigma
 *   3. Aave V3 subgraph: lending APY for the hook's idle-capital leg
 *   4. fee slope k = feeAPY / sigma (fees scale with volume, hence with vol)
 *   5. netApy = (1-w)(k·sigma) + w·r − L²sigma²/8 ;  vega = k − L²sigma/4
 *   6. filter by minApr + vegaBudget, weight by Fixed-Income Efficiency Ratio
 *
 * Data-acquisition and quant blocks now live in pipeline/marketData.ts and
 * pipeline/strategy.ts (shared with the deterministic execution pipeline); this tool
 * delegates to them — behavior is unchanged.
 *
 * Returns structured JSON (weights, Greeks, exclusions, provenance) — the agent renders
 * the Markdown report from this; it never invents numbers.
 */

export const v4FixedIncomeStrategyTool = tool(
  async (input: unknown) => {
    const {
      minApr = 6,
      vegaBudget = 0.5,
      sizeUsd = 10_000_000,
      maxCandidates = 6,
      leverageStable = 20,
      leverageVolatile = 1,
      idleFractionHooked = 0.3,
      minVolumeUsd = 1_000_000,
      feeSlopeMode = "estimated",
    } = (input ?? {}) as {
      minApr?: number;
      vegaBudget?: number;
      sizeUsd?: number;
      maxCandidates?: number;
      leverageStable?: number;
      leverageVolatile?: number;
      idleFractionHooked?: number;
      minVolumeUsd?: number;
      feeSlopeMode?: "estimated" | "static";
    };

    try {
      const snapshot = await fetchMarketSnapshot({
        maxCandidates,
        leverageStable,
        leverageVolatile,
        idleFractionHooked,
        minVolumeUsd,
        feeSlopeMode,
      });

      if (snapshot.legs.length === 0) {
        return JSON.stringify({ error: "No v4 pools returned — check GATEWAY_API_KEY / subgraph health." });
      }

      const strategy = computeStrategyFromSnapshot(snapshot, {
        minAprPercent: minApr,
        vegaBudget,
        sizeUsd,
        minVolumeUsd,
      });

      const fallbackLendingApy = snapshot.aaveRates["USDC"] ?? snapshot.aaveRates["USDT"] ?? 0;

      return JSON.stringify(
        {
          constraints: { minApr, vegaBudget, sizeUsd, minVolumeUsd, feeSlopeMode },
          units: { apy: "PERCENT in this response", sigma: "DECIMAL", vega: "percentage points per +1 vol point" },
          math: {
            netApy: "(1-w)(feeAPY + k·sigma) + w·lendingAPY − L²·sigma²/8 − gasDrag",
            vega: "k − L²·sigma/4   [per unit sigma; /100 per vol point]",
            lvr: "L²·sigma²/8",
            weights: "proportional to Fixed-Income Efficiency Ratio = netAPY / LVR",
          },
          strategy: {
            legs: strategy.legs.map((l) => ({
              ...l,
              netApyPct: +(l.netApy * 100).toFixed(4),
              lvrPct: +(l.lvr * 100).toFixed(4),
              weightPct: +(l.weight * 100).toFixed(2),
              vegaPerVolPointUsd: +((l.vega / 100) * l.notionalUsd).toFixed(2),
              hook: l.hook ?? null,
              lendingLeg: l.hook
                ? `Aave V3 stable supply @ ${fallbackLendingApy.toFixed(2)}% (idle ${(idleFractionHooked * 100).toFixed(0)}%)`
                : "fee-only (no lending leg)",
            })),
            achievedAprPct: +(strategy.achievedApr * 100).toFixed(4),
            portfolioVegaPerUnitSigma: +strategy.portfolioVega.toFixed(4),
            portfolioVegaUsdPerVolPoint: +((strategy.portfolioVega / 100) * sizeUsd).toFixed(2),
            maxConcentrationPct: +(strategy.maxConcentration * 100).toFixed(1),
            meetsAprTarget: strategy.meetsAprTarget,
            withinVegaBudget: strategy.withinVegaBudget,
          },
          excluded: strategy.excluded,
          dataNotes: snapshot.dataNotes,
          provenance: {
            v4Subgraph: snapshot.v4SubgraphId,
            v4Block: snapshot.v4Block,
            aaveSubgraph: snapshot.aaveSubgraphId,
            aaveBlock: snapshot.aaveBlock,
            lendingRates: snapshot.aaveRates,
            toolCalls: 2 + snapshot.legs.length * 2 + 1,
          },
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify({ error: (error as Error).message });
    }
  },
  {
    name: "v4FixedIncomeStrategy",
    description:
      "Build an APR-constrained, vega-budgeted fixed-income LP strategy across Uniswap v4 books using live Graph data. Computes dual-yield APY (trading fees + hook lending leg), LVR rebalancing cost, and vega (k − L²σ/4), then allocates by Fixed-Income Efficiency Ratio. Returns weights, per-book Greeks, exclusions, and data provenance.",
    schema: z.object({
      minApr: z.number().optional().describe("Required net APR in % (default 6)"),
      vegaBudget: z.number().optional().describe("Max |vega| per unit sigma per book, e.g. 0.5 (default 0.5)"),
      sizeUsd: z.number().optional().describe("Total notional in USD (default 10,000,000)"),
      maxCandidates: z
        .number()
        .optional()
        .describe("How many top-by-volume books to analyze (default 6, each costs 2 subgraph queries)"),
      leverageStable: z.number().optional().describe("Capital efficiency L for stable/stable books (default 20)"),
      leverageVolatile: z
        .number()
        .optional()
        .describe("Capital efficiency L for books with an ETH/volatile leg (default 1 = full range)"),
      idleFractionHooked: z
        .number()
        .optional()
        .describe("Fraction of capital a DualPool-style hook sweeps to lending (default 0.3)"),
      minVolumeUsd: z.number().optional().describe("Minimum cumulative volume floor (default 1,000,000)"),
      feeSlopeMode: z
        .enum(["estimated", "static"])
        .optional()
        .describe("estimated: k=feeAPY/sigma (fees scale with vol); static: k=0, purely short-vol (default estimated)"),
    }),
  },
);

export { ZERO_HOOK, STABLES, rayToPercent };
