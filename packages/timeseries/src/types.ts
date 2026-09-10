import { z } from 'zod';

/**
 * Row schemas for the EMS time-series store. Numeric columns round-trip as
 * strings over pg; validation enforces decimal-string shape so drift fails
 * at the boundary (same discipline as the-graph wire scalars).
 */

const NumericColumn = z
  .union([z.string().regex(/^-?\d+(\.\d+)?$/), z.number(), z.null()])
  .transform((v) => (v === null ? null : Number(v)));

export const PoolMetricRowSchema = z.object({
  poolId: z.string().min(1),
  ts: z.date(),
  protocol: z.string().min(1),
  network: z.string().min(1),
  apy: z.number().nullable().optional(),
  volumeUsd: z.number().nullable().optional(),
  tvlUsd: z.number().nullable().optional(),
  utilization: z.number().nullable().optional(),
  vol: z.number().nullable().optional(),
  txCount: z.number().int().nullable().optional(),
});

export type PoolMetricRow = z.infer<typeof PoolMetricRowSchema>;

/** Raw pg row shape (snake_case columns, numerics possibly as strings). */
export const PoolMetricWireSchema = z.object({
  pool_id: z.string(),
  ts: z.date(),
  protocol: z.string(),
  network: z.string(),
  apy: NumericColumn.nullable().optional(),
  volume_usd: NumericColumn.nullable().optional(),
  tvl_usd: NumericColumn.nullable().optional(),
  utilization: NumericColumn.nullable().optional(),
  vol: NumericColumn.nullable().optional(),
  tx_count: NumericColumn.nullable().optional(),
});

/** A single forecast step: the three quantiles the risk math consumes. */
export const ForecastStepSchema = z.object({
  ts: z.date(),
  q10: z.number(),
  q50: z.number(),
  q90: z.number(),
});

export type ForecastStep = z.infer<typeof ForecastStepSchema>;

export const ForecastRecordSchema = z.object({
  poolId: z.string().min(1),
  target: z.enum(['apy', 'volume', 'tvl', 'utilization']),
  steps: z.array(ForecastStepSchema).min(1),
  modelVersion: z.string().min(1),
  inputsHash: z.string().min(1),
});

export type ForecastRecord = z.infer<typeof ForecastRecordSchema>;

export const BacktestRunSchema = z.object({
  poolId: z.string().min(1),
  windowDays: z.number().int().positive(),
  strategy: z.string().min(1),
  hitRate: z.number().nullable().optional(),
  mape: z.number().nullable().optional(),
  pnlVsHodl: z.number().nullable().optional(),
});

export type BacktestRun = z.infer<typeof BacktestRunSchema>;

/** A metric window: the Category B matrix handed to TimesFM-3. */
export interface MetricWindow {
  readonly poolId: string;
  readonly metric: 'apy' | 'volume' | 'tvl' | 'utilization';
  readonly timestamps: readonly Date[];
  readonly values: readonly number[];
}
