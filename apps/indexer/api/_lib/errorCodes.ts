/**
 * The error contract, alone.
 *
 * Split out of `http.ts` so a consumer with a different compiler configuration can name these codes
 * without dragging the API into its program. `http.ts` imports `node:crypto` and its signatures are
 * written against Node's `Request` and `Response`; the console compiles with the DOM library, and a
 * single program holding both resolves those two globals to whichever declaration wins. That is not
 * a hypothetical: it typechecked here and failed on the build machine, because the winner depends on
 * module resolution order.
 *
 * Nothing in this file imports anything. That is the point — it is the one module both sides can
 * share without sharing a view of the platform.
 */

export const ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "VECTOR_UNAVAILABLE",
  "RISK_UNAVAILABLE",
  "DATABASE_UNAVAILABLE",
  "MODEL_UNAVAILABLE",
  "UPSTREAM_ERROR",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  BAD_REQUEST: 400,
  // Only the refresh probe returns this, and only a machine ever calls it. Distinct from
  // BAD_REQUEST because the remedy is different: a bad request means fix the call, this means the
  // caller is not allowed to make it at all.
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  VECTOR_UNAVAILABLE: 503,
  // Distinct from VECTOR_UNAVAILABLE because the remedy differs: one needs a
  // Vertex project, the other a risk snapshot store.
  RISK_UNAVAILABLE: 503,
  DATABASE_UNAVAILABLE: 503,
  MODEL_UNAVAILABLE: 503,
  UPSTREAM_ERROR: 502,
  INTERNAL_ERROR: 500,
};

/** The status a code is answered with. */
export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}
