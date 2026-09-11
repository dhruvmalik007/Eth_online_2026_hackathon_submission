/**
 * Covariate construction for the TimesFM-3 request.
 *
 * ## What a covariate buys
 *
 * A univariate forecast of APY can only extrapolate what APY already did. Adding
 * the risk series as `past_covariates` lets the model condition the yield
 * forecast on *why* the yield moved — a governance proposal to raise the
 * liquidation threshold, a chain's exit window narrowing, market-maker depth
 * thinning, an exploit. The history tables written by `temporal.ts` exist to
 * supply exactly these series.
 *
 * ## The contract this module exists to hold
 *
 * `past_covariates` is a matrix of shape `[numCovariates][contextLength]`, and
 * each row must have **exactly** the target series length. The deployed service
 * answers a mismatch with HTTP 500 rather than a 4xx (verified live: a 48-step
 * series with a 47-value covariate returns 500, with 48 returns 200), so an
 * off-by-one is indistinguishable from the model being down. Every matrix this
 * module returns has been checked against that contract before it escapes, and
 * the check is not optional — {@link assertCovariatesAligned} is called inside
 * {@link buildPastCovariates}, so an unaligned matrix cannot be constructed.
 *
 * ## Why forward-fill, and not interpolation
 *
 * Risk series are step functions. A chain's exit window does not drift smoothly
 * between two observations; it changes when it changes. Interpolating between a
 * "none" and a "7 days" reading would emit values that were never observed and
 * cannot be justified to anyone reading the result. The most recent observation
 * at or before each step is the only defensible value, so that is what is used.
 *
 * Leading steps — before the first observation — are filled by
 * {@link DEFAULT_LEADING_FILL}, and *how many* were filled is reported rather
 * than hidden, because a covariate that is mostly filled is mostly invention and
 * a consumer deserves to know that.
 *
 * ## Why an empty covariate is omitted rather than zero-filled
 *
 * "No data" and "zero risk" are different claims. Emitting zeros for a series we
 * never observed would tell the model a chain has no incidents and no risk, which
 * is an assertion nothing supports. An empty series is therefore dropped, named
 * in {@link CovariateMatrix.omitted}, and the request proceeds with fewer
 * covariates — which the service accepts.
 */

import type { RiskHistoryRepository } from '@ethonline2026/timeseries';
import type { IncidentSeverity } from '@ethonline2026/timeseries';
import { CovariateAlignmentError } from './errors.js';

/**
 * A covariate series sampled at arbitrary times.
 *
 * `points` need not be evenly spaced and need not fall on the grid: alignment is
 * this module's job, so a caller passes whatever the source recorded.
 */
export interface CovariateSource {
  /** Stable covariate name, used in diagnostics and the length-contract error. */
  readonly name: string;
  /** Observations in ascending time order. */
  readonly points: readonly CovariatePoint[];
}

/** One observation of a covariate series. */
export interface CovariatePoint {
  /** When the value was observed. */
  readonly ts: Date;
  /** The observed value. */
  readonly value: number;
}

/**
 * How grid steps preceding the first observation are filled.
 *
 * `'backfill'` carries the earliest known value backwards. A number uses that
 * constant instead, which is the honest choice when "before we started measuring"
 * genuinely means a known default.
 */
export type LeadingFill = 'backfill' | number;

/**
 * The default leading fill.
 *
 * Backfill is preferred to a constant: the earliest observation is at least a
 * measurement of the same system, whereas `0` asserts "no risk" — a claim with
 * nothing behind it. The count of backfilled steps is reported in
 * {@link CovariateCoverage} so the assumption is visible.
 */
export const DEFAULT_LEADING_FILL: LeadingFill = 'backfill';

/**
 * Severity weights for the cumulative incident covariate.
 *
 * A documented rubric, in the same spirit as the scoring rubrics in
 * `scoring.py`: each level is treated as roughly twice the impact of the one
 * below, so an exploit (critical) outweighs a paused withdrawal (low) without
 * the covariate becoming a boolean. The absolute scale is arbitrary but fixed, so
 * the series is comparable across sweeps.
 */
const SEVERITY_WEIGHT: Readonly<Record<IncidentSeverity, number>> = {
  low: 1,
  medium: 2,
  high: 4,
  critical: 8,
};

/** Per-covariate alignment diagnostics, so filled values are never invisible. */
export interface CovariateCoverage {
  /** The covariate's name. */
  readonly name: string;
  /** Grid steps backed by a real observation at or before that step. */
  readonly observed: number;
  /** Grid steps that had to be filled. */
  readonly filled: number;
  /** `observed / contextLength`, in `0..1`. */
  readonly ratio: number;
}

/**
 * An aligned covariate matrix, ready for the TimesFM-3 request.
 *
 * `rows[i]` belongs to `names[i]`, and every row has length `contextLength`.
 */
