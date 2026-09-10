import { z } from 'zod';

/**
 * Deterministic risk derivation from TimesFM-3 quantile steps — pure
 * functions, golden-tested. Units contract: decimal fractions internally
 * (0.04 = 4%); conversion happens only at the tool boundary.
 */

const StepSchema = z.object({
  q10: z.number(),
  q50: z.number(),
  q90: z.number(),
});

export type QuantileStep = z.infer<typeof StepSchema>;

export interface QuantileRisk {
  /** Mean (q50 − q10) band half-width — forecast uncertainty below the median. */
  readonly downsideBandWidth: number;
  /** Std-dev of the median path's step-to-step diffs (realized vol of the forecast). */
  readonly bandVol: number;
  /** Least-squares slope of the median path (per step). */
  readonly trendSlope: number;
  /** Worst-case yield loss by horizon end at 90% confidence: q50[0] − q10[last]. */
  readonly varDownside: number;
}

export function quantilesToRisk(steps: readonly QuantileStep[]): QuantileRisk {
  const parsed = z.array(StepSchema).min(2).parse(steps);
  const n = parsed.length;

  const downsideBandWidth =
    parsed.reduce((sum, s) => sum + (s.q50 - s.q10), 0) / n;

  const diffs = parsed.slice(1).map((s, i) => s.q50 - parsed[i]!.q50);
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const bandVol = Math.sqrt(
    diffs.reduce((sum, d) => sum + (d - meanDiff) ** 2, 0) / diffs.length,
  );

  // Least-squares slope over step index 0..n-1 on the median path.
  const sumX = ((n - 1) * n) / 2;
  const sumY = parsed.reduce((sum, s) => sum + s.q50, 0);
  const sumXY = parsed.reduce((sum, s, i) => sum + i * s.q50, 0);
  const sumX2 = ((n - 1) * n * (2 * n - 1)) / 6;
  const trendSlope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  const varDownside = Math.max(0, parsed[0]!.q50 - parsed[n - 1]!.q10);

  return { downsideBandWidth, bandVol, trendSlope, varDownside };
}
