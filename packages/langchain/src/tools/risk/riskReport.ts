/**
 * The risk report the agent produces, and the plain-language reading of each factor.
 *
 * ## Why alpha, beta and gamma
 *
 * They are the three questions a fixed-income investor asks about a position, and each has a
 * different answer for an LP position than for a bond — which is exactly why they belong in the
 * report rather than in a model's head.
 *
 * - **Alpha** — what the position earns *regardless of direction*. For a bond, coupon over the
 *   risk-free rate. For an LP position, fee income over the same.
 * - **Beta** — how much it moves *when the market does*. A 50/50 pool is roughly half-exposed.
 * - **Gamma** — how much beta *itself* changes as the market moves. This is the one that matters and
 *   the one usually omitted: an LP position has **negative** gamma. Its exposure shifts against the
 *   holder as price moves, which is impermanent loss, and it grows with the size of the move rather
 *   than linearly. A fixed-income investor who is told only alpha and beta has been told the
 *   favourable half.
 *
 * ## Why the level is derived rather than guessed
 *
 * The mapping from the pipeline's L2 metrics to a level is a documented function of those metrics, so
 * a verdict can be audited by reading the rationale and checking the inputs. A model asked to
 * "assess risk" from the same numbers would produce something unreproducible, and the point of
 * surfacing risk at all is that an operator can disagree with it — which requires being able to see
 * what drove it.
 *
 * The agent still owns the verdict: this proposes a level with its reasoning, and the report is a
 * value the agent can carry, amend, or overrule.
 */

import * as z from "zod";

/** The report is only as good as the instant it was taken. */
export const RiskMetricSchema = z.object({
  id: z.string().min(1).describe("Stable identifier, e.g. l2.exit_window_days"),
  label: z.string().min(1).describe("Human label for the metric"),
  value: z.union([z.number(), z.string()]),
  unit: z.string().optional(),
  source: z.string().min(1).describe("Where the value came from"),
  observedAt: z.string().optional(),
});
export type RiskMetric = z.infer<typeof RiskMetricSchema>;

export const RISK_FACTOR_IDS = ["alpha", "beta", "gamma"] as const;
export type RiskFactorId = (typeof RISK_FACTOR_IDS)[number];

export const RiskFactorSchema = z.object({
  id: z.enum(RISK_FACTOR_IDS),
  label: z.string().min(1),
  /** Null when the input was not supplied — never zero, which would read as a measurement. */
  value: z.number().nullable(),
  unit: z.string().optional(),
  /** What the factor means, in one sentence, independent of its value. */
  meaning: z.string().min(1),
  /** What *this* value means, in one sentence. */
  reading: z.string().min(1),
});
export type RiskFactor = z.infer<typeof RiskFactorSchema>;

