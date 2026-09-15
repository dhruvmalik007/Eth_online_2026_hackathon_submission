import type { ErrorCode } from "../../api/_lib/errorCodes.js";
import type { RunEvent } from "./machine.js";

/**
 * Turning a response into a state.
 *
 * This is where the console stops treating every non-200 as a crash. `RISK_UNAVAILABLE` is not a
 * failure — it is a fact about this deployment, and the reader's next action is to configure
 * something rather than to retry. `UPSTREAM_ERROR` is the opposite: nothing about the request was
 * wrong, so retrying is reasonable. Collapsing the two into "error" is what made three routes look
 * broken when the truth was one missing bucket.
 *
 * `ErrorCode` is imported from the API rather than restated, because a second copy of a contract is
 * a copy that will be wrong. Imported from `errorCodes` rather than `http` for the same reason the
 * contract was split out: `http` is Node-typed, this file compiles against the DOM, and one program
 * cannot hold both without one of them losing its `Request`.
 */

export interface Classified {
  /** The event the machine takes. */
  readonly event: RunEvent;
  readonly code: ErrorCode | null;
  /** 0 when no response arrived at all. */
  readonly status: number;
  /** What happened, in one sentence, for the entry card. */
  readonly summary: string;
  /** The raw text behind the summary, when there was any worth keeping. */
  readonly detail?: string;
  /** What would fix it, when the fix is configuration rather than a retry. */
  readonly remedy?: string;
}

/**
 * What each unavailable dependency would need, keyed by the code the API returns.
 *
 * A record rather than a switch so the mapping and the contract can be compared: a code that gains a
 * remedy here and not in `http.ts` is a code nobody handles, and this file is the only place that
 * decides which codes mean "unavailable" rather than "broken".
 */
const REMEDY: Partial<Record<ErrorCode, string>> = {
  RISK_UNAVAILABLE:
    "The risk snapshot store is not configured on this deployment. Set RISK_GCS_BUCKET to the pipeline's output bucket, then run the refresh job.",
  VECTOR_UNAVAILABLE:
    "No embedding project is configured, so there is nothing to search. Set GOOGLE_CLOUD_PROJECT and index a pool.",
  DATABASE_UNAVAILABLE:
    "The database is unreachable, or it is missing a table this route reads.",
  MODEL_UNAVAILABLE:
    "The forecasting service did not answer. It scales to zero, so the first call after an idle period can exceed the probe's budget.",
};

/** Codes that mean "this dependency is absent", not "the system broke". */
export function isUnavailable(code: ErrorCode | null, status: number): boolean {
  return (code !== null && REMEDY[code] !== undefined) || status === 503;
}

export function remedyFor(code: ErrorCode | null): string | undefined {
  return code === null ? undefined : REMEDY[code];
}

/**
 * A payload that arrived, but says it is thin.
 *
 * The read routes report this in their own bodies rather than as an error — `empty` when nothing is
 * stored, `degraded` when a dependency the answer depends on is down, `failures` when a cache
 * refresh could not reach something. A 200 that says "nothing here" is a different state from a 200
 * that says "here it is", and rendering them identically is how an empty deployment looks healthy.
 */
function thinness(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;

  if (record["empty"] === true)
    return "this deployment holds nothing for it yet";

  const degraded = record["degraded"];
  if (Array.isArray(degraded) && degraded.length > 0) {
    return `degraded: ${degraded.map(String).join(", ")}`;
  }

  const failures = record["failures"];
  if (Array.isArray(failures) && failures.length > 0) {
    const n = failures.length;
    return `${n} cached ${n === 1 ? "entry" : "entries"} could not be refreshed`;
  }

  return null;
}

export function classifyOk(payload: unknown): Classified {
  const thin = thinness(payload);
  if (thin !== null) {
    return {
      event: "settle-partial",
      code: null,
      status: 200,
      summary: `The request succeeded, and ${thin}.`,
    };
  }
  return { event: "settle-ok", code: null, status: 200, summary: "Complete." };
}

export function classifyFailure(
  status: number,
  code: ErrorCode | null,
  message: string,
): Classified {
  if (isUnavailable(code, status)) {
    const remedy = remedyFor(code);
    return {
      event: "settle-unavailable",
      code,
      status,
      summary:
        message.length > 0
          ? message
          : "A dependency this command needs is not available here.",
      ...(remedy === undefined ? {} : { remedy }),
    };
  }

  if (status === 400 || status === 401 || status === 404) {
    return {
      event: "settle-refused",
      code,
      status,
      summary:
        message.length > 0
          ? message
          : "This request was rejected before it ran.",
    };
  }

  // A transport failure has no HTTP answer to quote, and an exception's own text — `fetch failed`,
  // `NetworkError when attempting to fetch resource` — is the runtime talking about itself rather
  // than a description of what the reader now knows. It is kept, one line down, and is not the
  // headline.
  if (status === 0) {
    return {
      event: "settle-failed",
      code,
      status,
      summary: "The request never reached the deployment, so nothing was run.",
      ...(message.length === 0 ? {} : { detail: message }),
    };
  }

  return {
    event: "settle-failed",
    code,
    status,
    summary:
      message.length > 0 ? message : `The deployment answered ${status}.`,
  };
}

/** The code from an error envelope, checked against the contract rather than trusted. */
const KNOWN_CODES: readonly string[] = [
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "VECTOR_UNAVAILABLE",
  "RISK_UNAVAILABLE",
  "DATABASE_UNAVAILABLE",
  "MODEL_UNAVAILABLE",
  "UPSTREAM_ERROR",
  "INTERNAL_ERROR",
];

export interface ErrorEnvelope {
  readonly code: ErrorCode | null;
  readonly message: string;
}

/**
 * The known code, or null.
 *
 * Exists so a caller holding an arbitrary string never has to cast into the union. `ApiCallError`
 * carries a plain string — a transport can produce codes the contract does not define — and a cast
 * would let an unknown code reach the remedy table and be reported as one of ours.
 */
export function codeOf(value: unknown): ErrorCode | null {
  return typeof value === "string" && KNOWN_CODES.includes(value)
    ? (value as ErrorCode)
    : null;
}

/**
 * Read `{ error: { code, message } }` without trusting its shape.
 *
 * A proxy, an SSO redirect or a platform error page can all answer with JSON that is not this
 * envelope. Returning nulls keeps that from being mistaken for a typed error, which would put a
 * confident wrong sentence in front of the reader.
 */
export function readErrorEnvelope(payload: unknown): ErrorEnvelope {
  if (typeof payload !== "object" || payload === null)
    return { code: null, message: "" };
  const error = (payload as Record<string, unknown>)["error"];
  if (typeof error !== "object" || error === null)
    return { code: null, message: "" };
  const record = error as Record<string, unknown>;
  const code = codeOf(record["code"]);
  const message =
    typeof record["message"] === "string" ? record["message"] : "";
  return { code, message };
}
