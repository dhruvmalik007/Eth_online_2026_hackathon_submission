/**
 * Deterministic risk derivation — risk records to Black-Scholes/Merton inputs.
 *
 * This module is the reason the pipeline exists. Today `MertonPDTool` hardcodes
 * `riskFreeRate = 0.05` and derives "asset volatility" from the dispersion of
 * collateral ratios, which is a cross-sectional spread rather than a volatility.
 * Every parameter that should come from market and chain conditions is currently
 * invented.
 *
 * Everything here is a pure function of its inputs. No model, no clock, no I/O —
 * so the same snapshot always yields the same adjustment and every factor is
 * reproducible from the published scores.
 *
 * ## Units contract
 *
 * One system internally, converted at a single boundary (see `units.ts`):
 * volatility and the risk-free rate are `DecimalRate` (`0.04` = 4%), amounts are
 * `Usd`. The `RiskAdjustment` reports each factor individually so an agent can
 * cite *why* sigma was scaled rather than asserting a bare number.
 *
 * ## The scoring rubric
 *
 * The weights and category mappings here mirror
 * `scraper/risk_pipeline/scoring.py` exactly. They are duplicated rather than
 * shared because the two sides serve different purposes — Python scores at
 * collection time and bakes the result into the snapshot; TypeScript derives
 * model parameters at consumption time — but a drift test asserts they agree.
 */

import { rate, usd, type DecimalRate, type Usd } from './units.js';
import type { ChainRiskScores, MarketMakerProfile, ProtocolGovernanceProfile } from './types.js';

/**
 * Relative weight of each chain dimension in the composite score.
 *
 * State validation dominates because it is the property that makes a rollup a
 * rollup: if state transitions are not soundly validated, no other dimension
 * rescues the chain. Data availability is next, since unavailable data means a
 * user cannot reconstruct their own position even with valid state. Exit,
 * sequencer and proposer failure follow, weighted lower because they describe
 * degraded-but-survivable modes rather than existential ones.
 *
 * The weights sum to exactly 1.0, which makes the composite a convex
 * combination — it can never fall outside the range of its inputs, a property
 * worth having since a composite safer than its safest dimension would be
 * indefensible.
 */
export const COMPOSITE_WEIGHTS = {
  stateValidation: 0.3,
  dataAvailability: 0.25,
  exit: 0.2,
  sequencer: 0.15,
  proposer: 0.1,
} as const;

/** Chain-risk inputs to the derivation. */
export interface RiskDerivationInput {
  readonly chainScores: ChainRiskScores;
  /** Governance profile for the protocol, when one was collected. */
  readonly governance?: ProtocolGovernanceProfile | undefined;
  /** Market makers relevant to the venue, when available. */
  readonly marketMakers?: readonly MarketMakerProfile[] | undefined;
  /**
   * Realized volatility of the target series as a `DecimalRate`, measured from
   * pool history. `null` when there is not enough history to measure it, which
   * the derivation reports rather than papering over.
   */
  readonly realizedVolatility: DecimalRate | null;
  /** The configured base risk-free rate, before any chain premium. */
  readonly baseRiskFreeRate: DecimalRate;
}

/**
 * The derived adjustment, with every factor reported individually.
 *
 * Nothing here is a fused "risk score": each field is a named multiplier or
 * parameter an operator can audit, and the `factors` list explains each in
 * words. That is what lets the agent cite a reason instead of a number.
 */
export interface RiskAdjustment {
  /** The volatility to use, after the chain-regime multiplier. */
  readonly volatility: DecimalRate;
  /** The discount rate to use, after the chain risk premium. */
  readonly riskFreeRate: DecimalRate;
  /** Multiplier applied to recoverable collateral, in (0, 1]. */
  readonly collateralHaircut: number;
  /** Multiplier applied to a structural probability of default, >= 1. */
  readonly pdLoad: number;
  /** A 0–1 liquidity quality score derived from market-maker depth. */
  readonly liquidityScore: number;
  /** Human-readable explanations, one per applied factor. */
  readonly factors: readonly RiskFactor[];
  /** Whether volatility came from measurement or a documented fallback. */
  readonly volatilitySource: 'realized' | 'fallback';
}

/** One applied factor, named and explained. */
export interface RiskFactor {
  readonly name: string;
  readonly value: number;
  readonly explanation: string;
}

