import { createHash } from 'node:crypto';
import type { SqlRunner } from '../src/runner.js';
import { EMBEDDING_DIMENSION, type EmbeddingService, type EmbeddingTask } from '../src/index.js';

export interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

type Rows = Record<string, unknown>[];
type Responder = (sql: string, values: readonly unknown[]) => Rows;

interface Route {
  readonly matches: (sql: string) => boolean;
  readonly respond: Responder;
}

/**
 * A `SqlRunner` that routes by SQL content. Migration and repository tests
 * register the statements they care about and assert on what was sent; the
 * routing (rather than a strict queue) means adding a query to a code path
 * does not silently shift every later assertion.
 */
export class RoutingFakeRunner implements SqlRunner {
  readonly queries: RecordedQuery[] = [];
  private readonly routes: Route[] = [];
  private fallback: Rows = [];

  /** Register a responder for SQL matching `pattern`. */
  on(pattern: RegExp | string, respond: Rows | Responder): this {
    const matches =
      typeof pattern === 'string'
        ? (sql: string): boolean => sql.includes(pattern)
        : (sql: string): boolean => pattern.test(sql);
    this.routes.push({
      matches,
      respond: typeof respond === 'function' ? respond : (): Rows => respond,
    });
    return this;
  }

  /** Rows returned when nothing matches (default: none). */
  otherwise(rows: Rows): this {
    this.fallback = rows;
    return this;
  }

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    this.queries.push({ text, values });
    for (const route of this.routes) {
      if (route.matches(text)) return { rows: route.respond(text, values) };
    }
    return { rows: this.fallback };
  }

  /**
   * The fake has no connections to scope, so the callback runs against this
   * same instance — statements inside a transaction are still recorded and
   * therefore remain assertable via `statements`.
   */
  async transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> {
    return fn(this);
  }

  /** Every statement sent, in order — for migration assertions. */
  get statements(): readonly string[] {
    return this.queries.map((q) => q.text);
  }

  find(fragment: string): RecordedQuery | undefined {
    return this.queries.find((q) => q.text.includes(fragment));
  }

  findAll(fragment: string): readonly RecordedQuery[] {
    return this.queries.filter((q) => q.text.includes(fragment));
  }
}

/** Deterministic, unit-norm pseudo-embedding derived from the text hash. */
export function deterministicVector(text: string, dimension = EMBEDDING_DIMENSION): number[] {
  const out: number[] = new Array<number>(dimension).fill(0);
  let block = 0;
  let digest = createHash('sha256').update(`${text}:${block}`).digest();
  for (let i = 0; i < dimension; i += 1) {
    if (i > 0 && i % digest.length === 0) {
      block += 1;
      digest = createHash('sha256').update(`${text}:${block}`).digest();
    }
    out[i] = (digest[i % digest.length]! / 255) * 2 - 1;
  }
  const norm = Math.sqrt(out.reduce((sum, v) => sum + v * v, 0)) || 1;
  return out.map((v) => v / norm);
}

export interface EmbedCall {
  readonly texts: readonly string[];
  readonly task: EmbeddingTask | undefined;
}

/** Offline `EmbeddingService` — no network, fully deterministic. */
export class FakeEmbeddingService implements EmbeddingService {
  readonly model = 'fake-embedding-005';
  readonly dimension = EMBEDDING_DIMENSION;
  readonly calls: EmbedCall[] = [];

  async embed(
    texts: readonly string[],
    options?: { readonly task?: EmbeddingTask },
  ): Promise<readonly (readonly number[])[]> {
    this.calls.push({ texts: [...texts], task: options?.task });
    return texts.map((t) => deterministicVector(t, this.dimension));
  }

  /** Total texts embedded across all calls. */
  get embeddedCount(): number {
    return this.calls.reduce((sum, c) => sum + c.texts.length, 0);
  }
}

export function isoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
