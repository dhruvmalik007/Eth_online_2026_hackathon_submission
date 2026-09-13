/**
 * HTTP plumbing — the error envelope and request parsing.
 *
 * Intentionally identical in shape to `apps/indexer`'s, so the dashboard handles
 * both services with one client and one error branch. Two services with two error
 * shapes is two bugs waiting to happen in the UI.
 */
import type { FastifyReply, FastifyRequest } from "fastify";

/** Stable machine-readable codes. The UI branches on these, never on message text. */
export const ERROR_CODES = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ILLEGAL_TRANSITION: 409,
  UNAVAILABLE: 503,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** A failure with a code the client can branch on. */
export class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Translate any thrown value into the wire envelope. */
export function toErrorResponse(
  error: unknown,
  reply: FastifyReply,
): { error: { code: ErrorCode; message: string; details?: Record<string, unknown> } } {
  if (error instanceof HttpError) {
    reply.code(ERROR_CODES[error.code]);
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
  }
  // An `IllegalTransitionError` from the state machine is a client mistake — the
  // caller asked to move a run somewhere it cannot go — so it is a 409, not a 500.
  if (error instanceof Error && /Illegal run transition/i.test(error.message)) {
    reply.code(ERROR_CODES.ILLEGAL_TRANSITION);
    return { error: { code: "ILLEGAL_TRANSITION", message: error.message } };
  }
  reply.code(ERROR_CODES.INTERNAL);
  return {
    error: {
      code: "INTERNAL",
      message: "Unexpected error. The operation was not applied.",
    },
  };
}

/**
 * Resolve the caller's identity.
 *
 * A seam, not an implementation: Privy token verification lands in Phase 4, and
 * until then the only authenticator available trusts a header — which is why
 * {@link assertDeployable} refuses to let it run in `live` mode.
 */
export interface Authenticator {
  authenticate(request: FastifyRequest): Promise<string>;
}

/** Development-only: trusts `x-user-id`. Refuses to run in `live` mode. */
export class HeaderAuthenticator implements Authenticator {
  async authenticate(request: FastifyRequest): Promise<string> {
    const header = request.headers["x-user-id"];
    const userId = Array.isArray(header) ? header[0] : header;
    if (userId === undefined || userId.length === 0) {
      throw new HttpError("UNAUTHORIZED", "Missing x-user-id (development authenticator).");
    }
    return userId;
  }
}

/**
 * Refuse to boot a configuration that would move funds behind a dev authenticator.
 *
 * A service that can sign and broadcast must not accept a spoofable identity, so
 * this fails at startup rather than on the first request that matters.
 */
export function assertDeployable(mode: string, authenticator: Authenticator): void {
  if (mode === "live" && authenticator instanceof HeaderAuthenticator) {
    throw new Error(
      "Refusing to start in live mode with the development authenticator. " +
        "Wire Privy token verification before broadcasting.",
    );
  }
}

/** A required string from a path/query/body object. */
export function requireString(
  source: Record<string, unknown>,
  key: string,
): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError("BAD_REQUEST", `\`${key}\` is required and must be a non-empty string.`, {
      field: key,
    });
  }
  return value;
}

/** An optional string. */
export function optionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** An optional bounded integer, with a default. */
export function optionalInt(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
  max = 200,
): number {
  const raw = source[key];
  if (raw === undefined) return fallback;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new HttpError("BAD_REQUEST", `\`${key}\` must be an integer between 1 and ${max}.`, {
      field: key,
    });
  }
  return parsed;
}

/** Parse an RFC3339 timestamp, or fail with a field-specific message. */
export function optionalDate(source: Record<string, unknown>, key: string): Date | undefined {
  const raw = optionalString(source, key);
  if (raw === undefined) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError("BAD_REQUEST", `\`${key}\` must be an RFC3339 timestamp.`, { field: key });
  }
  return parsed;
}
