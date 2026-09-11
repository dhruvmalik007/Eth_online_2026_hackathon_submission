/**
 * Covariate construction for the TimesFM-3 request.
 *
 * The deployed service requires a past covariate to have the **same length as
 * the target series** — sending one value per *change* (length N−1) returns
 * HTTP 500 "Internal Server Error" rather than a 4xx, so a shape mistake
 * surfaces as an opaque model outage. That was a real production bug; this
 * module exists so the alignment is computed in one tested place.
 *
 * Verified live against the deployed service (2026-09-11): 48-length series
 * with a 47-length past covariate → 500; with 48 → 200.
 */

/**
 * Per-step absolute change of a series, aligned to the series itself.
 *
 * Index 0 has no predecessor, so it is reported as 0 — "no observation yet"
 * rather than an invented change.
 */
export function perStepChangeCovariate(series: readonly number[]): number[] {
  return series.map((value, i) => {
    if (i === 0) return 0;
    return Math.abs(value - series[i - 1]!);
  });
}

/**
 * True when every past-covariate row is aligned with the series. Used by the
 * request schema so a mismatched covariate fails locally with a clear message
 * instead of reaching the model as a 500.
 */
export function pastCovariatesAligned(
  series: readonly number[],
  pastCovariates: readonly (readonly number[])[],
): boolean {
  return pastCovariates.every((row) => row.length === series.length);
}
