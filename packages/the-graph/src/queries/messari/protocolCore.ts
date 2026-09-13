/**
 * Messari-standard query catalog — the shared core, across all categories.
 *
 * ## Why these live in one file rather than per-category
 *
 * The Messari standard gives lending, liquid staking, perpetuals and (where genuinely
 * implemented) DEX the *same* entity names. A protocol's category is therefore a
 * routing concern, not a query concern: the same `protocols` query answers for Lido and
 * for GMX. Splitting these per-category would duplicate identical SDL and let the
 * copies drift, which is the opposite of what a standard buys you.
 *
 * ## Every query here requires a Messari-standard deployment
 *
 * `protocols`, `financialsDailySnapshots`, `usageMetricsDailySnapshots` and `pools` do
 * not exist on subgraphs that use their protocol's native schema — `uniswap-v3` is the
 * live counter-example. Running these against one fails with a GraphQL field error, by
 * design: the failure is the signal that the deployment is not standard.
 *
 * `orderBy` is written as a literal rather than a variable because the enum type name
 * differs per entity (`Protocol_orderBy`, `FinancialsDailySnapshot_orderBy`, …), so a
 * shared variable type is impossible. The literal is validated on first request, and
 * `scripts/messari-probe.ts` is what makes that validation happen before use.
 */
import { z } from 'zod';
import { defineQuery } from '../../query/QueryDefinition.js';
import {
  MessariFinancialsSnapshotSchema,
  MessariPoolSchema,
  MessariProtocolSchema,
  MessariTokenSchema,
  MessariUsageSnapshotSchema,
  SubgraphMetaSchema,
} from './schemas.js';

/** Shared page-size variable. Bounded because a subgraph will happily try to return everything. */
const page = z.object({ first: z.number().int().positive().max(1000) });

/**
 * Top protocols by TVL.
 *
 * The entry point for a category-level read: "what is the largest venue here, and what
 * is it earning". Works on every Messari-standard schema because `Protocol` is the one
 * entity they all share.
 *
 * `slug` is not selected — see `MessariProtocolSchema` for why requiring it excluded
 * every Aave deployment.
 */
export const messariProtocols = defineQuery({
  id: 'the-graph.messari.protocols',
  operationName: 'MessariProtocols',
  sdl: `
    query MessariProtocols($first: Int!) {
      protocols(first: $first, orderBy: totalValueLockedUSD, orderDirection: desc) {
        id
        name
        network
        type
        totalValueLockedUSD
        cumulativeTotalRevenueUSD
        cumulativeSupplySideRevenueUSD
        cumulativeProtocolSideRevenueUSD
        totalPoolCount
      }
    }`,
  variables: page,
  response: z.object({ protocols: z.array(MessariProtocolSchema) }),
});

/**
 * A single protocol's daily financial history, most recent first.
 *
 * The revenue split is the fixed-income signal: supply-side is what depositors earned,
 * protocol-side is what the venue kept, and the two together reconcile to total.
 */
export const messariProtocolFinancials = defineQuery({
  id: 'the-graph.messari.protocolFinancials',
  operationName: 'MessariProtocolFinancials',
  sdl: `
    query MessariProtocolFinancials($first: Int!) {
      financialsDailySnapshots(first: $first, orderBy: timestamp, orderDirection: desc) {
        id
        totalValueLockedUSD
        dailySupplySideRevenueUSD
        cumulativeSupplySideRevenueUSD
        dailyProtocolSideRevenueUSD
        cumulativeProtocolSideRevenueUSD
        dailyTotalRevenueUSD
        cumulativeTotalRevenueUSD
        timestamp
      }
    }`,
  variables: page,
  response: z.object({ financialsDailySnapshots: z.array(MessariFinancialsSnapshotSchema) }),
});

