/**
 * Whether to switch 1inch/Aqua on for a run — and who is allowed to decide.
 *
 * ## Why this is a decision rather than a flag
 *
 * A venue that turns itself on is a venue nobody reviewed. Enabling Aqua changes *how* a flight
 * executes: the fill goes through a SwapVM program against Aqua balances instead of a conventional
 * router. That is worth doing when it is measurably better and worth nothing when it is not, so the
 * question is not "is it available" but "is it better, by how much, and who may say yes".
 *
 * ## Two moments, one assessment
 *
 * The same answer is shown twice, deliberately, because the two moments ask different things:
 *
 * - **Simulation** — "what would happen if we used it?" The efficiency delta is the answer, and it
 *   is presented for review rather than acted on.
 * - **Approval** — "shall we?" The consent is recorded here, and the assessment says whether the
 *   answer can come from the operator alone or whether an agent's mandate is wide enough to give it.
 *
 * Computing it once and presenting it in both places is what stops the two stages from disagreeing
 * about how much was at stake.
 *
 * ## Why an agent may be allowed to consent
 *
 * The point of an efficiency threshold is that some deltas are obvious. Above the mandate's
 * threshold — and only when the mandate permits it — an agent may enable the venue without waking
 * a human, because the decision is arithmetic rather than judgement. Below it, the answer is a
 * preference about risk and cost, which is a human's to give.
 *
 * Pure: no client, no clock, no network. The efficiency figure arrives measured.
 */

import { z } from "zod";
import { CHAIN_KEYS, type ChainKey } from "../chains/chainRegistry.js";

/**
 * The outcome.
 *
 * A closed set for the same reason every other vocabulary here is closed: the UI branches on it,
 * the reason code is logged, and a code that appeared at runtime would be a code nothing renders.
 */
export const ENABLEMENT_RECOMMENDATIONS = [
  /** Not deployed, or no quote is possible on this chain. */
  "unavailable",
  /** Already on for this run; nothing left to consent to. */
  "enabled",
  /** Better, but not by enough to be worth the change. */
  "not_worthwhile",
  /** Better by enough to be worth it. Consent is required. */
  "recommend",
] as const;
export type EnablementRecommendation = (typeof ENABLEMENT_RECOMMENDATIONS)[number];

/** Who may give the consent a `recommend` needs. */
export const CONSENT_GRANTORS = ["user", "user-or-agent"] as const;
export type ConsentGranter = (typeof CONSENT_GRANTORS)[number];

export const EnablementInputSchema = z.object({
  chain: z.enum(CHAIN_KEYS),
  /** Whether the venue has a verified deployment and can be quoted on this chain. */
  venueAvailable: z.boolean(),
  /** Whether it is already switched on for this run. */
  alreadyEnabled: z.boolean(),
  /**
   * How much better the Aqua fill is than the comparison route, in basis points.
   *
   * Measured, not assumed: the caller compares two real quotes. A negative value is meaningful —
   * it means Aqua is *worse*, which is a legitimate outcome and must not be silently clamped to
   * zero, because that would turn a loss into a tie.
   */
  efficiencyBps: z.number().finite(),
  /** The delta below which the change is not worth making. */
  minEfficiencyBps: z.number().nonnegative(),
  /** What the strategy's mandate permits. */
  mandate: z.object({
    /** Whether an agent may enable the venue on its own, above `minEfficiencyBpsForAgent`. */
    allowAgentEnablement: z.boolean(),
    /** The delta above which an agent's judgement is arithmetic rather than preference. */
    minEfficiencyBpsForAgent: z.number().nonnegative(),
  }),
});
export type EnablementInput = z.infer<typeof EnablementInputSchema>;

export interface EnablementAssessment {
  readonly chain: ChainKey;
  readonly recommendation: EnablementRecommendation;
  /** The measured delta, carried through unchanged so both stages report the same figure. */
  readonly efficiencyBps: number;
  /**
   * Whether a consent is outstanding.
   *
   * False only when there is nothing to decide: already enabled, unavailable, or not worth it.
   * A `recommend` always has one outstanding — that is what makes it a recommendation.
   */
  readonly consentRequired: boolean;
  /** Who may give it. */
  readonly consentGranter: ConsentGranter;
  /** A sentence for the log and the approval card. */
  readonly detail: string;
}

/**
 * Assess whether to enable the venue.
 *
 * The order of the checks is the specification, and it is not arbitrary:
 *
 * 1. **Availability first** — an enabled venue on a chain that cannot serve it is not a decision,
 *    it is a broken configuration.
 * 2. **Already enabled second** — nothing to consent to, and reporting a recommendation for
 *    something already done would produce a pointless approval prompt.
 * 3. **Worthwhileness third** — below the threshold the answer is "no", and it does not matter who
 *    is asking or what the mandate allows. An agent permitted to act on obvious deltas is still not
 *    permitted to act on imperceptible ones.
 * 4. **Who decides last** — only once the change is worth making does the mandate matter.
 *
 * @throws {z.ZodError} when the input is malformed. The efficiency figure reaches an approval
 *   prompt, so a `NaN` must fail here rather than render as an empty delta.
 */
export function assessEnablement(input: EnablementInput): EnablementAssessment {
  const parsed = EnablementInputSchema.parse(input);

  if (!parsed.venueAvailable) {
    return {
      chain: parsed.chain,
      recommendation: "unavailable",
      efficiencyBps: parsed.efficiencyBps,
      consentRequired: false,
      consentGranter: "user",
      detail:
        `1inch Aqua+SwapVM is not available on ${parsed.chain}, so the flight will use the ` +
        `comparison route. Nothing to decide.`,
    };
  }

  if (parsed.alreadyEnabled) {
    return {
      chain: parsed.chain,
      recommendation: "enabled",
      efficiencyBps: parsed.efficiencyBps,
      consentRequired: false,
      consentGranter: "user",
      detail: `Already enabled for this run; the assessment is reported so both stages agree on the figure.`,
    };
  }

  if (parsed.efficiencyBps < parsed.minEfficiencyBps) {
    return {
      chain: parsed.chain,
      recommendation: "not_worthwhile",
      efficiencyBps: parsed.efficiencyBps,
      consentRequired: false,
      consentGranter: "user",
      detail:
        `Aqua is ${parsed.efficiencyBps} bps better than the comparison route, under the ` +
        `${parsed.minEfficiencyBps} bps worth making the change for. The mandate is irrelevant below ` +
        `the threshold: an agent trusted with obvious deltas is not trusted with imperceptible ones.`,
    };
  }

  const agentMayAct =
    parsed.mandate.allowAgentEnablement && parsed.efficiencyBps >= parsed.mandate.minEfficiencyBpsForAgent;

  return {
    chain: parsed.chain,
    recommendation: "recommend",
    efficiencyBps: parsed.efficiencyBps,
    consentRequired: true,
    consentGranter: agentMayAct ? "user-or-agent" : "user",
    detail:
      `Aqua is ${parsed.efficiencyBps} bps better than the comparison route on ${parsed.chain}, above the ` +
      `${parsed.minEfficiencyBps} bps threshold. ` +
      (agentMayAct
        ? `The mandate allows an agent to enable it above ${parsed.mandate.minEfficiencyBpsForAgent} bps, ` +
          `because at this size the decision is arithmetic.`
        : `The mandate does not allow an agent to enable it, so an operator's consent is required.`),
  };
}
