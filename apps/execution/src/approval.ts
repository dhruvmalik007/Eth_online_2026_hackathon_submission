/**
 * Approval: the operator's decision, which is the only thing that permits execution.
 *
 * ## Why this is separate from risk
 *
 * They answer different questions and belong to different actors. **Risk is an inference** — the agent
 * reads L2 infrastructure metrics and says how a chain looks. **Approval is a decision** — the EOA
 * holder, who carries the liability, says whether this trade may happen. Wiring the second to the
 * first means a scoring bug becomes a funds bug, and it removes the human exactly where traditional
 * finance requires one.
 *
 * ## Why approval is required by default
 *
 * A default that permits is a default that eventually permits something nobody chose. In fixed-income
 * execution, where positions are large and held, the reliance on an accountable principal is not
 * ceremony — it is the control. So `requiredByDefault: true`, and the burden sits on disabling it
 * rather than on remembering to enable it.
 *
 * ## The limit, and what it is actually for
 *
 * `maxSpendUsdPerIntent` is a **per-agent mandate**: the most one strategy may commit without a fresh
 * decision. It forces approval even when `requiredByDefault` is off, so a deployment cannot
 * accidentally grant an unlimited mandate. It is deliberately per *intent* rather than per leg or per
 * day — a mandate is granted for a trade, and a limit that resets with the calendar is a limit an
 * agent can spend every day.
 *
 * This service applies the mandate. Where the mandate is *set* is the operator's surface — a settings
 * value in `apps/agentic-ems` — because a limit only an environment variable can change is a limit
 * nobody looks at.
 */

export const APPROVAL_STATES = ["not-required", "pending", "approved"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export interface ApprovalLimits {
  /** Whether an operator must approve before any leg executes. Default **true**. */
  readonly requiredByDefault: boolean;
  /** The most an agent may commit in one intent, in whole USD. */
  readonly maxSpendUsdPerIntent: number;
}

/**
 * Defaults are deliberately conservative.
 *
 * $250k is not a claim about the right number — it is a placeholder low enough that the first
 * deployment must consciously raise it, rather than high enough that nobody notices it.
 */
export const DEFAULT_APPROVAL_LIMITS: ApprovalLimits = {
  requiredByDefault: true,
  maxSpendUsdPerIntent: 250_000,
};

export interface ApprovalRequest {
  readonly required: boolean;
  readonly state: ApprovalState;
  /** A sentence for the approval card, naming what is being agreed to. */
  readonly reason: string;
  readonly requestedUsd: number;
  readonly limitUsd: number;
  /** Legs that alone exceed the mandate, so the approver sees what specifically is being asked for. */
  readonly overLimit: readonly { readonly legId: string; readonly amountUsd: number }[];
}

/**
 * Decide whether this intent needs an operator.
 *
 * The limit can *force* approval, the flag can force it, and neither can waive it: an intent that
 * exceeds the mandate needs approval even where `requiredByDefault` is off, which is what makes the
 * mandate a mandate rather than a display value.
 *
 * @param decidedBy - the approver's identity once they have decided. Absent means pending.
 */
export function assessApproval(input: {
  readonly legs: readonly { readonly id: string; readonly amountUsd: number }[];
  readonly limits: ApprovalLimits;
  readonly decidedBy?: string;
}): ApprovalRequest {
  const requestedUsd = input.legs.reduce((total, leg) => total + leg.amountUsd, 0);
  const overLimit = input.legs
    .filter((leg) => leg.amountUsd > input.limits.maxSpendUsdPerIntent)
    .map((leg) => ({ legId: leg.id, amountUsd: leg.amountUsd }));

  const required = input.limits.requiredByDefault || overLimit.length > 0;

  const reason = !required
    ? "Approval is not required for this intent."
    : overLimit.length > 0
      ? `${overLimit.length} leg${overLimit.length === 1 ? "" : "s"} exceed the agent's mandate of ` +
        `$${input.limits.maxSpendUsdPerIntent.toLocaleString("en-US")} for a single intent. ` +
        `The mandate is per intent, so it cannot be reached by splitting the trade.`
      : `Approval is required by default: an accountable principal authorises each intent before it ` +
        `executes. Requested $${requestedUsd.toLocaleString("en-US")} against a mandate of ` +
        `$${input.limits.maxSpendUsdPerIntent.toLocaleString("en-US")}.`;

  return {
    required,
    state: !required ? "not-required" : input.decidedBy === undefined ? "pending" : "approved",
    reason,
    requestedUsd,
    limitUsd: input.limits.maxSpendUsdPerIntent,
    overLimit,
  };
}

/** The limit for one agent, as stored. */
export interface AgentMandate {
  readonly maxSpendUsd: number;
  readonly approvalRequired: boolean;
}

/**
 * Where per-agent mandates come from.
 *
 * The durable home is `exec_agent_mandates` (see `@ethonline2026/timeseries`). This port exists so the
 * service does not depend on a database to decide whether to ask a question: a deployment with no
 * store wired resolves every agent to `null` and falls back to the environment, which is the behaviour
 * that existed before mandates were storable.
 *
 * `set` is optional because reading a mandate and writing one are different capabilities — a service
 * that only executes has no business changing a limit, and forcing it to implement `set` would mean
 * either a throw or a silent no-op.
 */
export interface MandateSource {
  get(userId: string, agent: string): Promise<AgentMandate | null>;
  set?(input: {
    readonly userId: string;
    readonly agent: string;
    readonly mandate: AgentMandate;
    readonly updatedBy: string;
  }): Promise<AgentMandate>;
}

/** No mandates are stored: every agent falls back to the deployment default. */
export const NO_MANDATES: MandateSource = {
  get: async () => null,
};

/**
 * Combine a stored mandate with the deployment default.
 *
 * The mandate wins where it exists, and the default fills the gap where it does not — so an agent
 * with no row behaves exactly as it did before mandates were storable, rather than inheriting some
 * other agent's limit.
 */
export function resolveLimits(fallback: ApprovalLimits, mandate: AgentMandate | null): ApprovalLimits {
  if (mandate === null) return fallback;
  return { requiredByDefault: mandate.approvalRequired, maxSpendUsdPerIntent: mandate.maxSpendUsd };
}
