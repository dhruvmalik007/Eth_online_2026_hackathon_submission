/**
 * Risk-context construction for the v0.1 synthesis node.
 *
 * ## Why this is a separate step, and why it runs before the model
 *
 * The synthesis model is a language model. If it were asked to *estimate* a
 * collateral haircut or a probability-of-default load it would produce a
 * plausible number with nothing behind it, and no downstream check could tell
 * that number from a derived one. So the parameters are computed here, by the
 * risk-analysis package's pure functions, and handed to the model as given
 * inputs. The model's job is to reason *about* them, not to produce them.
 *
 * That division is also what makes the guardrail meaningful: because every value
 * has a documented range and a recorded provenance, a payload that violates
 * either is detectably not a derivation (see `validateRiskContext`).
 *
 * ## What is in and what is out
 *
 * In: the chain's five L2Beat dimensions and composite score, the governance
 * profile of the first protocol that has one, and whatever market makers the
 * caller names. Out: realized volatility, which this module cannot measure — it
 * belongs to the pool's price history, so a caller that has it passes it in and
 * one that does not gets the documented fallback, clearly labelled.
 *
 * A subject with no snapshot is recorded in `unresolved` rather than dropped.
 * "We have no governance data for this protocol" and "governance risk is zero"
 * are different statements, and only one of them is true here.
 */

import {
  deriveRiskAdjustment,
  rate,
  type ChainRiskProfile,
  type DecimalRate,
  type MarketMakerProfile,
  type MarketMakerReader,
  type ProtocolGovernanceProfile,
  type ProtocolGovernanceReader,
} from '@ethonline2026/risk-analysis-data-pipeline';
import type { RiskContext } from './schemas.js';

/**
 * The risk context load. Kept structural so the graph can be tested without a
 * store: any object exposing the two narrow readers satisfies it.
 */
export interface RiskContextReaders extends ProtocolGovernanceReader, MarketMakerReader {}

/**
 * Input for {@link buildRiskContext}.
 */
export interface BuildRiskContextInput {
  /** The chain whose risk regime applies. */
  readonly chain: ChainRiskProfile;
  /** Protocol slugs to include; the first that resolves supplies the governance term. */
  readonly protocols: readonly string[];
  /** Market-maker slugs to include in the liquidity score. */
  readonly marketMakers?: readonly string[];
  /** The readers to resolve subjects through. */
  readonly readers: RiskContextReaders;
  /** Measured volatility, when the caller has it. `null` uses the fallback. */
  readonly realizedVolatility?: DecimalRate | null;
  /** Base discount rate before the chain premium. */
  readonly baseRiskFreeRate?: DecimalRate;
}

/**
 * The documented default base rate.
 *
 * Matches the value the Merton tool used before this context existed, so an
 * agent that supplies no rate behaves exactly as it did previously.
 */
export const DEFAULT_BASE_RISK_FREE_RATE = 0.05;

/**
 * Derive the risk parameters and package them for agent state.
 *
 * @param input - The chain, the subjects to resolve, and the readers to resolve
 *   them through.
 * @returns A validated risk context carrying its citation id, the parameters,
 *   the factors that produced them, and any requested subject that had no data.
 * @example
 * ```ts
 * const context = await buildRiskContext({
 *   chain: chainProfile,
 *   protocols: ['aave'],
 *   readers: { protocol: ..., protocolSlugs: ..., marketMaker: ..., ... },
 * });
 * ```
 */
export async function buildRiskContext(input: BuildRiskContextInput): Promise<RiskContext> {
  const unresolved: string[] = [];

  // The first protocol with a snapshot supplies the governance term. Scanning is
  // deliberate: a mandate naming several protocols should still get a risk
  // context when only one of them has been collected.
  let governance: ProtocolGovernanceProfile | null = null;
  for (const slug of input.protocols) {
    const loaded = await input.readers.protocol(slug);
    if (loaded === null) {
      unresolved.push(slug);
      continue;
    }
    governance = loaded.value;
    break;
  }

  const marketMakers: MarketMakerProfile[] = [];
  for (const slug of input.marketMakers ?? []) {
    const loaded = await input.readers.marketMaker(slug);
    if (loaded === null) {
      unresolved.push(slug);
      continue;
    }
    marketMakers.push(loaded.value);
  }

  const adjustment = deriveRiskAdjustment({
    chainScores: input.chain.riskScores,
    ...(governance === null ? {} : { governance }),
    ...(marketMakers.length === 0 ? {} : { marketMakers }),
    realizedVolatility: input.realizedVolatility ?? null,
    baseRiskFreeRate: input.baseRiskFreeRate ?? rate(DEFAULT_BASE_RISK_FREE_RATE),
  });

  return {
    // The citation id a decision uses to point at this derivation. Chain-scoped
    // because the parameters are a property of the chain's regime.
    id: riskContextId(input.chain.slug),
    chain: input.chain.slug,
    chainName: input.chain.name,
    protocol: governance?.slug ?? null,
    marketMakers: marketMakers.map((maker) => maker.slug),
    adjustment: {
      volatility: adjustment.volatility,
      riskFreeRate: adjustment.riskFreeRate,
      collateralHaircut: adjustment.collateralHaircut,
      pdLoad: adjustment.pdLoad,
      liquidityScore: adjustment.liquidityScore,
    },
    volatilitySource: adjustment.volatilitySource,
    factors: adjustment.factors.map((factor) => ({
      name: factor.name,
      value: factor.value,
      explanation: factor.explanation,
    })),
    unresolved,
  };
}

/**
 * The citation id for a chain's risk context.
 *
 * Exported so the graph that creates a context and any code that validates a
 * citation derive the id the same way, rather than agreeing by convention.
 *
 * @param chainSlug - The chain slug.
 * @returns The citation id, e.g. `risk-base`.
 */
export function riskContextId(chainSlug: string): string {
  return `risk-${chainSlug}`;
}
