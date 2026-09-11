/**
 * The typed error hierarchy for the risk pipeline.
 *
 * A single flat `Error` forces callers to parse message strings to decide what
 * to do. Every failure mode here carries the *context needed to act on it*: the
 * source that failed, the selector that did not match, the field that failed
 * validation, or the store that was unreachable. That makes the orchestration
 * decision — "mark this source failed and continue the sweep" versus "abort the
 * run" — a property of the error type rather than of the message text.
 *
 * All library errors extend {@link RiskPipelineError}, so a caller can catch the
 * family without enumerating subclasses. No library code throws a bare `Error`.
 */

/**
 * Base class for every error this package raises.
 *
 * Carries an optional `cause` so a low-level failure (a driver error, a
 * timeout) is preserved rather than flattened into a string.
 */
export class RiskPipelineError extends Error {
  /**
   * @param message - Human-readable description, phrased so an operator knows
   *   which source or record is implicated.
   * @param cause - The underlying error, when this one wraps another.
   */
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'RiskPipelineError';
  }
}

/**
 * A source could not be fetched or parsed.
 *
 * The orchestration layer treats this as *containable*: the failing source is
 * recorded as `failed` in the manifest and the sweep continues, so one broken
 * upstream does not cost the whole refresh (plan T7.5).
 */
export class SourceError extends RiskPipelineError {
  /**
   * @param sourceId - Stable identifier from the registry (e.g. `l2beat`).
   * @param message - What went wrong, including the URL where relevant.
   * @param cause - The underlying error.
   */
  constructor(
    readonly sourceId: string,
    message: string,
    cause?: unknown,
  ) {
    super(`[${sourceId}] ${message}`, cause);
    this.name = 'SourceError';
  }
}

/**
 * A source was fetched but its expected structure was not found.
 *
 * Distinct from {@link SourceError} because the cause is different and so is the
 * remedy: the site responded, but the selector or shape we depend on has
 * changed. Carrying the selector makes the fix obvious.
 */
export class ParseError extends RiskPipelineError {
  /**
   * @param sourceId - Stable identifier from the registry.
   * @param selector - The selector, JSON path or field that did not resolve.
   * @param message - What was expected versus what was found.
   */
  constructor(
    readonly sourceId: string,
    readonly selector: string,
    message: string,
  ) {
    super(`[${sourceId}] parse failure at "${selector}": ${message}`);
    this.name = 'ParseError';
  }
}

/**
 * A record failed schema validation at the boundary.
 *
 * The `fieldPath` is the dotted path zod reports, so the failure names the exact
 * offending field rather than the whole record.
 */
export class ValidationError extends RiskPipelineError {
  /**
   * @param fieldPath - Dotted path to the failing field, from zod's issue path.
   * @param message - The validation message.
   * @param value - The rejected value, for diagnostics.
   */
  constructor(
    readonly fieldPath: string,
    message: string,
    readonly value: unknown,
  ) {
    super(`validation failed at "${fieldPath}": ${message}`);
    this.name = 'ValidationError';
  }
}

/**
 * The snapshot store (GCS or the local directory) could not be read or written.
 */
export class StoreError extends RiskPipelineError {
  /**
   * @param operation - `read`, `write` or `list`.
   * @param key - The object key or path involved.
   * @param message - What went wrong.
   * @param cause - The underlying error.
   */
  constructor(
    readonly operation: 'read' | 'write' | 'list',
    readonly key: string,
    message: string,
    cause?: unknown,
  ) {
    super(`store ${operation} failed for "${key}": ${message}`, cause);
    this.name = 'StoreError';
  }
}

/**
 * Writing temporal history to TimescaleDB failed.
 *
 * Separated from {@link StoreError} because the snapshot and the history have
 * different failure semantics: losing a snapshot degrades an API response, while
 * losing history corrupts the covariate series that forecasts depend on.
 */
export class TemporalWriteError extends RiskPipelineError {
  /**
   * @param table - The target hypertable.
   * @param message - What went wrong.
   * @param cause - The underlying error.
   */
  constructor(
    readonly table: string,
    message: string,
    cause?: unknown,
  ) {
    super(`temporal write to "${table}" failed: ${message}`, cause);
    this.name = 'TemporalWriteError';
  }
}

/**
 * A covariate row does not align with the target series.
 *
 * This exists because the failure it prevents is expensive and opaque. The
 * deployed TimesFM-3 service answers a misaligned `past_covariates` row with
 * HTTP 500 — not a 4xx — so a shape mistake is indistinguishable from the model
 * being down (verified live: a 48-step series with a 47-value covariate returns
 * 500, with 48 it returns 200). Failing here instead names the covariate, the
 * expected length and the actual length, so the bug is a message rather than an
 * outage investigation.
 */
export class CovariateAlignmentError extends RiskPipelineError {
  /**
   * @param covariate - The covariate whose row is misaligned.
   * @param expected - The target series length it must equal.
   * @param actual - The row length actually produced.
   */
  constructor(
    readonly covariate: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `covariate "${covariate}" has ${actual} values but the target series has ${expected}; ` +
        'TimesFM-3 requires exact alignment (the service returns HTTP 500 otherwise)',
    );
    this.name = 'CovariateAlignmentError';
  }
}

/**
 * A snapshot on disk or in GCS did not match the published contract.
 *
 * Raised by the repository on read, so a drifted or hand-edited snapshot fails
 * loudly at the boundary instead of propagating an unvalidated shape into the
 * agent.
 */
export class SnapshotContractError extends RiskPipelineError {
  /**
   * @param key - The snapshot key that failed.
   * @param message - Which part of the contract was violated.
   */
  constructor(
    readonly key: string,
    message: string,
  ) {
    super(`snapshot "${key}" violates the contract: ${message}`);
    this.name = 'SnapshotContractError';
  }
}
