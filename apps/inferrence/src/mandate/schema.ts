import { z } from "zod";

/**
 * The mandate — what a fixed-income investor is asking for, stated in terms that resolve to real pools.
 *
 * This is the missing input that made the agent blind. `AgentRequest` requires `protocols` and `pools`,
 * `v01` refuses to start without them, and nothing produced them: the browser sends only a query, so
 * every run either failed or ran on fixtures. A mandate is the thing that turns a strategy description
 * into the specific pool identifiers the tools and the forecast need.
 *
 * Legs carry a **selector**, not a pool id. Pool ids are stable but they are also opaque, chain-scoped
 * and change on redeployment — hardcoding one would make the template a snapshot of today rather than a
 * standing instruction, and would put an unverifiable UUID in the repository. The selector is resolved
 * against the live feed at run time and the resolved id is recorded in the evidence, so what was chosen
 * is auditable after the fact.
 */

/** How a leg picks its pool. Every field narrows; the combination is the whole filter. */
export const PoolSelectorSchema = z.object({
  /** DefiLlama `project` slug, e.g. `aave-v3`, `uniswap-v4`, `morpho-blue`. */
  project: z.string().min(1),
  /** DefiLlama `chain` label, e.g. `Base`. Matches the feed's spelling, which is title-cased. */
  chain: z.string().min(1),
  /** Tokens that must all appear in the pool's symbol. `["USDC","USDT"]` matches `USDC-USDT`. */
  symbols: z.array(z.string().min(1)).default([]),
  /**
   * `single` for a one-sided position (a lending supply), `multi` for a two-sided one (an LP).
   * Pinned per leg because a leaderboard that mixes them compares incomparable risk: a lending APY and
   * an LP APY are not the same quantity, and the LP one carries impermanent loss.
   */
  exposure: z.enum(["single", "multi"]).optional(),
  /** Require the pool to be flagged stablecoin-only. The fixed-income legs all are. */
  stablecoin: z.boolean().optional(),
  /** A TVL floor, paired with the APY ranking. An APY without one is not a finding. */
  minTvlUsd: z.number().nonnegative().default(5_000_000),
  /**
   * Ranked by the 30-day mean, never spot `apy`. Spot values spike: a live Morpho query returned
   * vaults at 297,995%, which a leaderboard would have ranked first.
   */
  rankBy: z.literal("apyMean30d").default("apyMean30d"),
});

export const MandateLegSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["lend", "lp", "prediction", "bridge", "swap"]),
  protocol: z.string().min(1),
  /** Share of the notional, 0–100. Legs are normalised at resolution and a bad sum is reported. */
  weightPct: z.number().positive().max(100),
  /** The floor this leg must clear to be worth taking, in basis points. */
  minApyBps: z.number().optional(),
  poolSelector: PoolSelectorSchema,
  /** One clear sentence, shown to the operator on the approval screen. */
  intent: z.string().min(1),
});

export const MandateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().positive(),
  thesis: z.string().optional(),
  /** Where the data lives. */
  chain: z.string().min(1),
  /** Where the custodian settles. Stated separately because it is usually not the data chain. */
  settlementChain: z.string().min(1),
  horizonDays: z.number().int().positive(),
  notionalUsd: z.number().positive(),
  riskBudget: z
    .object({
      maxDrawdownPct: z.number().nonnegative().optional(),
      /**
       * Realised-volatility ceiling in bps — fed to the flight rule and mirrored off-chain/on-chain so
       * the two are checked against each other.
       */
      volCapBps: z.number().int().positive().optional(),
      minLiquidityUsd: z.number().nonnegative().optional(),
    })
    .default({}),
  legs: z.array(MandateLegSchema).min(1),
  approval: z
    .object({
      /** `batch` sends one Safe MultiSend; `per-leg` sends one transaction per leg. */
      mode: z.enum(["batch", "per-leg"]).default("batch"),
      required: z.boolean().default(true),
      maxSpendUsd: z.number().positive().optional(),
    })
    .default({ mode: "batch", required: true }),
  forecast: z
    .object({
      metric: z.literal("apy").default("apy"),
      horizonSteps: z.number().int().positive().default(30),
      /** Protocol-level TVL history is passed to the forecaster as a covariate of the pool APY. */
      covariate: z.literal("protocol-tvl").default("protocol-tvl"),
    })
    .default({ metric: "apy", horizonSteps: 30, covariate: "protocol-tvl" }),
});

export type PoolSelector = z.infer<typeof PoolSelectorSchema>;
export type MandateLeg = z.infer<typeof MandateLegSchema>;
export type Mandate = z.infer<typeof MandateSchema>;

/**
 * One row of `https://yields.llama.fi/pools`.
 *
 * Only the fields the resolver or the forecaster uses are declared, and the numeric ones are nullable
 * because DefiLlama genuinely returns null: `apyBase` and `apyReward` are frequently absent, and a
 * coerced `0` would read as "this leg earns nothing from base yield" rather than "the base yield was
 * not reported". `apy` is the total and is present whenever a pool is ranked.
 */
export const YieldsPoolRowSchema = z.object({
  pool: z.string().min(1),
  project: z.string(),
  chain: z.string(),
  symbol: z.string(),
  tvlUsd: z.number().nullable(),
  apy: z.number().nullable(),
  apyBase: z.number().nullable().optional(),
  apyReward: z.number().nullable().optional(),
  apyMean30d: z.number().nullable().optional(),
  ilRisk: z.string().optional(),
  exposure: z.string().optional(),
  stablecoin: z.boolean().optional(),
  /** The pool's history is fetched from here only when a mandate named it. */
  apyPct30D: z.number().nullable().optional(),
});

export const YieldsSnapshotSchema = z.object({
  status: z.string().optional(),
  data: z.array(YieldsPoolRowSchema),
});

export type YieldsPoolRow = z.infer<typeof YieldsPoolRowSchema>;
