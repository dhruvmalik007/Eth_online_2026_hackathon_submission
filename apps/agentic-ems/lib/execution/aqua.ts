/**
 * Client for the 1inch Aqua/SwapVM enablement assessment (`GET /aqua/enablement`).
 *
 * The shop window for this is `AquaFlightPanel`, which restates the assessment type rather than
 * importing it — so the mirror is defined here against the service's real response and passed
 * through whole. Nothing is derived, defaulted, or approximated on this side: the numbers a panel
 * renders must be the numbers the service measured, or the venue's whole argument is fiction.
 */

import { executionBaseUrl } from "./mandates";

/** Mirrors `AquaEnablementAssessment` from the ux-workflow panel, which mirrors the service. */
export interface AquaAssessment {
  readonly chain: string;
  readonly recommendation: "unavailable" | "enabled" | "not_worthwhile" | "recommend";
  /** Measured, and may be negative — a loss is a result, not an absence. */
  readonly efficiencyBps: number;
  readonly consentRequired: boolean;
  readonly consentGranter: "user" | "user-or-agent";
  readonly detail: string;
}

export interface AquaThresholds {
  readonly minEfficiencyBps: number;
  readonly agentEnablement: boolean;
  readonly agentMinEfficiencyBps: number;
}

export type AquaReadResult =
  | { readonly ok: true; readonly assessment: AquaAssessment; readonly thresholds: AquaThresholds; readonly chains: readonly string[] }
  /** The venue is switched off on this deployment — a configuration state, not a failure. */
  | { readonly ok: false; readonly kind: "off"; readonly detail: string }
  | { readonly ok: false; readonly kind: "unavailable"; readonly detail: string };

/** Chains this deployment can assess. `CHAIN_KEYS` upstream is the authority; these mirror it. */
export const AQUA_CHAINS = ["polygon", "optimism"] as const;

export async function fetchAquaEnablement(
  chain: string,
  options: { readonly baseUrl?: string | undefined; readonly userId?: string; readonly efficiencyBps?: number } = {},
): Promise<AquaReadResult> {
  const baseUrl = options.baseUrl ?? executionBaseUrl();
  if (baseUrl === undefined) {
    return {
      ok: false,
      kind: "unavailable",
      detail: "No execution service is configured (NEXT_PUBLIC_EXECUTION_URL), so no venue can be assessed.",
    };
  }

  const params = new URLSearchParams({ chain });
  // Required by the route: comparing two real routes needs a measurement this app cannot make, and
  // the service refuses to invent one. Omitting it is a real state, and the route says so.
  if (options.efficiencyBps !== undefined) params.set("efficiencyBps", String(options.efficiencyBps));

  try {
    const response = await fetch(`${baseUrl}/aqua/enablement?${params.toString()}`, {
      headers: {
        accept: "application/json",
        ...(options.userId === undefined ? {} : { "x-user-id": options.userId }),
      },
      cache: "no-store",
    });

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (response.status === 503) {
      const message = (body["error"] as { message?: string } | undefined)?.message;
      return { ok: false, kind: "off", detail: message ?? "The 1inch Aqua/SwapVM venue is off on this deployment." };
    }
    if (!response.ok) {
      const message = (body["error"] as { message?: string } | undefined)?.message;
      return { ok: false, kind: "unavailable", detail: message ?? `The venue assessment failed (HTTP ${response.status}).` };
    }

    const assessment = body["assessment"] as AquaAssessment | undefined;
    const thresholds = body["thresholds"] as AquaThresholds | undefined;
    if (assessment === undefined || thresholds === undefined) {
      return { ok: false, kind: "unavailable", detail: "The venue assessment came back without an assessment or thresholds." };
    }
    return {
      ok: true,
      assessment,
      thresholds,
      chains: Array.isArray(body["chains"]) ? (body["chains"] as string[]) : [],
    };
  } catch (error) {
    return { ok: false, kind: "unavailable", detail: (error as Error).message };
  }
}