/**
 * Fallback volatility when no realized measurement exists.
 *
 * Used only when the pool lacks the history to measure volatility, and always
 * reported as `volatilitySource: 'fallback'` so a consumer can see the value is
 * an assumption rather than a measurement.
 */
export const FALLBACK_VOLATILITY: DecimalRate = rate(0.5);

/** Scales how strongly a weak chain regime raises volatility. */
const REGIME_SENSITIVITY = 0.8;

/** Scales how strongly a weak chain regime raises the discount rate. */
const PREMIUM_SENSITIVITY = rate(0.06);

/** The maximum collateral haircut a fully-unsafe chain can impose. */
const MAX_HAIRCUT = 0.5;

/**
 * Weight the five chain dimension scores into one composite.
 *
 * @param scores - Per-dimension safety scores, each 0–1.
 * @returns The weighted mean, also 0–1.
 */
export function compositeChainScore(scores: ChainRiskScores): number {
  return (
    scores.stateValidation * COMPOSITE_WEIGHTS.stateValidation +
    scores.dataAvailability * COMPOSITE_WEIGHTS.dataAvailability +
    scores.exit * COMPOSITE_WEIGHTS.exit +
    scores.sequencer * COMPOSITE_WEIGHTS.sequencer +
    scores.proposer * COMPOSITE_WEIGHTS.proposer
  );
}

/**
 * Derive the regime multiplier applied to measured volatility.
 *
 * A safer chain leaves volatility as measured; a riskier one amplifies it. The
 * relationship is linear in the composite with a bounded slope, so a fully-safe
 * chain yields exactly 1.0 and a fully-unsafe one yields `1 + REGIME_SENSITIVITY`.
 *
 * @param composite - The composite chain safety score, 0–1.
 * @returns The multiplier, in `[1, 1 + REGIME_SENSITIVITY]`.
 * @example
 * ```ts
 * volatilityMultiplier(1); // 1 (safest chain: no amplification)
 * volatilityMultiplier(0); // 1.8
 * ```
 */
export function volatilityMultiplier(composite: number): number {
  return 1 + (1 - composite) * REGIME_SENSITIVITY;
}

/**
 * Derive the chain risk premium added to the base risk-free rate.
 *
 * @param composite - The composite chain safety score, 0–1.
 * @returns The premium as a `DecimalRate`.
 * @example
 * ```ts
 * chainRiskPremium(1); // 0 (safest chain: no premium)
 * chainRiskPremium(0); // 0.06
 * ```
 */
export function chainRiskPremium(composite: number): DecimalRate {
  return rate((1 - composite) * PREMIUM_SENSITIVITY);
}

/**
 * Derive the haircut applied to recoverable collateral.
 *
 * A chain whose exit window is closed or whose sequencer can halt makes
 * collateral less reliably recoverable, so it is discounted. Both dimensions are
 * weighted equally because either one alone can strand a position.
 *
 * @param scores - The chain's dimension scores.
 * @returns A multiplier in `[1 - MAX_HAIRCUT, 1]`.
 * @example
 * ```ts
 * collateralHaircut({ ...perfectScores }); // 1 (nothing discounted)
 * ```
 */
export function collateralHaircut(scores: ChainRiskScores): number {
  const exitRisk = 1 - scores.exit;
  const sequencerRisk = 1 - scores.sequencer;
  const combined = (exitRisk + sequencerRisk) / 2;
  return 1 - combined * MAX_HAIRCUT;
}

/**
 * Derive the multiplier applied to a structural probability of default.
 *
 * Chain weakness and governance turbulence both raise effective default risk, so
 * the loads are summed rather than averaged: a protocol on a weak chain *and*
 * mid-controversy is worse than either alone.
 *
 * @param chainComposite - The composite chain safety score, 0–1.
 * @param governanceComposite - The composite governance score, 0–1. Omit when
 *   no governance profile was collected; the chain load then stands alone.
 * @returns A multiplier `>= 1`.
 */
export function pdLoad(chainComposite: number, governanceComposite?: number): number {
  const chainLoad = (1 - chainComposite) * 0.5;
  const governanceLoad = governanceComposite === undefined ? 0 : (1 - governanceComposite) * 0.3;
  return 1 + chainLoad + governanceLoad;
}

