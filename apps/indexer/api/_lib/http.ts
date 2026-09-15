import { timingSafeEqual } from "node:crypto";
import type { ZodType } from "zod";

/**
 * HTTP boundary helpers for the serverless routes.
 *
 * Every route answers with a predictable envelope and a typed error code, so
 * the frontend can render a specific state instead of a blank page. Nothing
 * here reaches into the database or the models — it is pure translation
 * between HTTP and the typed handlers.
 */

// The contract lives in its own module, with no imports, so a consumer that compiles under a
// different platform's types can name these codes without pulling this file — and Node's
// `Request`/`Response` — into its program. Re-exported here because this is where callers reach for
// it, and a code is only meaningful next to `HttpError`.
import { statusForCode, type ErrorCode } from "./errorCodes.js";

export { ERROR_CODES, statusForCode, type ErrorCode } from "./errorCodes.js";

/**
 * An error that is safe to show a caller. Anything else is reported as a
 * generic INTERNAL_ERROR with the detail kept server-side, so an unexpected
 * failure cannot leak SQL or credentials to the browser.
 */
export class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: readonly string[],
  ) {
    super(message);
    this.name = "HttpError";
  }

  get status(): number {
    return statusForCode(this.code);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // The data is time-sensitive and per-request; never let a CDN or browser
      // serve a stale forecast or decision.
      "cache-control": "no-store",
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined
            ? {}
            : { details: [...error.details] }),
        },
      },
      error.status,
    );
  }

  // Unexpected: log the real cause server-side, return something generic.
  const message = error instanceof Error ? error.message : String(error);
  console.error("[indexer] unhandled error:", message);
  return json(
    { error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } },
    500,
  );
}

/** Read a query parameter, requiring a non-empty value when `required`. */
export function stringParam(
  params: URLSearchParams,
  name: string,
  options: { readonly required?: boolean } = {},
): string | undefined {
  const raw = params.get(name);
  if (raw === null || raw.trim().length === 0) {
    if (options.required === true) {
      throw new HttpError(
        "BAD_REQUEST",
        `Query parameter '${name}' is required.`,
      );
    }
    return undefined;
  }
  return raw.trim();
}

/** Read a numeric query parameter against explicit bounds. */
export function numberParam(
  params: URLSearchParams,
  name: string,
  options: {
    readonly min?: number;
    readonly max?: number;
    readonly fallback?: number;
  } = {},
): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw.trim().length === 0) return options.fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new HttpError(
      "BAD_REQUEST",
      `Query parameter '${name}' must be a number.`,
    );
  }
  if (options.min !== undefined && value < options.min) {
    throw new HttpError(
      "BAD_REQUEST",
      `Query parameter '${name}' must be >= ${options.min}.`,
    );
  }
  if (options.max !== undefined && value > options.max) {
    throw new HttpError(
      "BAD_REQUEST",
      `Query parameter '${name}' must be <= ${options.max}.`,
    );
  }
  return value;
}

/** Parse the request body against a schema, reporting issues as 400s. */
export async function readBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    throw new HttpError("BAD_REQUEST", "Request body could not be read.");
  }
  if (raw.trim().length === 0) {
    throw new HttpError("BAD_REQUEST", "Request body is required.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError("BAD_REQUEST", "Request body must be valid JSON.");
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new HttpError(
      "BAD_REQUEST",
      `Request body failed validation: ${result.error.issues[0]?.message ?? "unknown"}`,
      result.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
      ),
    );
  }
  return result.data;
}

/**
 * Require a bearer token, compared in constant time.
 *
 * For the one route called by a machine rather than a browser. A plain `===` on a secret leaks its
 * length and prefix through timing; that is a slow attack, but this is a free way to not have it.
 *
 * The three outcomes are deliberately distinct, because they need different actions: an unset secret
 * is an operator mistake (500, and it names the variable), a missing token is a caller mistake (401),
 * and a wrong token is a rejected attempt (401).
 */
export function requireBearer(
  request: Request,
  expected: string | undefined,
  context: string,
): void {
  if (expected === undefined || expected.trim().length === 0) {
    // Failing open here would turn this into an unauthenticated trigger, so it fails closed.
    throw new HttpError(
      "INTERNAL_ERROR",
      `${context} is not configured: set CRON_SECRET.`,
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : "";
  if (presented.length === 0) {
    throw new HttpError("UNAUTHORIZED", `${context} requires a bearer token.`);
  }

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // `timingSafeEqual` throws on a length mismatch, so length is compared first. That leaks the
  // secret's length and nothing else — which is why the comparison is not merely `a.equals(b)`.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpError(
      "UNAUTHORIZED",
      `${context} rejected the presented token.`,
    );
  }
}

/**
 * Map a failure from a dependency onto an HTTP error. Recognises the typed
 * errors our packages raise so the frontend gets a meaningful code.
 */
export function toHttpError(error: unknown, context: string): HttpError {
  if (error instanceof HttpError) return error;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);

  if (name === "VectorUnavailableError" || /vector|pgvector/i.test(message)) {
    return new HttpError("VECTOR_UNAVAILABLE", message);
  }
  if (
    name === "TimeseriesRunnerError" ||
    /TimescaleDB query failed/i.test(message)
  ) {
    return new HttpError(
      "DATABASE_UNAVAILABLE",
      `TimescaleDB unavailable: ${message}`,
    );
  }
  if (name === "TimesFM3HttpError" || /timesfm3/i.test(message)) {
    return new HttpError(
      "MODEL_UNAVAILABLE",
      `TimesFM-3 unavailable: ${message}`,
    );
  }
  /**
   * A schema rejection from inside the pipeline.
   *
   * Without this branch the fallback below splices `error.message` into the body — and for a
   * ZodError that message *is* the JSON-stringified issue list. The caller then gets a wall of
   * validation internals while the headline says only "an upstream dependency failed", which names
   * neither the cause nor anything they could do. The issues are worth a log and useless to the
   * browser, so they stay server-side and the summary says what actually happened.
   */
  if (name === "ZodError") {
    return new HttpError(
      "UPSTREAM_ERROR",
      `${context} produced a payload that failed its own validation. This is a fault in this deployment, not something your request caused.`,
    );
  }
  return new HttpError("UPSTREAM_ERROR", `${context} failed: ${message}`);
}
