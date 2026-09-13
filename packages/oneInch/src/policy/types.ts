/**
 * The flight vocabulary.
 *
 * ## Why the reasons are a closed set
 *
 * The same reasoning `packages/bridges` applies to `QUOTE_FAILURES`: a caller
 * must be able to *act* on a decision, and a dashboard must be able to explain
 * one. "HOLD" on its own is unactionable — holding because the market is calm and
 * holding because our off-chain threshold disagrees with the on-chain guard are
 * different facts with different remedies. So every decision carries a reason
 * from a fixed list, and the list is the documentation.
 *
 * `protocol_absent_on_chain` earns its place because it is the one reason that
 * describes a *registry* fact rather than a market fact, and it is exactly the
 * case that must not be mistaken for a market signal. A venue missing on
 * Optimism is not a reason to rebalance; it is a reason the leg is unavailable.
 */

import { z } from "zod";

/** What the policy decided to do. */
export const ACTIONS = ["HOLD", "REBALANCE", "FLIGHT_TO_STABLE"] as const;
export type Action = (typeof ACTIONS)[number];

/** Why. Closed, and each value maps to a distinct remedy. */
export const FLIGHT_REASONS = [
  /** Off-chain thresholds disagree with the on-chain guard; nothing can execute. */
  "signal_desync",
  /** Not enough liquidity to exit into at an acceptable price. */
  "insufficient_depth",
  /** Realised volatility breached the cap — the "very volatile" flight case. */
  "vol_breach",
  /** Realised yield fell under the floor — the "yield under a threshold" case. */
  "yield_below_floor",
  /** The leg has drifted from its target weight. */
  "drift",
  /** Everything is inside its band. */
  "within_band",
  /** The venue this leg needs has no deployment on the active chain. */
  "protocol_absent_on_chain",
] as const;
export type FlightReason = (typeof FLIGHT_REASONS)[number];

/** The steps a decision compiles into. Names match the execution-domain step kinds. */
export const FLIGHT_STEPS = [
  /** A SwapVM take: the volatile leg swaps into the stablecoin. */
  "swapvm-take",
  /** An ERC-4626 deposit: the stablecoin is deployed into a Morpho vault. */
  "vault-deposit",
] as const;
export type FlightStep = (typeof FLIGHT_STEPS)[number];

/** What the on-chain `RiskSignalSource` currently enforces for this strategy. */
export const OnchainGuardSchema = z.object({
  /** The floor the instruction will enforce. */
  floorApyBps: z.number().int().nonnegative(),
  /** The cap the instruction will enforce. */
  volCapBps: z.number().int().nonnegative(),
});
export type OnchainGuard = z.infer<typeof OnchainGuardSchema>;

/**
 * The policy's input.
 *
 * Validated because it crosses a boundary: in the service, these numbers arrive
 * from a signal reader and a request body, and a silently-`NaN` yield would
 * otherwise flow into a signed order. `z.number().finite()` is doing real work.
 */
export const FlightInputSchema = z.object({
  chain: z.enum(["ethereum", "arbitrum", "optimism", "polygon"]),
  /** The stablecoin the flight lands in. */
  targetStable: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** Realised yield of the current position, in basis points. */
  yieldApyBps: z.number().finite(),
  /** Annualised realised volatility, in basis points. */
  realisedVolBps: z.number().finite().nonnegative(),
  /** How much value can actually be exited into, in USD. */
  liquidityDepthUsd: z.number().finite().nonnegative(),
  currentWeightBps: z.number().finite().nonnegative(),
  targetWeightBps: z.number().finite().nonnegative(),
  /** The guard currently deployed on-chain, so a desync is detectable. */
  onchain: OnchainGuardSchema,
});
export type FlightInput = z.infer<typeof FlightInputSchema>;

/** A vault the policy declined, and why. Mirrors `VaultRejection` without importing it. */
export interface RejectedVault {
  readonly address: string;
  readonly reason: string;
  readonly detail: string;
}

/** The decision. */
export interface FlightDecision {
  readonly action: Action;
  readonly reason: FlightReason;
  /** A sentence fit for a log or a UI — the *why* behind the reason code. */
  readonly detail: string;
  /**
   * The steps to compile, in order.
   *
   * Empty for `HOLD`. A flight with no qualified vault yields a single step: the
   * plan is explicit that a flight with nowhere to land still executes, with the
   * stablecoin left in the wallet. Stranding funds in transit to avoid an
   * incomplete pipeline would be strictly worse than an incomplete pipeline.
   */
  readonly steps: readonly FlightStep[];
  readonly vault: {
    readonly chosen: string | null;
    readonly rejected: readonly RejectedVault[];
  };
}