export interface CovariateMatrix {
  /** Covariate names, positionally matching {@link rows}. */
  readonly names: readonly string[];
  /** `[numCovariates][contextLength]` — the layout the service expects. */
  readonly rows: readonly (readonly number[])[];
  /** The target series length every row equals. */
  readonly contextLength: number;
  /** Per-covariate alignment diagnostics. */
  readonly coverage: readonly CovariateCoverage[];
  /** Requested covariates dropped for having no observations at all. */
  readonly omitted: readonly string[];
}

/**
 * An empty matrix for a given context length.
 *
 * Represents "no covariates available", which is a valid request — the service
 * treats `past_covariates: null` as a univariate forecast. Having a value rather
 * than `null` keeps callers from branching.
 *
 * @param contextLength - The target series length.
 * @returns A matrix with no covariates.
 * @example
 * ```ts
 * const none = emptyCovariateMatrix(48);
 * none.rows.length; // 0
 * ```
 */
export function emptyCovariateMatrix(contextLength: number): CovariateMatrix {
  return { names: [], rows: [], contextLength, coverage: [], omitted: [] };
}

/**
 * Assert that every covariate row aligns with the target series.
 *
 * This is the fail-fast guard for the verified HTTP-500 contract. It is called
 * by {@link buildPastCovariates} before returning, and is exported so a caller
 * assembling a matrix by hand can apply the same check.
 *
 * @param contextLength - The target series length.
 * @param names - Covariate names, positionally matching `rows`.
 * @param rows - The covariate rows to check.
 * @throws {CovariateAlignmentError} When a row's length differs from
 *   `contextLength`, naming the covariate and both lengths.
 * @example
 * ```ts
 * assertCovariatesAligned(48, ['chain_risk'], [[...Array(48).keys()]]); // ok
 * ```
 */
export function assertCovariatesAligned(
  contextLength: number,
  names: readonly string[],
  rows: readonly (readonly number[])[],
): void {
  rows.forEach((row, i) => {
    if (row.length !== contextLength) {
      throw new CovariateAlignmentError(names[i] ?? `covariate[${i}]`, contextLength, row.length);
    }
  });
}

/**
 * Align one series onto the target grid by carrying the last observation forward.
 *
 * Values are never interpolated. A grid step takes the most recent observation at
 * or before it; steps before the first observation take the leading fill.
 *
 * @param points - The series observations, ascending by time.
 * @param grid - The target timestamps, ascending. Typically the target series'
 *   own timestamps, which is what makes index-for-index alignment meaningful.
 * @param leadingFill - How to fill steps before the first observation.
 * @returns The aligned values (length `grid.length`) and how many were observed
 *   versus filled. The counts are returned unnamed so the caller, which knows
 *   what the series is called, can label them.
 * @example
 * ```ts
 * const { values, observed, filled } = alignToGrid(points, grid, 'backfill');
 * ```
 */
export function alignToGrid(
  points: readonly CovariatePoint[],
  grid: readonly Date[],
  leadingFill: LeadingFill = DEFAULT_LEADING_FILL,
): { readonly values: readonly number[]; readonly observed: number; readonly filled: number } {
  // A copy sorted ascending: the contract asks for ordered points, but a source
  // assembled from two queries could arrive out of order, and a binary search
  // over unsorted data silently returns wrong neighbours rather than failing.
  const ordered = [...points].sort((a, b) => a.ts.getTime() - b.ts.getTime());

  const values: number[] = [];
  let observed = 0;
  let cursor = 0; // index of the last observation at or before the current step

  for (const step of grid) {
    const stepMs = step.getTime();

    while (cursor < ordered.length && ordered[cursor]!.ts.getTime() <= stepMs) {
      cursor += 1;
    }

    if (cursor > 0) {
      // At least one observation exists at or before this step.
      values.push(ordered[cursor - 1]!.value);
      observed += 1;
    } else if (leadingFill === 'backfill') {
      values.push(ordered[0]!.value);
    } else {
      values.push(leadingFill);
    }
  }

  return { values, observed, filled: grid.length - observed };
}

/**
 * Build the aligned covariate matrix for a target series.
 *
 * Series with no observations are dropped and named in `omitted`; the rest are
 * aligned and then checked against the length contract, so the returned matrix is
 * always safe to send.
 *
 * @param input - The target grid and the covariate series to align to it.
 * @param input.grid - The target series' timestamps, ascending. Its length is
 *   the context length every row must equal.
 * @param input.sources - Covariate series, in the order they should appear.
 * @param input.leadingFill - How to fill steps before each series' first
 *   observation. Defaults to {@link DEFAULT_LEADING_FILL}.
 * @returns The aligned matrix, with per-covariate coverage and the dropped names.
 * @throws {CovariateAlignmentError} If alignment could not produce equal-length
 *   rows — a bug in this module rather than in the input, which is why it is
 *   raised rather than tolerated.
 * @example
 * ```ts
 * const matrix = buildPastCovariates({
 *   grid: apyTimestamps,
 *   sources: [{ name: 'chain_risk', points: riskPoints }],
 * });
 * ```
 */
