/**
 * Wire schemas for Messari's **standardized** subgraph entities.
 *
 * ## The caveat that shapes this file
 *
 * Messari's `deployment.json` labels each deployment with a schema name, but the
 * label records *intent*, not what the deployment exposes. Verified by introspection:
 *
 *   - `lido` (labelled `generic`), `rocket-pool`, `gmx` (`derivatives-perpfutures`)
 *     and `aave-v3` (`lending`) all expose the Messari core — `Protocol`,
 *     `FinancialsDailySnapshot`, `UsageMetricsDailySnapshot`.
 *   - `uniswap-v3` is labelled `dex-amm` but exposes Uniswap's **native** entities
 *     (`poolDayData`, `poolHourData`, `swaps`, `factory`) and has **no**
 *     `usageMetricsDailySnapshots`, no `lastPriceUSD` on `Token`, and no `protocols`
 *     field at all.
 *
 * So these schemas describe the Messari standard, and a query using them is valid only
 * against a deployment that actually implements it. `scripts/messari-probe.ts` is the
 * gate that decides which ones do, rather than trusting the label.
 *
 * ## Types, sampled rather than assumed
 *
 * Every field type here was read off a live response. Messari serialises its
 * `BigDecimal`/`BigInt` values as **decimal strings** (`"21004088324.02…"`), keeps
 * `timestamp` as a string, and uses real GraphQL `Int` for counters (`totalPoolCount`,
 * `dailyActiveUsers`). Guessing any of these would put a tolerant validator in front of
 * a risk number, which is the failure this package exists to prevent.
 */
import { z } from 'zod';
import { ZodNonNegativeBigNumberString } from '../../query/scalars.js';

/**
 * Messari `Protocol` — the entity every standard schema shares, at its modern revision.
 *
 * Field set: TVL, the three-way revenue split a fixed-income reading depends on, and
 * the pool/users counts.
 *
 * ## This entity is versioned, and older deployments do not satisfy it
 *
 * "Messari standard" is not one schema. Probed directly:
 *
 *   - `lido`, `rocket-pool` (`generic`) and `gmx` (`derivatives-perpfutures`) expose
 *     every field below.
 *   - `aave-v3`'s deployment exposes `Protocol { id, pools }` **only** — no `name`, no
 *     `totalValueLockedUSD`, and no `FinancialsDailySnapshot` entity at all. It is
 *     Messari-shaped but implements an older revision, so no query in this file works
 *     against it.
 *
 * That is why `slug` is not selected (it excluded Aave needlessly while proving
 * nothing) and why the requirement is documented rather than assumed:
 * `scripts/messari-probe.ts` decides per deployment which of these will run.
 */
export const MessariProtocolSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  /** Messari's uppercase network name, e.g. `MAINNET`, `ARBITRUM_ONE`. */
  network: z.string(),
  /** Messari's protocol type, e.g. `GENERIC`, `PERPETUAL`, `LENDING`. */
  type: z.string(),
  totalValueLockedUSD: ZodNonNegativeBigNumberString,
  cumulativeTotalRevenueUSD: ZodNonNegativeBigNumberString,
  cumulativeSupplySideRevenueUSD: ZodNonNegativeBigNumberString,
  cumulativeProtocolSideRevenueUSD: ZodNonNegativeBigNumberString,
  totalPoolCount: z.number().int().nonnegative(),
});
export type MessariProtocol = z.infer<typeof MessariProtocolSchema>;

/**
 * Messari `FinancialsDailySnapshot` — the protocol's daily financial time series.
 *
 * `protocol` is deliberately **not** selected: every endpoint backs exactly one
 * protocol, so the relation is implicit, and sampling showed the field is not
 * reliably populated. Requiring it would fail a valid response.
 */
export const MessariFinancialsSnapshotSchema = z.object({
  id: z.string().min(1),
  totalValueLockedUSD: ZodNonNegativeBigNumberString,
  dailySupplySideRevenueUSD: ZodNonNegativeBigNumberString,
  cumulativeSupplySideRevenueUSD: ZodNonNegativeBigNumberString,
  dailyProtocolSideRevenueUSD: ZodNonNegativeBigNumberString,
  cumulativeProtocolSideRevenueUSD: ZodNonNegativeBigNumberString,
  dailyTotalRevenueUSD: ZodNonNegativeBigNumberString,
  cumulativeTotalRevenueUSD: ZodNonNegativeBigNumberString,
  /** Unix seconds, as a string. */
  timestamp: ZodNonNegativeBigNumberString,
});
export type MessariFinancialsSnapshot = z.infer<typeof MessariFinancialsSnapshotSchema>;

/** Messari `UsageMetricsDailySnapshot` — demand-side activity, daily. */
export const MessariUsageSnapshotSchema = z.object({
  id: z.string().min(1),
  dailyActiveUsers: z.number().int().nonnegative(),
  cumulativeUniqueUsers: z.number().int().nonnegative(),
  dailyTransactionCount: z.number().int().nonnegative(),
  totalPoolCount: z.number().int().nonnegative(),
  timestamp: ZodNonNegativeBigNumberString,
});
export type MessariUsageSnapshot = z.infer<typeof MessariUsageSnapshotSchema>;

/**
 * Messari `Pool` — one yield-bearing position, reduced to what a mandate reads.
 *
 * `name` is omitted on purpose: it exists on the Messari `Pool` (verified on lido) but
 * not on Uniswap's native `Pool`, so selecting it would make this entity fail on any
 * deployment that drifts from the standard. `symbol`, TVL and revenue are the portable
 * subset.
 */
export const MessariPoolSchema = z.object({
  id: z.string().min(1),
  symbol: z.string(),
  totalValueLockedUSD: ZodNonNegativeBigNumberString,
  cumulativeTotalRevenueUSD: ZodNonNegativeBigNumberString,
  /** Price of the pool's output token in USD, as a decimal string. */
  outputTokenPriceUSD: ZodNonNegativeBigNumberString,
});
export type MessariPool = z.infer<typeof MessariPoolSchema>;

/** Messari `Token` — enough for valuation; `lastPriceUSD` is what FDV math needs. */
export const MessariTokenSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  symbol: z.string(),
  decimals: z.number().int().nonnegative(),
  lastPriceUSD: ZodNonNegativeBigNumberString,
});
export type MessariToken = z.infer<typeof MessariTokenSchema>;

/**
 * The `_meta` payload every subgraph answers with.
 *
 * `hasIndexingErrors` is the field that makes a freshness check honest: a deployment
 * can be at the chain head and still be serving wrong numbers.
 */
export const SubgraphMetaSchema = z.object({
  block: z.object({
    number: z.number().int().nonnegative(),
    hash: z.string().nullable().optional(),
    timestamp: z.number().int().nullable().optional(),
  }),
  hasIndexingErrors: z.boolean(),
});
export type SubgraphMeta = z.infer<typeof SubgraphMetaSchema>;
