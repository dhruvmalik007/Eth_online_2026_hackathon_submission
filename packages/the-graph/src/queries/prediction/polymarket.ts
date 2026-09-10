import { z } from 'zod';
import { defineQuery } from '../../query/QueryDefinition.js';
import { ZodBigNumberString } from '../../query/scalars.js';

/**
 * Polymarket prediction-market templates. The activity subgraph tracks
 * user positions/redemptions; the market structure lives in conditions +
 * fixed-product market makers.
 */

export const RedemptionSchema = z.object({
  id: z.string(),
  payout: ZodBigNumberString,
  redeemer: z.string(),
  timestamp: z.string(),
});

export type Redemption = z.infer<typeof RedemptionSchema>;

/** Multi-entity probe used by test-data CLI + health dashboards. */
export const predictionPolymarketProbe = defineQuery({
  id: 'the-graph.prediction.polymarketProbe',
  operationName: 'PolymarketData',
  sdl: `
    query PolymarketData($first: Int!) {
      _meta { block { number } }
      conditions(first: $first) { id }
      fixedProductMarketMakers(first: $first) { id }
      redemptions(first: $first, orderBy: payout, orderDirection: desc) {
        id
        payout
        redeemer
        timestamp
      }
      positions(first: $first) { id }
    }
  `,
  variables: z.object({ first: z.number().int().positive().max(100) }),
  response: z.object({
    _meta: z.object({ block: z.object({ number: z.number() }).nullable().optional() }).nullable().optional(),
    conditions: z.array(z.object({ id: z.string() })),
    fixedProductMarketMakers: z.array(z.object({ id: z.string() })),
    redemptions: z.array(RedemptionSchema),
    positions: z.array(z.object({ id: z.string() })),
  }),
});

/**
 * Activity variant: redemption feed ordered by recency (timestamp desc) with
 * `window`-sized market-structure counts — the volume/metrics tooling path.
 */
export const predictionPolymarketActivity = defineQuery({
  id: 'the-graph.prediction.polymarketActivity',
  operationName: 'PolymarketActivity',
  sdl: `
    query PolymarketActivity($window: Int!, $first: Int!) {
      _meta { block { number } }
      conditions(first: $window) { id }
      fixedProductMarketMakers(first: $window) { id }
      positions(first: $first) { id }
      redemptions(first: $first, orderBy: timestamp, orderDirection: desc) {
        id
        payout
        timestamp
      }
    }
  `,
  variables: z.object({
    window: z.number().int().positive().max(1000),
    first: z.number().int().positive().max(1000),
  }),
  response: z.object({
    _meta: z.object({ block: z.object({ number: z.number() }).nullable().optional() }).nullable().optional(),
    conditions: z.array(z.object({ id: z.string() })),
    fixedProductMarketMakers: z.array(z.object({ id: z.string() })),
    positions: z.array(z.object({ id: z.string() })),
    redemptions: z.array(
      z.object({
        id: z.string(),
        payout: ZodBigNumberString,
        timestamp: z.string(),
      }),
    ),
  }),
});