/** Daily usage metrics, most recent first. Demand-side evidence behind a yield. */
export const messariProtocolUsage = defineQuery({
  id: 'the-graph.messari.protocolUsage',
  operationName: 'MessariProtocolUsage',
  sdl: `
    query MessariProtocolUsage($first: Int!) {
      usageMetricsDailySnapshots(first: $first, orderBy: timestamp, orderDirection: desc) {
        id
        dailyActiveUsers
        cumulativeUniqueUsers
        dailyTransactionCount
        totalPoolCount
        timestamp
      }
    }`,
  variables: page,
  response: z.object({ usageMetricsDailySnapshots: z.array(MessariUsageSnapshotSchema) }),
});

/**
 * Pools by TVL — where an allocation would actually land.
 *
 * ## Narrower than it looks: `Pool` is a `generic`-schema entity only
 *
 * Introspected across all three: `Pool` exists on `lido` (generic) with 24 fields, and
 * does **not** exist at all on `aave-amm` (lending) or `apeswap` (dex-amm). Those cores
 * name the same concept differently — lending uses `Reserve`, dex uses
 * `LiquidityPool` — so this query is valid for **liquid staking**, and must not be
 * assumed available just because a deployment passes the core gate.
 *
 * Kept as one query rather than three because the shape it returns (id, symbol, TVL,
 * revenue, output-token price) is what a mandate reads from a venue, and the category
 * determines which protocol-specific entity has to be queried to get it.
 */
export const messariProtocolPools = defineQuery({
  id: 'the-graph.messari.protocolPools',
  operationName: 'MessariProtocolPools',
  sdl: `
    query MessariProtocolPools($first: Int!) {
      pools(first: $first, orderBy: totalValueLockedUSD, orderDirection: desc) {
        id
        symbol
        totalValueLockedUSD
        cumulativeTotalRevenueUSD
        outputTokenPriceUSD
      }
    }`,
  variables: page,
  response: z.object({ pools: z.array(MessariPoolSchema) }),
});

/** Tokens with a USD price — the input to FDV and valuation math. */
export const messariTokens = defineQuery({
  id: 'the-graph.messari.tokens',
  operationName: 'MessariTokens',
  sdl: `
    query MessariTokens($first: Int!) {
      tokens(first: $first, orderBy: lastPriceUSD, orderDirection: desc) {
        id
        name
        symbol
        decimals
        lastPriceUSD
      }
    }`,
  variables: page,
  response: z.object({ tokens: z.array(MessariTokenSchema) }),
});

/**
 * The conformance gate: `_meta` plus one row of the **full core** `Protocol` selection.
 *
 * Deliberately the same field set as {@link messariProtocols}, because the question the
 * gate has to answer is not "does this subgraph respond" but **"will the core queries
 * run against it"**. A minimal `id`-only check answers the first question and gets the
 * second wrong — verified, not assumed:
 *
 *   - `uniswap-v3` fails with *no field `protocols`* → a **native** schema.
 *   - `aave-v3` also fails, on *no field `name`*: its `Protocol` is `{ id, pools }`
 *     with no TVL and no `FinancialsDailySnapshot` entity at all → Messari-shaped but
 *     an **older revision** of the schema.
 *
 * Both are alive; neither can run the core queries. Including `_meta` in the same
 * document means one round trip yields both the verdict and the block height, and a
 * GraphQL field error is itself proof the endpoint answered — so no separate health
 * call is needed to tell "wrong schema" from "not there".
 */
export const messariProbe = defineQuery({
  id: 'the-graph.messari.probe',
  operationName: 'MessariProbe',
  sdl: `
    query MessariProbe {
      _meta {
        block {
          number
          hash
          timestamp
        }
        hasIndexingErrors
      }
      protocols(first: 1) {
        id
        name
        network
        type
        totalValueLockedUSD
        cumulativeTotalRevenueUSD
        cumulativeSupplySideRevenueUSD
        cumulativeProtocolSideRevenueUSD
        totalPoolCount
      }
    }`,
  variables: z.object({}),
  response: z.object({
    _meta: SubgraphMetaSchema,
    protocols: z.array(MessariProtocolSchema),
  }),
});
