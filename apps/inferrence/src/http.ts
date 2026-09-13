/**
 * HTTP plumbing — the error envelope and request parsing.
 *
 * Intentionally the same shape as `apps/indexer` and `apps/execution`, so the
 * UI handles all three services with one client and one error branch, and the
 * inference-specific failure modes (a missing sandbox, an unavailable model, an
 * unavailable vector layer) surface as typed states rather than a blank pane.
 *
 * `ILLEGAL_TRANSITION` reuses the `ExecutionDomain` rule: a caller that asks to
 * move a run somewhere it cannot go made a client mistake, not a server one.
 */
import type { FastifyReply, FastifyRequest } from "fastify";

/** Stable machine-readable codes. The UI branches on these, never on message text. */
export const ERROR_CODES = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ILLEGAL_TRANSITION: 409,
  UPSTREAM_ERROR: 502,
  UNAVAILABLE: 503,
  SANDBOX_UNAVAILABLE: 503,
  MODEL_UNAVAILABLE: 503,
  DATABASE_UNAVAILABLE: 503,
  VECTOR_UNAVAILABLE: 503,
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

/** Raised by scaffolds that are deliberately not implemented yet; names the roadmap task. */
export class NotImplementedError extends HttpError {
  constructor(what: string, task: string) {
    super("UNAVAILABLE", `${what} is not implemented yet — see ROADMAP ${task}.`);
    this.name = "NotImplementedError";
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
  // The state machine's guard is a client mistake, so it is a 409, not a 500.
  if (error instanceof Error && /Illegal run transition/i.test(error.message)) {
    reply.code(ERROR_CODES.ILLEGAL_TRANSITION);
    return { error: { code: "ILLEGAL_TRANSITION", message: error.message } };
  }
  // Anything unexpected is logged server-side and scrubbed on the wire, so a raw
  // message can never leak SQL, a connection string or a key.
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
 * A seam, not an implementation: Privy token verification lands with the service
 * hardening work, and until then the only authenticator available trusts a
 * header — which is why {@link assertDeployable} refuses to let it run `live`.
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
 * Refuse to boot a configuration that would let the agent propose transactions
 * behind a spoofable identity.
 */
export function assertDeployable(mode: string, authenticator: Authenticator): void {
  if (mode === "live" && authenticator instanceof HeaderAuthenticator) {
    throw new Error(
      "Refusing to start in live mode with the development authenticator. " +
        "Wire Privy token verification (or another verifier) before proposing intents.",
    );
  }
}

/** A required string from a path/query/body object. */
export function requireString(source: Record<string, unknown>, key: string): string {
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
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw new HttpError("BAD_REQUEST", `\`${key}\` must be an integer between 0 and ${max}.`, {
      field: key,
    });
  }
  return parsed;
}

/** An optional boolean from a JSON body or a query string. */
export function optionalBool(
  source: Record<string, unknown>,
  key: string,
  fallback = false,
): boolean {
  const raw = source[key];
  if (raw === undefined) return fallback;
  if (typeof raw === "boolean") return raw;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new HttpError("BAD_REQUEST", `\`${key}\` must be a boolean.`, { field: key });
}

/** A bounded integer that must be present. */
export function requireInt(
  source: Record<string, unknown>,
  key: string,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const raw = source[key];
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (raw === undefined || !Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw new HttpError("BAD_REQUEST", `\`${key}\` is required and must be an integer.`, {
      field: key,
    });
  }
  return parsed;
}

/** A string list from a JSON array; tolerates a comma-separated string. */
export function stringList(source: Record<string, unknown>, key: string): string[] {
  const raw = source[key];
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  throw new HttpError("BAD_REQUEST", `\`${key}\` must be an array of strings.`, { field: key });
}
