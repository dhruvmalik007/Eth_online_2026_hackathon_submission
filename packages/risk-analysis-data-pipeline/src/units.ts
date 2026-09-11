/**
 * Branded units — the type-level defence against unit-mixing bugs.
 *
 * This codebase has already been bitten once by a percent-vs-decimal mistake
 * (recorded in `packages/langchain/src/tools/fixedIncomeMath.ts`): a value of
 * `4` meaning 4% was consumed where `0.04` was expected, and the error was
 * invisible to the compiler because both are `number`. A wrong number that
 * type-checks is the most expensive kind.
 *
 * The fix is to make the unit part of the type. `Usd`, `Pct`, `DecimalRate`,
 * `Days` and `Bps` are all `number` at runtime — zero cost — but mutually
 * unassignable at compile time, so passing a rate where an amount is expected
 * fails the build instead of quietly mispricing a position.
 *
 * ## The units contract
 *
 * One system internally, conversion only at a single boundary:
 *
 * | Unit          | Meaning                     | Example        |
 * |---------------|-----------------------------|----------------|
 * | `Usd`         | US dollars                  | `1_250_000`    |
 * | `Pct`         | percent points, 0–100 scale | `4` = 4%       |
 * | `DecimalRate` | decimal fraction            | `0.04` = 4%    |
 * | `Bps`         | basis points                | `400` = 4%     |
 * | `Days`        | whole/partial days          | `30`           |
 *
 * **Internal computation uses `DecimalRate` and `Usd`.** `Pct` and `Bps` exist
 * only at the edges — the snapshot serializer (where a human-readable percentage
 * is published) and the agent tool boundary (where a model or operator supplies
 * a percentage). `pctToRate`, `rateToPct` and `bpsToRate` are the only sanctioned
 * conversions, and they are the only places a `Pct`/`Bps` becomes a `DecimalRate`.
 *
 * Branding is erased at runtime, so these helpers are the single place where the
 * illusion is created; nothing else in the package may cast a bare `number` into
 * a branded type.
 *
 * ## Why the guards throw `RangeError` and not `RiskPipelineError`
 *
 * This is a deliberate exception to the standard in §10.5, and the reason is
 * about what a caller should do with the failure. Every `RiskPipelineError`
 * subclass is *containable*: the sweep records the source as failed and carries
 * on, because a blocked upstream is an expected condition. An out-of-range unit
 * is not that — it means this package was called incorrectly, so it must crash
 * loudly rather than be caught and degraded into a recorded partial outcome.
 * Keeping it outside the family makes it unswallowable by the error handling
 * that exists for upstream failures.
 */

/** The invisible marker that makes each unit nominally distinct. */
interface UnitBrand<Tag extends string> {
  readonly __unit: Tag;
}

/** A US-dollar amount. */
export type Usd = number & UnitBrand<'Usd'>;

/** A percentage on the 0–100 scale (`4` means 4%). */
export type Pct = number & UnitBrand<'Pct'>;

/** A decimal fraction (`0.04` means 4%) — the internal computation unit. */
export type DecimalRate = number & UnitBrand<'DecimalRate'>;

/** A basis point count (`400` means 4%). */
export type Bps = number & UnitBrand<'Bps'>;

/** A duration in days. */
export type Days = number & UnitBrand<'Days'>;

/**
 * The single sanctioned raw-number escape for units.
 *
 * Branding is a compile-time illusion with no runtime representation, so
 * *something* has to perform the initial cast when a plain `number` arrives from
 * a schema parse. Keeping it in one non-exported function means the rest of the
 * package can be audited by grepping for `as` — there should be no other
 * occurrence touching a unit type.
 *
 * @param value - A plain number already validated by its caller.
 * @returns The same number, branded.
 */
function brand<T extends number>(value: number): T {
  return value as T;
}

/**
 * Brand a validated dollar amount.
 *
 * @param value - A non-negative finite number of US dollars.
 * @returns The branded amount.
 * @throws {RangeError} When `value` is negative, `NaN` or infinite — a negative
 * price is a parser bug, and failing here names the culprit.
 * @example
 * ```ts
 * const tvl = usd(12_000_000_000);
 * ```
 */
export function usd(value: number): Usd {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Usd must be a finite non-negative number, received ${String(value)}`);
  }
  return brand<Usd>(value);
}

/**
 * Brand a percentage on the 0–100 scale.
 *
 * @param value - A number of percent points.
 * @returns The branded percentage.
 * @throws {RangeError} When `value` is not finite, or falls outside 0–100.
 * @example
 * ```ts
 * const spread = pct(0.31); // 0.31%
 * ```
 */
export function pct(value: number): Pct {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`Pct must be finite and within 0–100, received ${String(value)}`);
  }
  return brand<Pct>(value);
}

/**
 * Brand a decimal fraction.
 *
 * @param value - A number where `1` means 100%.
 * @returns The branded rate.
 * @throws {RangeError} When `value` is not finite.
 * @example
 * ```ts
 * const apy = rate(0.042); // 4.2%
 * ```
 */
export function rate(value: number): DecimalRate {
  if (!Number.isFinite(value)) {
    throw new RangeError(`DecimalRate must be finite, received ${String(value)}`);
  }
  return brand<DecimalRate>(value);
}

/**
 * Brand a basis-point count.
 *
 * @param value - A number of basis points.
 * @returns The branded count.
 * @throws {RangeError} When `value` is not a finite integer.
 */
export function bps(value: number): Bps {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new RangeError(`Bps must be a finite integer, received ${String(value)}`);
  }
  return brand<Bps>(value);
}

/**
 * Brand a duration.
 *
 * @param value - A non-negative number of days.
 * @returns The branded duration.
 * @throws {RangeError} When `value` is negative or not finite.
 */
export function days(value: number): Days {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Days must be a finite non-negative number, received ${String(value)}`);
  }
  return brand<Days>(value);
}

/**
 * Convert a percentage to the internal decimal rate.
 *
 * One of only three sanctioned unit conversions in the package.
 *
 * @param value - A percentage on the 0–100 scale.
 * @returns The equivalent decimal fraction.
 * @example
 * ```ts
 * pctToRate(pct(4)); // 0.04
 * ```
 */
export function pctToRate(value: Pct): DecimalRate {
  return brand<DecimalRate>(value / 100);
}

/**
 * Convert an internal decimal rate back to a percentage for publication.
 *
 * @param value - A decimal fraction.
 * @returns The equivalent percentage on the 0–100 scale.
 * @example
 * ```ts
 * rateToPct(rate(0.04)); // 4
 * ```
 */
export function rateToPct(value: DecimalRate): Pct {
  return brand<Pct>(value * 100);
}

/**
 * Convert basis points to the internal decimal rate.
 *
 * @param value - A basis-point count.
 * @returns The equivalent decimal fraction.
 * @example
 * ```ts
 * bpsToRate(bps(400)); // 0.04
 * ```
 */
export function bpsToRate(value: Bps): DecimalRate {
  return brand<DecimalRate>(value / 10_000);
}

/**
 * Strip the brand for serialization.
 *
 * Used by the snapshot serializer, which writes plain JSON. Reading an
 * unbranded number back in requires a validated re-brand through the
 * constructors above.
 *
 * @param value - Any branded numeric unit.
 * @returns The underlying plain number.
 */
export function unbrand(value: Usd | Pct | DecimalRate | Bps | Days): number {
  return value;
}
