/**
 * Proposal classification shared by the temporal writer and the read path.
 *
 * Whether a governance proposal is *risk-relevant* — one that can move collateral
 * factors, liquidation thresholds, interest-rate models or oracle parameters — is
 * a single rule that two callers already need: the history writer, which stores
 * the count, and the API, which reports it. Keeping the rule in one exported,
 * tested place means the number in the database and the number in an API response
 * cannot disagree, and a change to what "risk-relevant" means is a change in one
 * file.
 *
 * ## Why titles, and why a keyword match
 *
 * Forums do not label proposals by economic effect. Aave's own prefixes (`ARFC`,
 * `AIP`, `Temp Check`) describe the *process stage*, not the subject, and an
 * `ARFC` covers both "raise the liquidation threshold" and "renew the grants
 * committee". The title is therefore the only consistently available signal.
 *
 * ## Known limitation: this is a substring match
 *
 * The terms are matched anywhere in the title, so `cap` also matches "capital"
 * and "capacity", and `risk` also matches "asterisk". That is retained
 * deliberately: this module was extracted to consolidate an existing rule, and a
 * refactor that also changed which proposals count would silently shift stored
 * counts and API figures. The behaviour is therefore preserved exactly, and
 * tightening the match is a separate, explicit decision rather than a side effect.
 * The rule is a heuristic for prioritising human attention, not a claim about a
 * proposal's contents.
 */

/**
 * Terms whose presence in a title indicates a proposal that can change risk
 * parameters.
 *
 * Matched as substrings, case-insensitively, mirroring the original rule.
 */
const RISK_TERMS =
  /collateral|liquidation|ltv|risk|cap|debt|interest rate|irm|oracle|parameter|reserve/i;

/**
 * Decide whether a proposal title concerns risk parameters.
 *
 * @param title - The proposal title as published, prefixes included.
 * @returns True when the title mentions a risk-parameter term.
 * @example
 * ```ts
 * isRiskRelevantProposal('[ARFC] Raise the liquidation threshold'); // true
 * isRiskRelevantProposal('[ARFC] Renew the grants committee');     // false
 * ```
 */
export function isRiskRelevantProposal(title: string): boolean {
  return RISK_TERMS.test(title);
}

/**
 * Count risk-relevant proposals in a list.
 *
 * @param proposals - Proposals with their titles.
 * @returns How many titles matched.
 * @example
 * ```ts
 * countRiskRelevantProposals(profile.proposals);
 * ```
 */
export function countRiskRelevantProposals(
  proposals: readonly { readonly title: string }[],
): number {
  return proposals.filter((proposal) => isRiskRelevantProposal(proposal.title)).length;
}
