/**
 * computeStrategyFromSnapshot — the constrained-allocation block, extracted verbatim
 * from the shipped `V4FixedIncomeStrategyTool` so the pipeline's `computeStrategy`
 * node and the desk session's strategy logic can reuse it with zero behavior change.
 *
 * Pure (no I/O): converts a `MarketSnapshot` into a `StrategyResult` via
 * `allocateStrategy`. minApr arrives in PERCENT (trader input); the pure allocator
 * is DECIMAL — this module owns that single unit conversion so callers never do it.
 */
import { allocateStrategy, type StrategyResult } from "../tools/fixedIncomeMath.js";
import type { MarketSnapshot } from "./marketData.js";

export interface ComputeStrategyOptions {
  minAprPercent: number; // trader input, e.g. 6 (%)
  vegaBudget: number;
  sizeUsd: number;
  minVolumeUsd?: number;
}

export function computeStrategyFromSnapshot(
  snapshot: MarketSnapshot,
  opts: ComputeStrategyOptions,
): StrategyResult {
  return allocateStrategy(snapshot.legs, {
    minApr: opts.minAprPercent / 100, // percent → decimal (pure allocator is decimal)
    vegaBudget: opts.vegaBudget,
    sizeUsd: opts.sizeUsd,
    minVolumeUsd: opts.minVolumeUsd ?? snapshot.constraints.minVolumeUsd,
  });
}

export type { StrategyResult } from "../tools/fixedIncomeMath.js";
