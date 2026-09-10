import { z } from 'zod';
import { defineQuery } from '../../query/QueryDefinition.js';
import { DeltaRowSchema } from './schemas.js';

/**
 * Incremental delta pull since last seen block — the poller's hot path
 * (cost-controlled). Swaps and liquidations in one round trip.
 */
export const fnoDeltas = defineQuery({
  id: 'the-graph.fno.deltas',
  operationName: 'Deltas',
  sdl: `
    query Deltas($lastBlock: Int!, $lastID: Bytes, $first: Int!) {
      swaps(first: $first, where: { _change_block: { number_gte: $lastBlock }, id_gt: $lastID }) {
        id
        hash
        blockNumber
        timestamp
        amountInUSD
        amountOutUSD
      }
      liquidates(first: $first, where: { _change_block: { number_gte: $lastBlock } }) {
        id
        hash
        blockNumber
        timestamp
      }
    }
  `,
  variables: z.object({
    lastBlock: z.number().int().nonnegative(),
    lastID: z.string().optional(),
    first: z.number().int().positive().max(1000),
  }),
  response: z.object({
    swaps: z.array(DeltaRowSchema),
    liquidates: z.array(DeltaRowSchema),
  }),
});
