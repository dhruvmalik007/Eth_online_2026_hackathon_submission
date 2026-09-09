import { z } from 'zod';

/**
 * Wire-shape scalars for subgraph responses. Subgraph big-numbers arrive as
 * strings (often RAY/WAD-scaled); they stay strings through validation and
 * conversion to numbers happens at exactly one boundary in extractors
 * (units contract). Validation enforces the string-shape so drift fails here.
 */

/** Subgraph BigDecimal/BigInt — a decimal string, e.g. "1234.5678" or "-42". */
export const ZodBigNumberString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'expected a decimal string (subgraph BigDecimal/BigInt)');

/** Non-negative big-number string (volumes, TVL, supply). */
export const ZodNonNegativeBigNumberString = ZodBigNumberString.refine(
  (s) => !s.startsWith('-'),
  { message: 'expected a non-negative decimal string' },
);

/** bytes32 pool id (Uniswap v4) — 0x + 64 hex chars. */
export const ZodBytes32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'expected bytes32 (0x + 64 hex chars)');

/** EVM address — 0x + 40 hex chars. */
export const ZodAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'expected an EVM address (0x + 40 hex chars)');

/**
 * RAY-scaled rate string (27 decimals), e.g. Aave liquidityRate.
 * Kept as string; conversion to human APY happens in LendingExtractor.
 */
export const ZodRayRate = ZodBigNumberString;

/** USD value string with 8 decimals from subgraphs (e.g. volumeUSD). */
export const ZodUsdString = ZodNonNegativeBigNumberString;
