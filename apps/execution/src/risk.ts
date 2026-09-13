/**
 * Risk, as *presented to an operator*, not as decided here.
 *
 * ## The correction this file makes
 *
 * An earlier version of this module scored risk itself: it took a `0..1` number, compared it against
 * ceilings it defined, and blocked approval when the number was high. That was wrong in three ways,
 * and they are worth stating because each one is a trap worth not re-entering.
 *
 * 1. **It scored risk without the context.** The metrics arrive from
 *    `@ethonline2026/risk-analysis-data-pipeline`, which collects L2 infrastructure risk, dependency
 *    and exit characteristics from the chains themselves and from DeFiLlama. Turning those into a
 *    verdict needs reasoning over them, in the light of a specific strategy — which is exactly what
 *    the agent is for. A threshold in a service does not have that context and cannot acquire it.
 * 2. **A hardcoded ceiling is a policy nobody set.** Any number in this file would have been mine, and
 *    it would then have been the number that let a transaction through.
 * 3. **It conflated two decisions.** "Should this execute" is an *approval* question, answered by an
 *    EOA holder with a mandate. "How risky is this" is an *inference*, answered by the agent from the
 *    metrics. Gating the first on the second means a threshold bug becomes a funds bug.
 *
 * ## The split, now
 *
 * | | Owner | Output |
 * |---|---|---|
 * | Collect metrics | `risk-analysis-data-pipeline` | observations per chain |
 * | Infer the verdict | the agent, with tools and context | {@link RiskReport} |
 * | Present it | this service | {@link RiskNotice} |
 * | Permit execution | the approval path, in `approval.ts` | an operator's decision |
 *
 * **Nothing here blocks anything.** A report is carried and rendered; the endpoints return whatever
 * the approval path decides. A high reading is information, and information that stops a trade is not
 * information — it is a control in the wrong layer.
 */

/** One observation, as the pipeline emitted it. A measurement, never a conclusion. */
export interface RiskMetric {
  readonly id: string;
  readonly label: string;
  readonly value: number | string;
  readonly unit?: string;
  /** Where it came from — a chain RPC, DeFiLlama, an L2 registry. */
  readonly source: string;
}

/** Confidence the agent places in its own verdict. Surfaced, never thresholded. */
export const RISK_LEVELS = ["low", "moderate", "elevated", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** The agent's inference over the metrics for one chain. */
export interface RiskReport {
  readonly chain: string;
  /** The observations the verdict rests on, carried so an operator can disagree with it. */
  readonly metrics: readonly RiskMetric[];
  readonly conclusion: {
    readonly level: RiskLevel;
    /** The agent's reasoning, in its own words. The part an operator actually reads. */
    readonly rationale: string;
  };
  readonly provenance: {
    readonly source: string;
    readonly asOf: string;
    /** Which agent or model produced the verdict, so a verdict has an owner. */
    readonly inferredBy?: string;
  };
}

/**
 * Where reports come from.
 *
 * A port because the inference happens in the agentic pipeline, not here: the service asks for the
 * latest verdict and renders it. `undefined` means no verdict has been produced yet, which is
 * reported as `unreported` rather than as any level — an absent inference is not a quiet one.
 */
export interface RiskReportSource {
  latest(chain: string): Promise<RiskReport | undefined>;
}

/** No reports available. Named rather than passed as an inline stub. */
export const NO_RISK_REPORTS: RiskReportSource = {
  latest: async () => undefined,
};

/** A rendered report. What the execution component or a notification shows. */
export interface RiskNotice {
  /** `unreported` when no verdict exists yet — distinct from every level, including `low`. */
  readonly level: RiskLevel | "unreported";
  readonly headline: string;
  readonly detail: string;
  readonly metrics: readonly RiskMetric[];
  readonly provenance: RiskReport["provenance"] | null;
}

/**
 * Render a report for display.
 *
 * Presentation only: it formats, it does not weigh. There is deliberately no `requiresApproval` here —
 * that decision belongs to `approval.ts`, and a field with that name in a presentation helper is how
 * the two get wired back together by someone in a hurry.
 */
export function describeRisk(report: RiskReport | undefined): RiskNotice {
  if (report === undefined) {
    return {
      level: "unreported",
      headline: "No risk verdict yet",
      detail:
        "The agentic pipeline has not produced a verdict for this chain. Nothing is implied by its " +
        "absence — this is a statement about the pipeline, not about the chain.",
      metrics: [],
      provenance: null,
    };
  }

  const cited = report.metrics.length;
  return {
    level: report.conclusion.level,
    headline: `Risk: ${report.conclusion.level}`,
    detail:
      `${report.conclusion.rationale} ` +
      (cited === 0
        ? "No metrics were cited, so the verdict rests on the agent's own reasoning."
        : `Based on ${cited} metric${cited === 1 ? "" : "s"} from the risk pipeline.`),
    metrics: report.metrics,
    provenance: report.provenance,
  };
}
