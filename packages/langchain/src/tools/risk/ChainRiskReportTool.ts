import { tool } from "@langchain/core/tools";
import * as z from "zod";
import {
  buildRiskReport,
  explainFactor,
  type ChainRiskInput,
  type RiskMetric,
  type RiskReport,
} from "./riskReport.js";

/**
 * The chain risk report tool — real L2 data in, a legible report out.
 *
 * ## Where the numbers come from
 *
 * The reader supplies the pipeline's latest published reading for a chain: the L2Beat stage, the five
 * decentralisation dimensions' measured consequences (exit window, sequencer delay), value secured and
 * the composite score. This tool owns no measurements — it reads one, and refuses to produce anything
 * when the read returns nothing.
 *
 * ## Why it refuses rather than degrading
 *
 * An absent snapshot is reported as `no_snapshot`, not as a clean chain. Risk is the one place where
 * a default is indistinguishable from an all-clear, and an all-clear that nothing observed is the
 * single most expensive thing an agent could be told.
 *
 * ## What the model is asked for
 *
 * Only alpha, beta and gamma, and only because they are *position* facts that the chain data cannot
 * contain: what the strategy earns over the risk-free rate, how it moves with the underlying, and how
 * that moves with itself. Each is optional; an omitted one reads as absent rather than as zero, and
 * the tool says so in the report.
 */

/** The latest published L2 risk reading for a chain. Backed by `chain_risk_history`. */
export interface ChainRiskReader {
  latest(chainSlug: string): Promise<ChainRiskInput | null>;
}

export interface ChainRiskReportDeps {
  /**
   * The snapshot reader. Absent means the risk routes are unconfigured, reported rather than failing —
   * matching how the rest of the agent degrades when an optional dependency is missing.
   */
  readonly reader?: ChainRiskReader | undefined;
  /** Which agent produced the report, so a verdict has an owner. */
  readonly inferredBy?: string;
  /** Injectable so a report under test has a fixed timestamp. */
  readonly now?: () => Date;
}

/** A tool error, shaped so the model sees an actionable message. */
function unavailable(chain: string): string {
  return JSON.stringify({
    chain,
    status: "risk_snapshots_unavailable",
    detail:
      "No risk snapshot store is configured. Set RISK_GCS_BUCKET (or RISK_LOCAL_DIR); the pipeline " +
      "writes snapshots every six hours.",
  });
}

/**
 * Turn the reader's reading into metrics, keeping the units attached.
 *
 * A number without its unit is the most common way a risk figure is misread — `168` is alarming or
 * unremarkable depending on whether it is hours or days — so every metric carries one.
 */
function toMetrics(input: ChainRiskInput): RiskMetric[] {
  const observedAt = input.observedAt;
  const base = { source: "risk-analysis-data-pipeline", ...(observedAt === undefined ? {} : { observedAt }) };

  const metrics: RiskMetric[] = [
    { id: "l2.stage", label: "L2Beat stage", value: input.stage, ...base },
    { id: "l2.composite_score", label: "Composite risk score", value: input.compositeScore, unit: "0-1", ...base },
  ];

  if (input.exitWindowDays != null) {
    metrics.push({
      id: "l2.exit_window_days",
      label: "Exit window",
      value: input.exitWindowDays,
      unit: "days",
      ...base,
    });
  }
  if (input.sequencerDelayHours != null) {
    metrics.push({
      id: "l2.sequencer_delay_hours",
      label: "Sequencer delay",
      value: input.sequencerDelayHours,
      unit: "hours",
      ...base,
    });
  }
  if (input.valueSecuredUsd != null) {
    metrics.push({
      id: "l2.value_secured_usd",
      label: "Value secured",
      value: input.valueSecuredUsd,
      unit: "USD",
      ...base,
    });
  }
  return metrics;
}

/**
 * Build the tool.
 *
 * @param deps - the injected reader and report identity.
 * @returns The tool set, keyed by purpose.
 */
export function createChainRiskReportTool(deps: ChainRiskReportDeps) {
  const now = deps.now ?? (() => new Date());

  const riskReportTool = tool(
    async (input: unknown) => {
      // No `chain` guard here: the tool's schema rejects a missing chain before the handler runs, so
      // a guard behind it would be unreachable code that reads like a check.
      const { chain, alpha, beta, gamma } = input as {
        chain: string;
        alpha?: number | null;
        beta?: number | null;
        gamma?: number | null;
      };

      if (deps.reader === undefined) return unavailable(chain);

      // A read that fails is reported, not smoothed over: a tool that returned a report on a failed
      // read would be indistinguishable from one that returned a clean chain.
      let reading: ChainRiskInput | null;
      try {
        reading = await deps.reader.latest(chain);
      } catch (error) {
        return JSON.stringify({
          chain,
          status: "risk_read_failed",
          detail: `The risk snapshot read failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }

      if (reading === null) {
        return JSON.stringify({
          chain,
          status: "no_snapshot",
          detail:
            "No risk snapshot for that chain yet. Nothing is implied by its absence — this is not a " +
            "clean reading, and a strategy should not be treated as low-risk on the strength of it.",
        });
      }

      const report: RiskReport = buildRiskReport({
        chain: reading,
        metrics: toMetrics(reading),
        factors: { alpha: alpha ?? null, beta: beta ?? null, gamma: gamma ?? null },
        asOf: reading.observedAt ?? now().toISOString(),
        inferredBy: deps.inferredBy ?? "v01",
      });

      return JSON.stringify({
        ...report,
        // The plain sentences are returned as their own field as well as inside each factor, because
        // a model summarising this to a person should not have to re-derive them and get them wrong.
        plainLanguage: {
          alpha: explainFactor("alpha", report.factors[0]?.value ?? null),
          beta: explainFactor("beta", report.factors[1]?.value ?? null),
          gamma: explainFactor("gamma", report.factors[2]?.value ?? null),
        },
        note:
          "The level is derived from the cited metrics by a documented rule, so it can be checked " +
          "rather than trusted. Disagreement is expected to be with the inputs or the thresholds, " +
          "both of which are in this payload.",
      });
    },
    {
      name: "risk_chain_report",
      description:
        "A legible risk report for a chain, built from the latest published L2 metrics, with alpha, " +
        "beta and gamma explained in plain language. Use it before committing to a position and " +
        "before telling a person how risky one is. Supply alpha/beta/gamma when they are known for " +
        "the position — omit them rather than passing 0, since an absent input is not a zero one. " +
        "Never invent the chain metrics.",
      schema: z.object({
        chain: z.string().describe("Chain slug, e.g. optimism, polygon, base"),
        alpha: z
          .number()
          .nullable()
          .optional()
          .describe("Annualised return above the risk-free rate, as a rate (0.02 = 2%)"),
        beta: z
          .number()
          .nullable()
          .optional()
          .describe("Sensitivity to the underlying, where 1 means it moves with it"),
        gamma: z
          .number()
          .nullable()
          .optional()
          .describe("How beta changes as price moves; negative for an LP position"),
      }),
    },
  );

  return { riskReportTool };
}
