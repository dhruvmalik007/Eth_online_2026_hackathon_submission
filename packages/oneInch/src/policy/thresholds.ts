/**
 * The thresholds the flight rule runs on.
 *
 * ## The floor is derived, not fixed, and that is the point
 *
 * A hardcoded yield floor is the most tempting line in this file and the worst.
 * The question a fixed-income book actually asks is not "is this yield above
 * 2.5%?" but **"is this position paying me more than the stablecoin I could
 * switch into, after the cost of switching?"** If a Morpho vault is paying 4.6%
 * and the position is paying 4.7%, staying is right; if the vault is paying 4.6%
 * and the position pays 4.1%, flying is close to free alpha.
 *
 * So {@link deriveYieldFloorBps} takes the stablecoin's own trailing yield and a
 * buffer, and the floor moves with it. A fixed constant silently becomes wrong
 * the moment rates move — and it would be wrong in the dangerous direction,
 * keeping a book in a position that no longer beats cash.
 *
 * ## The other three
 *
 * - `volCapBps` — where a position stops behaving like fixed income. 15%
 *   annualised is roughly the point at which the mark-to-market swings dominate
 *   the coupon, which is the definition of no longer being fixed income.
 * - `driftBps` — weight drift worth paying gas to correct. Below this, the cost
 *   of the trade exceeds the risk being corrected.
 * - `minLiquidityDepthUsd` — depth needed to exit *without* moving the price. A
 *   flight that eats its own slippage is not a risk reduction.
 */

export interface FlightThresholds {
  /** Minimum exit depth, in USD. Below this, hold and report `insufficient_depth`. */
  readonly minLiquidityDepthUsd: number;
  /** Annualised volatility cap, in basis points. */
  readonly volCapBps: number;
  /** Weight drift worth correcting, in basis points. */
  readonly driftBps: number;
  /** Yield floor, in basis points. Derived from the stable yield where possible. */
  readonly yieldFloorBps: number;
}

/**
 * Defaults for a USD stablecoin flight.
 *
 * `yieldFloorBps` is the fallback for when the stablecoin's own yield has not
 * been measured yet, and it is set at a level that is conservative rather than
 * aggressive: a floor that is too low keeps the book invested, which is the
 * failure mode that costs least.
 */
export const DEFAULT_FLIGHT_THRESHOLDS: FlightThresholds = {
  minLiquidityDepthUsd: 250_000,
  volCapBps: 1_500,
  driftBps: 500,
  yieldFloorBps: 250,
};

/**
 * The switching buffer: how far the position's yield must exceed the
 * stablecoin's for staying to be worth the risk of staying.
 *
 * Not a cost estimate — it is a risk premium. At parity the position is earning
 * nothing for its duration and credit risk, so the floor sits *above* the stable
 * yield rather than at it.
 */
export const DEFAULT_FLIGHT_BUFFER_BPS = 75;

/**
 * Derive the yield floor from the stablecoin's own yield.
 *
 * @param stableApyBps - the trailing-mean yield of the destination vault, in bps.
 *   Trailing mean, not spot: a spot reading moves with utilisation and reward
 *   accrual, and a floor that moves on noise produces a policy that churns.
 * @param bufferBps - the risk premium above the stable yield. Defaults to
 *   {@link DEFAULT_FLIGHT_BUFFER_BPS}.
 *
 * Pure and total. When `stableApyBps` is `undefined` the fallback is returned,
 * because "we have not measured the alternative yet" must not read as "the
 * alternative pays nothing" — that would make every position look worth holding.
 */
export function deriveYieldFloorBps(
  stableApyBps: number | undefined,
  bufferBps: number = DEFAULT_FLIGHT_BUFFER_BPS,
): number {
  if (stableApyBps === undefined) return DEFAULT_FLIGHT_THRESHOLDS.yieldFloorBps;
  return Math.max(0, Math.round(stableApyBps) + bufferBps);
}

/**
 * Build the thresholds for a decision, given what the destination is currently
 * paying.
 *
 * Overrides win, so a strategy can pin a floor deliberately. Left as an explicit
 * object rather than a spread-merge so a caller reading this can see exactly
 * which fields the derivation touches.
 */
export function thresholdsFor(
  params: {
    readonly stableApyBps?: number;
    readonly overrides?: Partial<FlightThresholds>;
  } = {},
): FlightThresholds {
  const derived = deriveYieldFloorBps(params.stableApyBps);
  return {
    minLiquidityDepthUsd:
      params.overrides?.minLiquidityDepthUsd ?? DEFAULT_FLIGHT_THRESHOLDS.minLiquidityDepthUsd,
    volCapBps: params.overrides?.volCapBps ?? DEFAULT_FLIGHT_THRESHOLDS.volCapBps,
    driftBps: params.overrides?.driftBps ?? DEFAULT_FLIGHT_THRESHOLDS.driftBps,
    yieldFloorBps: params.overrides?.yieldFloorBps ?? derived,
  };
}
