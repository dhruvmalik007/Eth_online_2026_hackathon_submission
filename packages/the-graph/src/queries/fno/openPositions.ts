import { z } from 'zod';
import { defineQuery } from '../../query/QueryDefinition.js';
import { PositionRowSchema, TokenFdvRowSchema } from './schemas.js';

/** Open positions for a pool, cursor-paginated by id (id_gt). */
export const fnoOpenPositions = defineQuery({
  id: 'the-graph.fno.openPositions',
  operationName: 'OpenPositions',
  sdl: `
    query OpenPositions($pool: Bytes!, $first: Int!, $lastID: Bytes) {
      positions(
        first: $first
        where: { liquidityPool: $pool, hashClosed: null, id_gt: $lastID }
        orderBy: id
        orderDirection: asc
      ) {
        id
        side
        leverage
        balance
        balanceUSD
        collateralBalanceUSD
        realisedPnlUSD
        account { id openPositionCount }
        fundingrateOpen
        timestampOpened
      }
    }
  `,
  variables: z.object({
    pool: z.string().min(1),
    first: z.number().int().positive().max(1000),
    lastID: z.string().optional(),
  }),
  response: z.object({ positions: z.array(PositionRowSchema) }),
  pagination: { listPath: ['positions'], cursorArg: 'lastID', pageSizeArg: 'first' },
});

/** Tokens with FDV metrics, cursor-paginated by id (id_gt). */
export const fnoFdvTokens = defineQuery({
  id: 'the-graph.fno.fdvTokens',
  operationName: 'Fdv',
  sdl: `
    query Fdv($first: Int!, $lastID: Bytes) {
      tokens(first: $first, where: { id_gt: $lastID, fdvUSD_not: null }) {
        id
        symbol
        lastPriceUSD
        totalSupply
        maxSupply
        fdvUSD
        circulatingMarketCapUSD
      }
    }
  `,
  variables: z.object({
    first: z.number().int().positive().max(1000),
    lastID: z.string().optional(),
  }),
  response: z.object({ tokens: z.array(TokenFdvRowSchema) }),
  pagination: { listPath: ['tokens'], cursorArg: 'lastID', pageSizeArg: 'first' },
});
