import { z } from 'zod';
import { defineQuery } from '../../query/QueryDefinition.js';
import { ZodBigNumberString, ZodNonNegativeBigNumberString, ZodRayRate } from '../../query/scalars.js';

/**
 * Aave V3 lending query templates. Superset field list — covers both the
 * full `.graphql` catalog variant and the leaner tool variant; response
 * schemas validate exactly the fields the SDL selects.
 */

export const AaveReserveSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  totalLiquidity: ZodNonNegativeBigNumberString,
  totalCurrentVariableDebt: ZodBigNumberString,
  variableBorrowRate: ZodRayRate,
  liquidityRate: ZodRayRate,
  availableLiquidity: ZodNonNegativeBigNumberString,
  utilizationRate: ZodBigNumberString,
  decimals: z.number(),
  isActive: z.boolean(),
});

export type AaveReserve = z.infer<typeof AaveReserveSchema>;

/** Lending reserves ordered by total liquidity (deepest first). */
export const lendingAaveV3Reserves = defineQuery({
  id: 'the-graph.lending.aaveV3Reserves',
  operationName: 'AaveV3Reserves',
  sdl: `
    query AaveV3Reserves($first: Int!) {
      reserves(first: $first, orderBy: totalLiquidity, orderDirection: desc) {
        id
        symbol
        name
        totalLiquidity
        totalCurrentVariableDebt
        variableBorrowRate
        liquidityRate
        availableLiquidity
        utilizationRate
        decimals
        isActive
      }
    }
  `,
  variables: z.object({ first: z.number().int().positive().max(1000) }),
  response: z.object({ reserves: z.array(AaveReserveSchema) }),
});

/**
 * Pool-level utilization snapshot for aggregate metrics (no per-reserve name
 * or availability fields — smaller payload for the pool-metrics path).
 */
export const lendingAaveV3PoolMetrics = defineQuery({
  id: 'the-graph.lending.aaveV3PoolMetrics',
  operationName: 'AaveV3PoolMetrics',
  sdl: `
    query AaveV3PoolMetrics($first: Int!) {
      reserves(first: $first, orderBy: totalLiquidity, orderDirection: desc) {
        symbol
        totalLiquidity
        totalCurrentVariableDebt
        variableBorrowRate
        liquidityRate
        utilizationRate
        decimals
        isActive
      }
    }
  `,
  variables: z.object({ first: z.number().int().positive().max(1000) }),
  response: z.object({
    reserves: z.array(
      z.object({
        symbol: z.string(),
        totalLiquidity: ZodNonNegativeBigNumberString,
        totalCurrentVariableDebt: ZodBigNumberString,
        variableBorrowRate: ZodRayRate,
        liquidityRate: ZodRayRate,
        utilizationRate: ZodBigNumberString,
        decimals: z.number(),
        isActive: z.boolean(),
      }),
    ),
  }),
});

/** Health probe variant used by test-data CLI: tiny reserve slice + _meta. */
export const lendingProbe = defineQuery({
  id: 'the-graph.lending.probe',
  operationName: 'LendingProbe',
  sdl: `
    query LendingProbe($first: Int!) {
      _meta { block { number } }
      reserves(first: $first) {
        symbol
        totalLiquidity
        variableBorrowRate
        liquidityRate
      }
    }
  `,
  variables: z.object({ first: z.number().int().positive().max(100) }),
  response: z.object({
    _meta: z.object({ block: z.object({ number: z.number() }).nullable().optional() }).nullable().optional(),
    reserves: z.array(
      z.object({
        symbol: z.string(),
        totalLiquidity: ZodNonNegativeBigNumberString,
        variableBorrowRate: ZodRayRate,
        liquidityRate: ZodRayRate,
      }),
    ),
  }),
});

/**
 * Reserve risk parameters (liquidation threshold, reserve factor) — the
 * fixed-income strategy tool's input for LTV and stress math.
 */
export const lendingAaveV3RiskParams = defineQuery({
  id: 'the-graph.lending.aaveV3RiskParams',
  operationName: 'AaveV3RiskParams',
  sdl: `
    query AaveV3RiskParams($first: Int!) {
      reserves(first: $first, orderBy: totalLiquidity, orderDirection: desc) {
        symbol
        totalLiquidity
        totalCurrentVariableDebt
        variableBorrowRate
        liquidityRate
        utilizationRate
        decimals
        reserveLiquidationThreshold
        reserveFactor
      }
    }
  `,
  variables: z.object({ first: z.number().int().positive().max(1000) }),
  response: z.object({
    reserves: z.array(
      z.object({
        symbol: z.string(),
        totalLiquidity: ZodNonNegativeBigNumberString,
        totalCurrentVariableDebt: ZodBigNumberString,
        variableBorrowRate: ZodRayRate,
        liquidityRate: ZodRayRate,
        utilizationRate: ZodBigNumberString,
        decimals: z.number(),
        reserveLiquidationThreshold: ZodBigNumberString,
        reserveFactor: ZodBigNumberString,
      }),
    ),
  }),
});