export const RISK_LEVELS = ["low", "moderate", "elevated", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RiskReportSchema = z.object({
  chain: z.string().min(1),
  metrics: z.array(RiskMetricSchema),
  factors: z.array(RiskFactorSchema),
  conclusion: z.object({
    level: z.enum(RISK_LEVELS),
    /** Which inputs drove the level, named so an operator can check them. */
    rationale: z.string().min(1),
  }),
  provenance: z.object({
    source: z.string().min(1),
    asOf: z.string().min(1),
    inferredBy: z.string().min(1),
  }),
});
export type RiskReport = z.infer<typeof RiskReportSchema>;

/** The risk-free rate the pipeline uses, so alpha is measured against the same base everywhere. */
export const DEFAULT_RISK_FREE_RATE = 0.05;

/**
 * The plain-language reading of one factor's value.
 *
 * Written for someone who holds positions rather than options: no formula is named, and the
 * consequence is stated before the mechanism.
 */
export function explainFactor(id: RiskFactorId, value: number | null): string {
  if (value === null) {
    return "Not supplied for this position, so nothing about it is implied — an absent input is not a zero one.";
  }

  if (id === "alpha") {
    const pct = (value * 100).toFixed(2);
    if (value <= 0) {
      return `Earns nothing above the risk-free rate (${pct}% net). The position is being held for exposure, not for income.`;
    }
    return `Earns ${pct}% a year above the risk-free rate, whatever the market does. This is the part of the return that does not depend on direction.`;
  }

  if (id === "beta") {
    const magnitude = Math.abs(value);
    const direction = value < 0 ? "in the opposite direction to" : "with";
    if (magnitude < 0.1) return `Barely moves ${direction} the market (${value.toFixed(2)}) — close to direction-neutral.`;
    if (magnitude < 0.6) return `Moves about ${(magnitude * 100).toFixed(0)}% as much as the underlying (${value.toFixed(2)}).`;
    return `Moves broadly ${direction} the market (${value.toFixed(2)}), so it carries most of the underlying's direction risk.`;
  }

  // gamma
  if (value < 0) {
    return (
      `Negative (${value.toFixed(2)}), which is the important one: as the price moves, the exposure ` +
      `shifts against you rather than with you. That is impermanent loss, and it grows with the ` +
      `size of the move rather than in proportion to it — so a large move costs more than twice a ` +
      `half-sized one.`
    );
  }
  if (value === 0) {
    return "Flat (0.00): the exposure does not change as the price moves, which is what a fixed-rate position looks like.";
  }
  return `Positive (${value.toFixed(2)}): the exposure grows as the price moves in your favour, so gains compound rather than accrue evenly.`;
}

/** Build the three factors from whatever the caller could supply. */
export function buildFactors(input: {
  readonly alpha?: number | null;
  readonly beta?: number | null;
  readonly gamma?: number | null;
}): RiskFactor[] {
  const specs: { id: RiskFactorId; label: string; meaning: string; unit: string }[] = [
    {
      id: "alpha",
      label: "Alpha",
      unit: "rate",
      meaning: "What the position earns regardless of market direction.",
    },
    {
      id: "beta",
      label: "Beta",
      unit: "ratio",
      meaning: "How much the position moves when the underlying moves.",
    },
    {
      id: "gamma",
      label: "Gamma",
      unit: "ratio",
      meaning:
        "How much beta itself changes as the price moves — for an LP position this is negative, and it is where impermanent loss lives.",
    },
  ];

  return specs.map((spec) => {
    const value = input[spec.id] ?? null;
    return {
      id: spec.id,
      label: spec.label,
      value,
      unit: spec.unit,
      meaning: spec.meaning,
      reading: explainFactor(spec.id, value),
    };
  });
}

/**
 * The L2 metrics the pipeline publishes for a chain, as the tool consumes them.
 *
 * Only the fields the level depends on are named; the rest reach the report through the metric list,
 * so an unexpected field is still surfaced rather than dropped.
 */
export interface ChainRiskInput {
  readonly chainSlug: string;
  readonly stage: string;
  readonly compositeScore: number;
  readonly exitWindowDays?: number | null;
  readonly sequencerDelayHours?: number | null;
  readonly valueSecuredUsd?: number | null;
  readonly observedAt?: string;
}

/** The ceilings the level is derived against. Documented, so a disagreement is with a number. */
export const LEVEL_THRESHOLDS = {
  composite: { moderate: 0.2, elevated: 0.4, high: 0.6 },
  exitWindowDays: 7,
  sequencerDelayHours: 24,
} as const;

const RANK: Record<RiskLevel, number> = { low: 0, moderate: 1, elevated: 2, high: 3 };

function worse(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * Derive a level, naming what drove it.
 *
 * `Stage 0` short-circuits to `high`: it means the chain's own governance can still change state
 * without an exit window, and no composite score compensates for that on a position you intend to
 * hold. That is the one rule here that is a judgement rather than a number, and it is stated as such.
 */
export function deriveLevel(input: ChainRiskInput): { level: RiskLevel; rationale: string } {
  if (input.stage.trim() === "Stage 0") {
    return {
      level: "high",
      rationale:
        `The chain is ${input.stage}, which means its operators can still change state without an ` +
        `exit window. That is a judgement rather than a threshold: no composite score compensates ` +
        `for it on a position you intend to hold, so it does not matter what the other metrics say.`,
    };
  }

  const reasons: string[] = [];
  let level: RiskLevel;

  const score = input.compositeScore;
  if (score >= LEVEL_THRESHOLDS.composite.high) level = "high";
  else if (score >= LEVEL_THRESHOLDS.composite.elevated) level = "elevated";
  else if (score >= LEVEL_THRESHOLDS.composite.moderate) level = "moderate";
  else level = "low";
  reasons.push(`composite score ${score.toFixed(2)}`);

  // A long exit window is the metric that decides whether a held position can actually be left, so it
  // can raise the level on its own even when the aggregate looks comfortable.
  if (input.exitWindowDays != null && input.exitWindowDays > LEVEL_THRESHOLDS.exitWindowDays) {
    level = worse(level, "elevated");
    reasons.push(
      `exit window of ${input.exitWindowDays} days, above the ${LEVEL_THRESHOLDS.exitWindowDays}-day ceiling — ` +
        `a position you cannot leave on your own timetable is riskier than its average suggests`,
    );
  }

  if (input.sequencerDelayHours != null && input.sequencerDelayHours > LEVEL_THRESHOLDS.sequencerDelayHours) {
    level = worse(level, "elevated");
    reasons.push(
      `a ${input.sequencerDelayHours}-hour sequencer delay, above the ${LEVEL_THRESHOLDS.sequencerDelayHours}-hour ceiling`,
    );
  }

  return { level, rationale: `Driven by ${reasons.join("; ")}.` };
}

/** Assemble the report from the chain's metrics and whatever position factors were supplied. */
export function buildRiskReport(input: {
  readonly chain: ChainRiskInput;
  readonly metrics: readonly RiskMetric[];
  readonly factors: { readonly alpha?: number | null; readonly beta?: number | null; readonly gamma?: number | null };
  readonly asOf: string;
  readonly inferredBy: string;
}): RiskReport {
  const { level, rationale } = deriveLevel(input.chain);
  return {
    chain: input.chain.chainSlug,
    metrics: [...input.metrics],
    factors: buildFactors(input.factors),
    conclusion: { level, rationale },
    provenance: { source: "risk-analysis-data-pipeline", asOf: input.asOf, inferredBy: input.inferredBy },
  };
}
