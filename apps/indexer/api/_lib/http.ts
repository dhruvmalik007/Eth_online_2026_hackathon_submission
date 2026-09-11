import type { ZodType } from 'zod';

/**
 * HTTP boundary helpers for the serverless routes.
 *
 * Every route answers with a predictable envelope and a typed error code, so
 * the frontend can render a specific state instead of a blank page. Nothing
 * here reaches into the database or the models — it is pure translation
 * between HTTP and the typed handlers.
 */

export const ERROR_CODES = [
  'BAD_REQUEST',
  'NOT_FOUND',
  'VECTOR_UNAVAILABLE',
  'RISK_UNAVAILABLE',
  'DATABASE_UNAVAILABLE',
  'MODEL_UNAVAILABLE',
  'UPSTREAM_ERROR',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  BAD_REQUEST: 400,
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
    this.name = 'HttpError';
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // The data is time-sensitive and per-request; never let a CDN or browser
      // serve a stale forecast or decision.
      'cache-control': 'no-store',
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
          ...(error.details === undefined ? {} : { details: [...error.details] }),
        },
      },
      error.status,
    );
  }

  // Unexpected: log the real cause server-side, return something generic.
  const message = error instanceof Error ? error.message : String(error);
  console.error('[indexer] unhandled error:', message);
  return json(
    { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } },
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
      throw new HttpError('BAD_REQUEST', `Query parameter '${name}' is required.`);
    }
    return undefined;
  }
  return raw.trim();
}

/** Read a numeric query parameter against explicit bounds. */
export function numberParam(
  params: URLSearchParams,
  name: string,
  options: { readonly min?: number; readonly max?: number; readonly fallback?: number } = {},
): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw.trim().length === 0) return options.fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new HttpError('BAD_REQUEST', `Query parameter '${name}' must be a number.`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new HttpError('BAD_REQUEST', `Query parameter '${name}' must be >= ${options.min}.`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new HttpError('BAD_REQUEST', `Query parameter '${name}' must be <= ${options.max}.`);
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
    throw new HttpError('BAD_REQUEST', 'Request body could not be read.');
  }
  if (raw.trim().length === 0) {
    throw new HttpError('BAD_REQUEST', 'Request body is required.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError('BAD_REQUEST', 'Request body must be valid JSON.');
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new HttpError(
      'BAD_REQUEST',
      `Request body failed validation: ${result.error.issues[0]?.message ?? 'unknown'}`,
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}

/**
 * Map a failure from a dependency onto an HTTP error. Recognises the typed
 * errors our packages raise so the frontend gets a meaningful code.
 */
export function toHttpError(error: unknown, context: string): HttpError {
  if (error instanceof HttpError) return error;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);

  if (name === 'VectorUnavailableError' || /vector|pgvector/i.test(message)) {
    return new HttpError('VECTOR_UNAVAILABLE', message);
  }
  if (name === 'TimeseriesRunnerError' || /TimescaleDB query failed/i.test(message)) {
    return new HttpError('DATABASE_UNAVAILABLE', `TimescaleDB unavailable: ${message}`);
  }
  if (name === 'TimesFM3HttpError' || /timesfm3/i.test(message)) {
    return new HttpError('MODEL_UNAVAILABLE', `TimesFM-3 unavailable: ${message}`);
  }
  return new HttpError('UPSTREAM_ERROR', `${context} failed: ${message}`);
}
