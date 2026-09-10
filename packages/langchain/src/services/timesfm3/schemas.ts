import { z } from 'zod';

/**
 * Pinned contract of the deployed `timesfm3-inference` Cloud Run service
 * (verified live 2026-09-10 — see docs/timesfm3-service.md).
 */

export const PredictRequestSchema = z.object({
  series: z.array(z.number()).min(2),
  horizon: z.number().int().positive().max(1024).default(30),
  /** [num_cov][context_len] — features known only historically. */
  pastCovariates: z.array(z.array(z.number())).nullable().default(null),
  /** [num_cov][context_len + horizon] — known future signals (lookahead). */
  futureCovariates: z.array(z.array(z.number())).nullable().default(null),
  returnQuantiles: z.boolean().default(true),
});

export type PredictRequest = z.infer<typeof PredictRequestSchema>;
/** Caller-facing request shape (defaults optional). */
export type PredictRequestInput = z.input<typeof PredictRequestSchema>;

export const ProtocolPredictRequestSchema = z.object({
  protocolSlug: z.string().min(1),
  horizon: z.number().int().positive().max(365).default(30),
  metric: z.enum(['tvl', 'apy', 'volume']).default('tvl'),
});

export type ProtocolPredictRequest = z.infer<typeof ProtocolPredictRequestSchema>;
/** Caller-facing request shape (defaults optional). */
export type ProtocolPredictRequestInput = z.input<typeof ProtocolPredictRequestSchema>;

/** Raw wire response: point path + 9-quantile matrix per horizon step. */
export const PredictResponseSchema = z.object({
  point_forecast: z.array(z.number()).min(1),
  quantiles: z.array(z.array(z.number())),
  quantile_levels: z.array(z.number()),
  horizon: z.number().int().positive(),
  model: z.string(),
  latency_ms: z.number(),
});

export type PredictResponse = z.infer<typeof PredictResponseSchema>;

/** Validated, client-facing forecast: one quantile-triplet per step. */
export const TimesFMForecastSchema = z.object({
  target: z.string(),
  horizon: z.number().int().positive(),
  steps: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        q10: z.number(),
        q50: z.number(),
        q90: z.number(),
      }),
    )
    .min(1),
  model: z.string(),
  latencyMs: z.number(),
  /** Guardrail flags — populated by the sanity checks in client.ts. */
  flags: z.object({
    quantileMonotonic: z.boolean(),
    scaleSuspicious: z.boolean(),
  }),
});

export type TimesFMForecast = z.infer<typeof TimesFMForecastSchema>;

export const ProtocolForecastSchema = z.object({
  protocolSlug: z.string(),
  metric: z.enum(['tvl', 'apy', 'volume']),
  forecast: TimesFMForecastSchema,
});

export type ProtocolForecast = z.infer<typeof ProtocolForecastSchema>;