export function buildPastCovariates(input: {
  readonly grid: readonly Date[];
  readonly sources: readonly CovariateSource[];
  readonly leadingFill?: LeadingFill;
}): CovariateMatrix {
  const contextLength = input.grid.length;
  const leadingFill = input.leadingFill ?? DEFAULT_LEADING_FILL;

  const names: string[] = [];
  const rows: number[][] = [];
  const coverage: CovariateCoverage[] = [];
  const omitted: string[] = [];

  for (const source of input.sources) {
    if (source.points.length === 0) {
      omitted.push(source.name);
      continue;
    }

    const aligned = alignToGrid(source.points, input.grid, leadingFill);
    names.push(source.name);
    rows.push([...aligned.values]);
    coverage.push({
      name: source.name,
      observed: aligned.observed,
      filled: aligned.filled,
      ratio: contextLength === 0 ? 0 : aligned.observed / contextLength,
    });
  }

  assertCovariatesAligned(contextLength, names, rows);

  return { names, rows, contextLength, coverage, omitted };
}

/**
 * Build a cumulative severity-weighted incident series.
 *
 * The value at each step is the summed weight of every incident that had occurred
 * by that step, so the series is monotone non-decreasing and reads as
 * accumulated damage rather than a per-step count that is zero almost everywhere.
 *
 * @param incidents - Incidents within the window, ascending by time.
 * @returns Points suitable for a {@link CovariateSource}.
 */
export function cumulativeIncidentSeries(
  incidents: readonly { readonly occurredAt: Date; readonly severity: IncidentSeverity }[],
): readonly CovariatePoint[] {
  const ordered = [...incidents].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

  let running = 0;
  return ordered.map((incident) => {
    running += SEVERITY_WEIGHT[incident.severity];
    return { ts: incident.occurredAt, value: running };
  });
}

/**
 * Read the available risk covariates for a target series.
 *
 * Assembles whichever series the caller has identifiers for, each from its own
 * history table. Missing identifiers simply mean that covariate is not requested;
 * a series with no rows is omitted with a name so the caller can tell "not asked
 * for" from "asked for and empty".
 *
 * @param repository - The history repository from `@ethonline2026/timeseries`.
 * @param input - The target grid and the subject identifiers to read.
 * @param input.grid - The target series' timestamps, ascending.
 * @param input.chainSlug - Read the chain composite risk series.
 * @param input.protocolSlug - Read the governance activity series.
 * @param input.marketMaker - Read the market-maker depth series.
 * @param input.incidentSubject - Read the security-incident impact series.
 * @param input.leadingFill - How to fill steps before a series' first observation.
 * @returns The aligned matrix for whichever covariates were available.
 * @example
 * ```ts
 * const matrix = await loadRiskCovariates(repo, {
 *   grid: apyTimestamps,
 *   chainSlug: 'base',
 *   protocolSlug: 'aave',
 * });
 * ```
 */
export async function loadRiskCovariates(
  repository: RiskHistoryRepository,
  input: {
    readonly grid: readonly Date[];
    readonly chainSlug?: string | undefined;
    readonly protocolSlug?: string | undefined;
    readonly marketMaker?: string | undefined;
    readonly incidentSubject?: string | undefined;
    readonly leadingFill?: LeadingFill;
  },
): Promise<CovariateMatrix> {
  const first = input.grid[0];
  const last = input.grid[input.grid.length - 1];

  // No grid means no target series to align to, so there is nothing to read.
  if (first === undefined || last === undefined) {
    return emptyCovariateMatrix(0);
  }

  const range = { from: first, to: last };
  const sources: CovariateSource[] = [];

  if (input.chainSlug !== undefined) {
    sources.push({
      name: 'chain_risk',
      points: await repository.chainCompositeSeries(input.chainSlug, range),
    });
  }
  if (input.protocolSlug !== undefined) {
    sources.push({
      name: 'governance_activity',
      points: await repository.governanceCompositeSeries(input.protocolSlug, range),
    });
  }
  if (input.marketMaker !== undefined) {
    sources.push({
      name: 'market_maker_depth',
      points: await repository.marketMakerDepthSeries(input.marketMaker, range),
    });
  }
  if (input.incidentSubject !== undefined) {
    const incidents = await repository.incidentSeries(input.incidentSubject, range);
    sources.push({ name: 'incident_impact', points: cumulativeIncidentSeries(incidents) });
  }

  return buildPastCovariates({
    grid: input.grid,
    sources,
    ...(input.leadingFill === undefined ? {} : { leadingFill: input.leadingFill }),
  });
}
