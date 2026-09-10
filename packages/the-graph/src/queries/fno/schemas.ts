import { z } from 'zod';
import { ZodBigNumberString, ZodNonNegativeBigNumberString } from '../../query/scalars.js';

/**
 * F&O (perp futures) query templates — Messari Derivatives Perpetual Futures
 * schema v1.3.4. Entity/field names mirror SUBGRAPH_SPEC.md §9 exactly; the
 * EMS risk engine and dashboard consume these shapes.
 */

export const FinancialMetricSchema = z.object({
  days: z.number(),
  dailyVolumeUSD: ZodNonNegativeBigNumberString,
  dailyTotalOpenInterestUSD: ZodBigNumberString,
  dailyTotalRevenueUSD: ZodBigNumberString,
  dailySupplySideRevenueUSD: ZodBigNumberString,
  dailyProtocolSideRevenueUSD: ZodBigNumberString,
});

export const ProtocolSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  totalValueLockedUSD: ZodBigNumberString,
  longOpenInterestUSD: ZodBigNumberString,
  shortOpenInterestUSD: ZodBigNumberString,
  totalOpenInterestUSD: ZodBigNumberString,
  cumulativeVolumeUSD: ZodBigNumberString,
  cumulativeTotalRevenueUSD: ZodBigNumberString,
  financialMetrics: z.array(FinancialMetricSchema),
});

export const HourlySnapshotSchema = z.object({
  hours: z.number(),
  hourlyFundingrate: ZodBigNumberString,
  hourlyVolumeUSD: ZodNonNegativeBigNumberString,
  hourlyTotalOpenInterestUSD: ZodBigNumberString,
});

export const FundingSnapshotSchema = z.object({
  id: z.string(),
  fundingrate: z.array(ZodBigNumberString),
  inputTokenBalances: z.array(ZodBigNumberString),
  inputTokenWeights: z.array(ZodBigNumberString),
  totalValueLockedUSD: ZodBigNumberString,
  hourlySnapshots: z.array(HourlySnapshotSchema),
});

export const PositionRowSchema = z.object({
  id: z.string(),
  side: z.enum(['LONG', 'SHORT']),
  leverage: ZodBigNumberString,
  balance: ZodBigNumberString,
  balanceUSD: ZodBigNumberString,
  collateralBalanceUSD: ZodBigNumberString,
  realisedPnlUSD: ZodBigNumberString.nullable().optional(),
  account: z.object({ id: z.string(), openPositionCount: z.number() }),
  fundingrateOpen: ZodBigNumberString.nullable().optional(),
  timestampOpened: z.string(),
});

export const TokenFdvRowSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  lastPriceUSD: ZodBigNumberString.nullable().optional(),
  totalSupply: ZodBigNumberString,
  maxSupply: ZodBigNumberString,
  fdvUSD: ZodBigNumberString.nullable().optional(),
  circulatingMarketCapUSD: ZodBigNumberString.nullable().optional(),
});

export const DeltaRowSchema = z.object({
  id: z.string(),
  hash: z.string(),
  blockNumber: z.string(),
  timestamp: z.string(),
  amountInUSD: z.string().optional(),
  amountOutUSD: z.string().optional(),
});

export type FinancialMetric = z.infer<typeof FinancialMetricSchema>;
export type ProtocolSnapshot = z.infer<typeof ProtocolSnapshotSchema>;
export type HourlySnapshot = z.infer<typeof HourlySnapshotSchema>;
export type FundingSnapshot = z.infer<typeof FundingSnapshotSchema>;
export type PositionRow = z.infer<typeof PositionRowSchema>;
export type TokenFdvRow = z.infer<typeof TokenFdvRowSchema>;
export type DeltaRow = z.infer<typeof DeltaRowSchema>;

