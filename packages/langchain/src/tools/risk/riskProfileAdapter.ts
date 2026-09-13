/**
 * Adapts the published risk snapshots to the shape `risk_chain_report` consumes.
 *
 * ## Why an adapter rather than a second reader
 *
 * `risk-analysis-data-pipeline` already reads `risk/chains/{slug}.json` and exposes a
 * `RiskProfileReader`. The report tool wants a smaller, flatter input — the six values the level
 * derivation actually depends on. Writing a second reader would mean two paths to the same snapshot
 * that can disagree, so this maps one onto the other and nothing else reads the store twice.
 *
 * ## What is deliberately not mapped
 *
 * `exitWindowDays` and `sequencerDelayHours` are left absent. The snapshot carries the five
 * decentralisation dimensions as 0–1 **scores** and their verbatim source strings — not parsed
 * durations. Pulling "7 days" out of a prose string would be a guess dressed as a measurement, and
 * those two fields exist precisely to catch a chain whose exit window is too long to leave on your own
 * timetable.
 *
 * The consequence is stated rather than hidden: the level is derived from the L2Beat stage and the
 * composite score, and the per-dimension ceilings are **not** evaluated from this source. A caller that
 * has the durations — `chain_risk_history` carries them as columns — should supply them directly rather
 * than expect this adapter to invent them.
 */

import type { RiskProfileReader } from "@ethonline2026/risk-analysis-data-pipeline";
import type { ChainRiskReader } from "./ChainRiskReportTool.js";
import type { ChainRiskInput } from "./riskReport.js";

/**
 * Wrap a snapshot reader as the report tool's reader.
 *
 * Propagation of a thrown error is intentional: my tool catches a failed read and reports
 * `risk_read_failed`, whereas swallowing it here would turn a broken store into "no snapshot for that
 * chain" — which reads as a fact about the chain.
 */
export function chainRiskReaderFrom(reader: RiskProfileReader): ChainRiskReader {
  return {
    async latest(chainSlug: string): Promise<ChainRiskInput | null> {
      const loaded = await reader.chain(chainSlug);
      if (loaded === null) return null;

      const profile = loaded.value;
      return {
        chainSlug: profile.slug,
        stage: profile.stage,
        compositeScore: profile.riskScores.composite,
        // `null` from the source means "not reported", which is not zero and not a large number —
        // so it is omitted rather than coerced, and the report shows no value for it.
        ...(profile.valueSecuredUsd === null ? {} : { valueSecuredUsd: profile.valueSecuredUsd }),
      };
    },
  };
}
