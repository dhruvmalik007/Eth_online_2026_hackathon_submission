/**
 * Provenance for a TimesFM-3 forecast.
 *
 * The claim a forecast makes is not "the APY will be 3.55%" — it is "given *this*
 * window, the model returned *this* distribution". Without the window in the
 * record, the number is unfalsifiable: you cannot tell a forecast of the real
 * data from a forecast of a stale or truncated read, and the trace shows a
 * plausible figure either way.
 *
 * So the digest covers the **input values themselves**, not a label for them.
 * The previous `inputsHash` was `${poolId}:${target}:${days}d` — a description of
 * the request, not a hash of it. Every window for a given pool and horizon
 * produced the same string, which meant it could not have detected the one thing
 * it existed to detect: that the data changed underneath the forecast.
 */
import { createHash } from 'node:crypto';
import type { TimesFMForecast } from './schemas.js';

export interface ForecastProvenance {
  readonly poolId: string;
  readonly target: string;
  readonly model: string;
  readonly horizon: number;
  readonly windowDays: number;
  /**
   * Observations the model actually consumed.
   *
   * Recorded because FM3 has a hard minimum (8) and a short window is the most
   * common reason a forecast is quietly unreliable — it produces output either
   * way, so only the count distinguishes the two cases.
   */
  readonly inputPoints: number;
  readonly inputFrom: string | null;
  readonly inputTo: string | null;
  /** `sha256:` over the exact input series and the parameters that shaped it. */
  readonly inputsDigest: string;
  readonly latencyMs: number;
  readonly flags: {
    readonly quantileMonotonic: boolean;
    readonly scaleSuspicious: boolean;
  };
}

/**
 * A hash of the data, not of the request.
 *
 * Values are fixed-precision before hashing: `JSON.stringify` on floats varies
 * with the shortest round-trip representation, so the same window could hash
 * differently across Node versions and a digest that unstable verifies nothing.
 * `NaN`/`Infinity` are named rather than stringified, since `String(NaN)` is a
 * valid-looking number.
 */
export function digestSeries(
  values: readonly number[],
  params: Readonly<Record<string, string | number>>,
): string {
  const canonical = values
    .map((v) => (Number.isFinite(v) ? v.toFixed(8) : Number.isNaN(v) ? 'NaN' : 'Inf'))
    .join(',');
  const paramPart = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const hash = createHash('sha256').update(`${paramPart}|${canonical}`).digest('hex');
  return `sha256:${hash}`;
}

export interface ProvenanceInput {
  readonly poolId: string;
  readonly target: string;
  readonly windowDays: number;
  readonly window: {
    readonly timestamps: readonly Date[];
    readonly values: readonly number[];
  };
  readonly forecast: Pick<TimesFMForecast, 'model' | 'horizon' | 'latencyMs' | 'flags'>;
}

export function buildForecastProvenance(input: ProvenanceInput): ForecastProvenance {
  const { values, timestamps } = input.window;
  const first = timestamps[0];
  const last = timestamps[timestamps.length - 1];

  return {
    poolId: input.poolId,
    target: input.target,
    model: input.forecast.model,
    horizon: input.forecast.horizon,
    windowDays: input.windowDays,
    inputPoints: values.length,
    inputFrom: first instanceof Date ? first.toISOString() : null,
    inputTo: last instanceof Date ? last.toISOString() : null,
    inputsDigest: digestSeries(values, {
      poolId: input.poolId,
      target: input.target,
      windowDays: input.windowDays,
      horizon: input.forecast.horizon,
      model: input.forecast.model,
    }),
    latencyMs: input.forecast.latencyMs,
    flags: {
      quantileMonotonic: input.forecast.flags.quantileMonotonic,
      scaleSuspicious: input.forecast.flags.scaleSuspicious,
    },
  };
}

/**
 * One line for the trace, so the span is legible without expanding the JSON.
 *
 * `scaleSuspicious` is called out because it is the flag that means "the model
 * returned something, but its magnitude is not trustworthy" — exactly the case
 * that reads as success if it is left inside a nested object.
 */
export function describeProvenance(p: ForecastProvenance): string {
  const warnings = [
    p.flags.scaleSuspicious ? 'scaleSuspicious' : null,
    !p.flags.quantileMonotonic ? 'quantiles non-monotonic' : null,
    p.inputPoints < 8 ? `only ${p.inputPoints} input points` : null,
  ].filter((w): w is string => w !== null);

  return (
    `${p.model} ${p.target} h=${p.horizon} on ${p.poolId} ` +
    `from ${p.inputPoints} pts (${p.inputFrom?.slice(0, 10) ?? '—'}→${p.inputTo?.slice(0, 10) ?? '—'}) ` +
    `${p.inputsDigest.slice(0, 18)}… ${Math.round(p.latencyMs)}ms` +
    (warnings.length > 0 ? ` ⚠ ${warnings.join(', ')}` : '')
  );
}
