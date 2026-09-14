/**
 * The one number the dashboard puts in its header, derived from the portfolio view.
 *
 * It is a pair, not a number: what could be priced, and how many holdings could not. A single total
 * would have to either drop the unpriceable holdings silently or claim to include them, and both
 * are lies the user would act on.
 */
import type { PortfolioView } from "./server";

export interface NavSummary {
  /** Sum of everything that could be priced. */
  readonly pricedUsd: number;
  /** Holdings with no price. Non-zero means the total is a floor. */
  readonly unpriced: number;
  /** True until at least one chain has been read. */
  readonly empty: boolean;
}

export function navFrom(portfolio: PortfolioView | null): NavSummary {
  if (portfolio === null) return { pricedUsd: 0, unpriced: 0, empty: true };
  return {
    pricedUsd: portfolio.pricedUsd,
    unpriced: portfolio.unpriced,
    empty: portfolio.chains.every((chain) => chain.native === null && chain.tokens.length === 0),
  };
}

/** An allocation slice, where `null` means "no total has been read yet" and never "zero". */
export function formatAllocUsd(value: number | null): string {
  return value === null ? "—" : `$${value.toLocaleString("en-US")}`;
}

/** Compact USD for a chip: `$12.4K`, `$1.2M`, `$812.42`. */
export function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return `$${value.toFixed(2)}`;
}
