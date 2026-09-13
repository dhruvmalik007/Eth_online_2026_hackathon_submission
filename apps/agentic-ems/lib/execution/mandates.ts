/**
 * Agent spend mandates, on the app side.
 *
 * ## Two homes, on purpose
 *
 * The durable home is `exec_agent_mandates` in Postgres, reached through the execution service's
 * `/mandates/:agent` routes — that is what enforces the limit, and it is the only copy that matters.
 * The demo desk keeps a copy in its own state so the setting is visible and editable without a service
 * running, because the desk is designed to work standalone for screenshots.
 *
 * The two are kept distinct rather than merged: a demo copy that silently stood in for the enforced
 * one would let the settings screen show a limit that nothing applies.
 *
 * ## Why the default is approval-required
 *
 * An agent with no mandate must not be the *permissive* case. The default here matches the service's
 * `APPROVAL_REQUIRED_BY_DEFAULT`, so a desk with nothing configured asks rather than spends — and a
 * refusal to spend is recoverable in a way that a permitted spend is not.
 */

export interface AgentMandate {
  /** The most this agent may commit in one intent, in whole USD. */
  readonly maxSpendUsd: number;
  /** Whether an operator must approve each intent regardless of size. */
  readonly approvalRequired: boolean;
}

/**
 * The mandate an agent has when none was set.
 *
 * Mirrors the execution service's default so the desk and the service agree — a mismatch would show one
 * limit in settings and enforce another.
 */
export const DEFAULT_AGENT_MANDATE: AgentMandate = {
  maxSpendUsd: 250_000,
  approvalRequired: true,
};

/** The agent id the desk's strategies run under. */
export const DEFAULT_AGENT_ID = "v01";

/**
 * Resolve an agent's mandate from the desk's copy, falling back to the default.
 *
 * A missing entry yields the default rather than a zero or an "unlimited": both of those would let a
 * spend through that nobody chose.
 */
export function mandateFor(
  mandates: Readonly<Record<string, AgentMandate>> | undefined,
  agent: string = DEFAULT_AGENT_ID,
): AgentMandate {
  return mandates?.[agent] ?? DEFAULT_AGENT_MANDATE;
}

/** Where the execution service lives, or `undefined` when the desk is running standalone. */
export function executionBaseUrl(
  // The literal member access is load-bearing: Next.js inlines a statically-referenced
  // `process.env.NEXT_PUBLIC_*` into the client bundle, but a dynamic `env[name]` lookup on
  // `process.env` is invisible to that analysis. Reading it dynamically meant the browser saw
  // `undefined` and the settings screen reported no execution service however the project was
  // configured. The parameter is kept so tests can still inject their own env.
  env: Record<string, string | undefined> = {
    NEXT_PUBLIC_EXECUTION_URL: process.env.NEXT_PUBLIC_EXECUTION_URL,
  },
): string | undefined {
  const url = env["NEXT_PUBLIC_EXECUTION_URL"]?.trim();
  return url !== undefined && url.length > 0 ? url.replace(/\/+$/, "") : undefined;
}

export interface MandateReadResult {
  readonly ok: boolean;
  readonly agent: string;
  readonly effective: AgentMandate;
  readonly stored: AgentMandate | null;
  /** Which copy answered: the service, or the desk's own state. */
  readonly source: "execution service" | "desk default";
  readonly detail?: string;
}

/**
 * Read the mandate the service will enforce.
 *
 * A service that cannot be reached reports `desk default` rather than failing: the settings screen
 * still needs to render, and the `source` field is what stops the fallback being mistaken for the
 * enforced value.
 */
export async function fetchMandate(
  agent: string = DEFAULT_AGENT_ID,
  options: { readonly baseUrl?: string | undefined; readonly userId?: string } = {},
): Promise<MandateReadResult> {
  const baseUrl = options.baseUrl ?? executionBaseUrl();
  if (baseUrl === undefined) {
    return {
      ok: false,
      agent,
      effective: DEFAULT_AGENT_MANDATE,
      stored: null,
      source: "desk default",
      detail: "No execution service is configured (NEXT_PUBLIC_EXECUTION_URL), so nothing is enforced here.",
    };
  }

  try {
    const response = await fetch(`${baseUrl}/mandates/${encodeURIComponent(agent)}`, {
      headers: options.userId === undefined ? {} : { "x-user-id": options.userId },
    });
    if (!response.ok) {
      return {
        ok: false,
        agent,
        effective: DEFAULT_AGENT_MANDATE,
        stored: null,
        source: "desk default",
        detail: `The execution service refused the read (${response.status}).`,
      };
    }
    const payload = (await response.json()) as {
      effective: AgentMandate;
      stored: AgentMandate | null;
      source: string;
    };
    return {
      ok: true,
      agent,
      effective: payload.effective,
      stored: payload.stored,
      source: "execution service",
      detail: payload.source,
    };
  } catch (error) {
    return {
      ok: false,
      agent,
      effective: DEFAULT_AGENT_MANDATE,
      stored: null,
      source: "desk default",
      detail: `Could not reach the execution service: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Save a mandate where it is enforced.
 *
 * Returns the reason rather than throwing, so a settings form can render a rejection inline. Validation
 * is repeated here as well as on the service because a form that only learns a limit is invalid after a
 * round trip has already let the operator believe it was saved.
 */
export async function saveMandate(
  agent: string,
  mandate: AgentMandate,
  options: { readonly baseUrl?: string | undefined; readonly userId?: string } = {},
): Promise<{ readonly ok: boolean; readonly detail: string }> {
  if (!Number.isFinite(mandate.maxSpendUsd) || mandate.maxSpendUsd <= 0) {
    return { ok: false, detail: "The maximum spend must be a positive amount." };
  }

  const baseUrl = options.baseUrl ?? executionBaseUrl();
  if (baseUrl === undefined) {
    return {
      ok: false,
      detail: "No execution service is configured, so the limit could not be stored. It is set for this session only.",
    };
  }

  try {
    const response = await fetch(`${baseUrl}/mandates/${encodeURIComponent(agent)}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(options.userId === undefined ? {} : { "x-user-id": options.userId }),
      },
      body: JSON.stringify(mandate),
    });
    if (!response.ok) {
      const body = await response.text();
      return { ok: false, detail: `The execution service refused the save (${response.status}): ${body}` };
    }
    return { ok: true, detail: "Stored." };
  } catch (error) {
    return {
      ok: false,
      detail: `Could not reach the execution service: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
