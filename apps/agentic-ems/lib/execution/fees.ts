import type { FeeLine } from "./types";

/**
 * Fee arithmetic, with the one rule that matters:
 *
 *   A bound is not a cost. Slippage tolerance and minReturn are maxima the user
 *   accepts, and price impact is the market's reaction to their size. Only
 *   `tier: "cost"` reaches the headline.
 *
 * And the second rule: a LI.FI cost with `included: true` is already netted out
 * of the quoted output, so counting it again would double-charge the user in the
 * display even though the chain would not.
 */

export function isChargeable(fee: FeeLine): boolean {
  return fee.tier === "cost" && !fee.included;
}

/** The headline figure: only real, non-netted costs. */
export function sumCosts(fees: FeeLine[]): number {
  return fees.filter(isChargeable).reduce((sum, fee) => sum + fee.amountUsd, 0);
}

/** Displayed for transparency, never added to the headline. */
export function sumIncluded(fees: FeeLine[]): number {
  return fees
    .filter((fee) => fee.tier === "cost" && fee.included)
    .reduce((sum, fee) => sum + fee.amountUsd, 0);
}

/** Worst case accepted, not an amount charged. */
export function sumBounds(fees: FeeLine[]): number {
  return fees.filter((fee) => fee.tier === "bound").reduce((sum, fee) => sum + fee.amountUsd, 0);
}

/** Totals for a whole plan. `costUsd` never contains bound or market money. */
export function planTotals(
  feesByLeg: FeeLine[][],
  notionalUsd: number,
): { notionalUsd: number; costUsd: number; boundUsd: number } {
  const flat = feesByLeg.flat();
  return {
    notionalUsd,
    costUsd: round2(sumCosts(flat)),
    boundUsd: round2(sumBounds(flat)),
  };
}

/** Basis points of a notional, for a fee line's rate. */
export function toBps(amountUsd: number, notionalUsd: number): number {
  if (notionalUsd <= 0) return 0;
  return round2((amountUsd / notionalUsd) * 10_000);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Checks that the per-line figures add up to the headline. Used by the
 * verification script — a decomposition the user is asked to trust must be
 * internally consistent.
 */
export function reconciles(fees: FeeLine[], tolerance = 0.01): boolean {
  const lineSum = fees.filter(isChargeable).reduce((sum, fee) => sum + fee.amountUsd, 0);
  return Math.abs(lineSum - sumCosts(fees)) <= tolerance;
}
