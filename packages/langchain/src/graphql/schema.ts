import { z } from 'zod';

/**
 * Zod schemas for tool input validation.
 * These validate the parameters passed to each tool before query generation.
 */

// ─── Common Schemas ───────────────────────────────────────────────────────────

export const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

// ─── Greek Tool Input Schemas ─────────────────────────────────────────────────

export const DeltaInputSchema = z.object({
  protocolId: AddressSchema,
  poolId: AddressSchema,
  includeTokenPrices: z.boolean().default(true),
  includeProtocolOi: z.boolean().default(true),
});

export type DeltaInput = z.infer<typeof DeltaInputSchema>;

export const GammaInputSchema = z.object({
  protocolId: AddressSchema,
  poolId: AddressSchema,
  includeLeverageDistribution: z.boolean().default(true),
});

export type GammaInput = z.infer<typeof GammaInputSchema>;

export const VegaInputSchema = z.object({
  poolId: AddressSchema,
  hours: z.number().int().min(1).max(720).default(24),
  annualize: z.boolean().default(true),
});

export type VegaInput = z.infer<typeof VegaInputSchema>;

export const ThetaInputSchema = z.object({
  poolId: AddressSchema,
  includeFundingAccrual: z.boolean().default(true),
});

export type ThetaInput = z.infer<typeof ThetaInputSchema>;

export const RhoInputSchema = z.object({
  protocolId: AddressSchema,
  poolId: AddressSchema,
  rateShiftBasisPoints: z.number().int().default(100),
});

export type RhoInput = z.infer<typeof RhoInputSchema>;

// ─── Risk Tool Input Schemas ──────────────────────────────────────────────────

export const VaRInputSchema = z.object({
  protocolId: AddressSchema,
  confidenceLevels: z.array(z.number().min(0.9).max(0.99)).default([0.95, 0.99]),
  method: z.enum(['historical', 'monte-carlo', 'both']).default('historical'),
  simulations: z.number().int().min(100).max(100000).default(10000),
});

export type VaRInput = z.infer<typeof VaRInputSchema>;

export const MertonPDInputSchema = z.object({
  poolId: AddressSchema,
  includePositions: z.boolean().default(true),
});

export type MertonPDInput = z.infer<typeof MertonPDInputSchema>;

export const DurationInputSchema = z.object({
  poolId: AddressSchema,
  includeConvexity: z.boolean().default(true),
});

export type DurationInput = z.infer<typeof DurationInputSchema>;

export const StressTestInputSchema = z.object({
  protocolId: AddressSchema,
  poolId: AddressSchema.optional(),
  scenarios: z.array(z.enum([
    'flash-crash',
    'rate-hike',
    'defi-hack',
    'stablecoin-depeg',
    'regulatory-ban',
    'correlation-spike',
  ])).default(['flash-crash', 'rate-hike', 'defi-hack']),
});

export type StressTestInput = z.infer<typeof StressTestInputSchema>;

// ─── Query Tool Input Schemas ─────────────────────────────────────────────────

export const ProtocolSnapshotInputSchema = z.object({
  protocolId: AddressSchema,
});

export type ProtocolSnapshotInput = z.infer<typeof ProtocolSnapshotInputSchema>;

export const FundingInputSchema = z.object({
  poolId: AddressSchema,
  hours: z.number().int().min(1).max(720).default(24),
});

export type FundingInput = z.infer<typeof FundingInputSchema>;

export const OpenPositionsInputSchema = z.object({
  poolId: AddressSchema,
  first: z.number().int().min(1).max(1000).default(1000),
  lastID: z.string().optional(),
});

export type OpenPositionsInput = z.infer<typeof OpenPositionsInputSchema>;

export const FdvTokensInputSchema = z.object({
  first: z.number().int().min(1).max(1000).default(500),
  lastID: z.string().optional(),
});

export type FdvTokensInput = z.infer<typeof FdvTokensInputSchema>;

export const DeltasInputSchema = z.object({
  lastBlock: z.number().int().min(0),
  lastID: z.string().optional(),
  first: z.number().int().min(1).max(1000).default(500),
});

export type DeltasInput = z.infer<typeof DeltasInputSchema>;
