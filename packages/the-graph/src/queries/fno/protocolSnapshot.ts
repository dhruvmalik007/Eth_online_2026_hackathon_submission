import { z } from 'zod';
import { defineQuery } from '../../query/QueryDefinition.js';
import {
  FundingSnapshotSchema,
  ProtocolSnapshotSchema,
} from './schemas.js';

/** Protocol-level aggregate: TVL, OI, volumes, revenue, last 30 daily metrics. */
export const fnoProtocolSnapshot = defineQuery({
  id: 'the-graph.fno.protocolSnapshot',
  operationName: 'ProtocolSnapshot',
  sdl: `
    query ProtocolSnapshot($protocol: Bytes!) {
      derivPerpProtocol(id: $protocol) {
        id
        name
        totalValueLockedUSD
        longOpenInterestUSD
        shortOpenInterestUSD
        totalOpenInterestUSD
        cumulativeVolumeUSD
        cumulativeTotalRevenueUSD
        financialMetrics(first: 30, orderBy: days, orderDirection: desc) {
          days
          dailyVolumeUSD
          dailyTotalOpenInterestUSD
          dailyTotalRevenueUSD
          dailySupplySideRevenueUSD
          dailyProtocolSideRevenueUSD
        }
      }
    }
  `,
  variables: z.object({ protocol: z.string().min(1) }),
  response: z.object({ derivPerpProtocol: ProtocolSnapshotSchema.nullable() }),
});

/** Pool funding view: current rates + up to N hourly snapshots. */
export const fnoFunding = defineQuery({
  id: 'the-graph.fno.funding',
  operationName: 'Funding',
  sdl: `
    query Funding($pool: Bytes!, $hours: Int!) {
      liquidityPool(id: $pool) {
        id
        fundingrate
        inputTokenBalances
        inputTokenWeights
        totalValueLockedUSD
        hourlySnapshots(first: $hours, orderBy: hours, orderDirection: desc) {
          hours
          hourlyFundingrate
          hourlyVolumeUSD
          hourlyTotalOpenInterestUSD
        }
      }
    }
  `,
  variables: z.object({ pool: z.string().min(1), hours: z.number().int().positive().max(1000) }),
  response: z.object({ liquidityPool: FundingSnapshotSchema.nullable() }),
});