/**
 * Derive a liquidity quality score from market-maker depth.
 *
 * Depth is the metric that matters for slippage: a venue with deep books absorbs
 * an order at a better price. The median depth is used rather than the mean so a
 * single dominant maker cannot mask a thin venue, and the score saturates at a
 * documented ceiling because beyond it the extra depth stops changing execution
 * quality for realistic order sizes.
 *
 * @param makers - The market makers relevant to the venue.
 * @returns A score in 0–1. Zero when no maker reports metrics, which is the
 *   honest answer for "unknown" rather than assuming a safe default.
 */
export function liquidityScore(makers: readonly MarketMakerProfile[]): number {
  const depths = makers
    .map((m) => m.metrics?.depthUsd)
    .filter((d): d is number => typeof d === 'number' && d > 0)
    .sort((a, b) => a - b);

  if (depths.length === 0) return 0;

  const middle = Math.floor(depths.length / 2);
  const median = depths.length % 2 === 0 ? (depths[middle - 1]! + depths[middle]!) / 2 : depths[middle]!;

  // Saturates at $5M median depth: a documented ceiling rather than an
  // unbounded ratio, so the score stays comparable across venues.
  const CEILING_USD = 5_000_000;
  return Math.min(median / CEILING_USD, 1);
}

/**
 * Derive the full adjustment from chain, governance and market-maker inputs.
 *
 * @param input - The risk inputs.
 * @returns The adjustment, with every factor explained.
 * @example
 * ```ts
 * const adjustment = deriveRiskAdjustment({
 *   chainScores: baseChainScores,
 *   realizedVolatility: rate(0.42),
 *   baseRiskFreeRate: rate(0.05),
 * });
 * // adjustment.volatility -> the scaled rate
 * // adjustment.factors    -> why it was scaled
 * ```
 */
export function deriveRiskAdjustment(input: RiskDerivationInput): RiskAdjustment {
  const composite = compositeChainScore(input.chainScores);
  const multiplier = volatilityMultiplier(composite);
  const volatilitySource = input.realizedVolatility === null ? 'fallback' : 'realized';
  const baseVolatility = input.realizedVolatility ?? FALLBACK_VOLATILITY;
  const volatility = rate(baseVolatility * multiplier);
  const premium = chainRiskPremium(composite);
  const effectiveRate = rate(input.baseRiskFreeRate + premium);
  const haircut = collateralHaircut(input.chainScores);
  const governanceComposite = input.governance?.governanceScores.composite;
  const load = pdLoad(composite, governanceComposite);
  const liquidity = liquidityScore(input.marketMakers ?? []);

  const factors: RiskFactor[] = [
    {
      name: 'chainComposite',
      value: composite,
      explanation: `Weighted chain safety across five L2Beat dimensions; higher is safer.`,
    },
    {
      name: 'volatilityMultiplier',
      value: multiplier,
      explanation:
        `Measured volatility is amplified by ${(multiplier - 1).toFixed(3)} because the ` +
        `chain composite is ${composite.toFixed(3)} (1.0 would mean no amplification).`,
    },
    {
      name: 'chainRiskPremium',
      value: premium,
      explanation: `Added to the base discount rate to price chain-level risk.`,
    },
    {
      name: 'collateralHaircut',
      value: haircut,
      explanation:
        `Recoverable collateral is discounted by ${(1 - haircut).toFixed(3)} to account for ` +
        `exit-window and sequencer risk.`,
    },
    {
      name: 'pdLoad',
      value: load,
      explanation:
        governanceComposite === undefined
          ? 'Probability of default scaled by chain risk only; no governance profile was available.'
          : `Probability of default scaled by both chain risk and a governance composite of ` +
            `${governanceComposite.toFixed(3)}.`,
    },
    {
      name: 'liquidityScore',
      value: liquidity,
      explanation:
        liquidity === 0
          ? 'No market-maker depth was available, so liquidity is reported as unknown (0).'
          : `Median market-maker book depth relative to a $5M saturation ceiling.`,
    },
  ];

  return {
    volatility,
    riskFreeRate: effectiveRate,
    collateralHaircut: haircut,
    pdLoad: load,
    liquidityScore: liquidity,
    factors,
    volatilitySource,
  };
}

/**
 * Scale a notional by the derived haircut, for callers sizing a position.
 *
 * @param notional - The raw collateral value.
 * @param adjustment - A previously derived adjustment.
 * @returns The recoverable value after the haircut.
 * @example
 * ```ts
 * recoverableCollateral(usd(1_000_000), adjustment);
 * ```
 */
export function recoverableCollateral(notional: Usd, adjustment: RiskAdjustment): Usd {
  return usd(notional * adjustment.collateralHaircut);
}
