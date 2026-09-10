import type { DocumentNode } from 'graphql';
import { parse } from 'graphql';
import { z } from 'zod';
import type {
  AnyQueryDefinition,
  PaginationSpec,
  QueryDefinition,
} from '../query/QueryDefinition.js';
import { QueryDefinitionError } from '../query/QueryDefinition.js';
import type { RequestOptions } from './SubgraphTransport.js';
import {
  DEFAULT_HEALTH_TIMEOUT_MS,
  DEFAULT_QUERY_TIMEOUT_MS,
  SubgraphTransportError,
  type SubgraphTransport,
} from './SubgraphTransport.js';

export interface SubgraphHealth {
  readonly deployment: string;
  readonly blockNumber: number;
  readonly blockHash?: string | undefined;
  readonly blockTimestamp?: number | undefined;
  readonly hasIndexingErrors: boolean;
  readonly raw: {
    deployment?: string | undefined;
    hasIndexingErrors?: boolean | undefined;
    block?: { number?: number | undefined; hash?: string | undefined; timestamp?: number | undefined } | null | undefined;
  };
}

/** Typed error when a wire response fails its query's response schema. */
export class SubgraphValidationError extends Error {
  readonly queryId: string;
  readonly endpointName: string;
  readonly issues: readonly string[];

  constructor(queryId: string, endpointName: string, issues: readonly string[]) {
    super(
      `[${endpointName}] response for "${queryId}" failed schema validation:\n  - ${issues.join('\n  - ')}`,
    );
    this.name = 'SubgraphValidationError';
    this.queryId = queryId;
    this.endpointName = endpointName;
    this.issues = issues;
  }
}

/** Variables accepted by a definition: the *input* side of its zod schema. */
export type VarsOf<Q extends AnyQueryDefinition> = Q extends QueryDefinition<infer V, z.ZodType>
  ? z.input<V>
  : never;

/** Validated output produced by a definition: the *output* side of its zod schema. */
export type DataOf<Q extends AnyQueryDefinition> = Q extends QueryDefinition<z.ZodType, infer D>
  ? z.output<D>
  : never;

const documentCache = new Map<string, DocumentNode>();

function parsedDocument(def: AnyQueryDefinition): DocumentNode {
  const cached = documentCache.get(def.id);
  if (cached !== undefined) return cached;
  let doc: DocumentNode;
  try {
    doc = parse(def.sdl);
  } catch (err) {
    throw new QueryDefinitionError(`[${def.id}] SDL does not parse: ${(err as Error).message}`);
  }
  documentCache.set(def.id, doc);
  return doc;
}

type PrimitiveVar = string | number | boolean | null | undefined;

/**
 * Core typed transport to any Graph Node-compatible subgraph endpoint
 * (Studio dev URL, gateway network URL, or self-hosted graph-node).
 *
 * Ops principles encoded here:
 *  - every call is time-boxed (no unbounded awaits in the EMS poller path)
 *  - health is checkable independently of business queries
 *  - queries run exclusively through QueryDefinition templates: variables are
 *    validated before send, responses validated after receive
 *  - pagination uses id_gt cursors driven by the definition's PaginationSpec
 *    (never `skip`, which degrades linearly)
 */
export class SubgraphClient {
  constructor(
    private readonly transport: SubgraphTransport,
    private readonly name: string,
  ) {}

  get endpointName(): string {
    return this.name;
  }

  /**
   * Execute a query template:
   *  1. variables validated against the definition (fail fast before network),
   *  2. transport sends the parsed SDL document,
   *  3. response validated against the definition (fail loudly on drift).
   *
   * The two erased-generic casts below are the only ones in the client: they
   * sit exactly at the validation frontier this class owns.
   */
  async executeTemplate<Q extends AnyQueryDefinition>(
    query: Q,
    rawVars: VarsOf<Q>,
    opts: RequestOptions = {},
  ): Promise<DataOf<Q>> {
    const vars = query.variables.parse(rawVars);
    const signal = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS);
    const raw = await this.transport.requestRaw(
      parsedDocument(query),
      vars as Record<string, PrimitiveVar>,
      signal,
    );
    return this.validate(query, raw) as DataOf<Q>;
  }

  /**
   * Cursor-paginated collection fetch driven by the definition's PaginationSpec.
   * Mirrors SUBGRAPH_SPEC.md §7 anti-goals: `id_gt` cursor only, no offset/skip.
   *
   * Returns the definition's full response shape with the list at
   * `listPath` replaced by the concatenation of every page (other root
   * fields — aggregates, parent rows — come from the final page).
   */
  async collectAll<Q extends AnyQueryDefinition & { pagination: PaginationSpec }>(
    query: Q,
    options: {
      readonly pageSize?: number;
      readonly maxPages?: number;
      /** Non-pagination variables; cursor + pageSize args are injected from the spec. */
      readonly extraVars?: Partial<VarsOf<Q>>;
      readonly timeoutMs?: number;
    } = {},
  ): Promise<DataOf<Q>> {
    const spec = query.pagination;
    if (spec === undefined) {
      throw new QueryDefinitionError(`[${query.id}] collectAll requires a pagination spec`);
    }
    const pageSize = options.pageSize ?? 1000;
    const maxPages = options.maxPages ?? 100;
    if (maxPages < 1) {
      throw new QueryDefinitionError(`[${query.id}] collectAll maxPages must be >= 1`);
    }

    const all: unknown[] = [];
    let cursor: string | undefined;
    let lastValidated: DataOf<Q> | undefined;

    for (let page = 0; page < maxPages; page++) {
      const vars = {
        ...(options.extraVars as Record<string, unknown> | undefined),
        [spec.cursorArg]: cursor,
        [spec.pageSizeArg]: pageSize,
      } as VarsOf<Q>;
      const validated = await this.executeTemplate(query, vars, {
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      });
      lastValidated = validated;
      const items = pickList(validated, spec.listPath, query.id, this.name);
      if (items.length === 0) break;
      all.push(...items);
      if (items.length < pageSize) break;
      const nextCursor = lastItemId(items.at(-1));
      if (nextCursor === undefined) break;
      cursor = nextCursor;
    }

    // lastValidated is defined: the loop always runs >= 1 page (maxPages >= 1).
    const finalShape = { ...(lastValidated as unknown as Record<string, unknown>) };
    setAtPath(finalShape, spec.listPath, all);
    // Re-validate the reassembled shape so the returned data satisfies the
    // same schema as a single-page response (list replaced, nothing else moved).
    return this.validate(query, finalShape) as DataOf<Q>;
  }

  async health(opts: RequestOptions = {}): Promise<SubgraphHealth> {
    const signal = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS);
    const raw = await this.transport.requestRaw(HEALTH_DOCUMENT, {}, signal);
    const parsed = HealthResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new SubgraphTransportError(
        this.name,
        `unparseable _meta response: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        parsed.error,
      );
    }
    const meta = parsed.data._meta;
    if (meta === null || meta === undefined) {
      throw new SubgraphTransportError(this.name, 'subgraph returned null _meta (not indexed or wrong endpoint)', null);
    }
    return {
      deployment: meta.deployment ?? '',
      blockNumber: meta.block?.number ?? 0,
      blockHash: meta.block?.hash,
      blockTimestamp: meta.block?.timestamp,
      hasIndexingErrors: meta.hasIndexingErrors ?? false,
      raw: meta,
    };
  }

  /**
   * Raw escape hatch — returns unvalidated wire data. ONLY for ad-hoc SDL by
   * design (GraphQueryTool); all business queries must use executeTemplate.
   */
  async execute<TData = unknown>(
    document: DocumentNode,
    variables: Record<string, PrimitiveVar>,
    opts: RequestOptions = {},
  ): Promise<TData> {
    const signal = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS);
    return (await this.transport.requestRaw(document, variables, signal)) as TData;
  }

  /** Shared post-receive validation with a typed, aggregated error. */
  private validate(query: AnyQueryDefinition, raw: unknown): unknown {
    const parsed = query.response.safeParse(raw);
    if (!parsed.success) {
      throw new SubgraphValidationError(
        query.id,
        this.name,
        parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      );
    }
    return parsed.data;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const HEALTH_SDL = `
  query IndexerHealth {
    _meta {
      deployment
      hasIndexingErrors
      block {
        number
        hash
        timestamp
      }
    }
  }
`;

const HEALTH_DOCUMENT: DocumentNode = parse(HEALTH_SDL);

const HealthResponseSchema = z.object({
  _meta: z
    .object({
      deployment: z.string().optional(),
      hasIndexingErrors: z.boolean().optional(),
      block: z
        .object({
          number: z.number().optional(),
          hash: z.string().optional(),
          timestamp: z.number().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

function pickList(data: unknown, listPath: readonly string[], queryId: string, endpoint: string): readonly unknown[] {
  let node: unknown = data;
  for (const key of listPath) {
    if (node === null || node === undefined) return [];
    if (typeof node !== 'object') {
      throw new SubgraphValidationError(queryId, endpoint, [`${listPath.join('.')}: expected object at "${key}"`]);
    }
    node = (node as Record<string, unknown>)[key];
  }
  if (!Array.isArray(node)) {
    throw new SubgraphValidationError(queryId, endpoint, [`${listPath.join('.')}: expected a list`]);
  }
  return node;
}

/** Extract the `id` cursor from the last item when present and string-shaped. */
function lastItemId(last: unknown): string | undefined {
  if (typeof last !== 'object' || last === null) return undefined;
  const id = (last as Record<string, unknown>).id;
  if (typeof id !== 'string' || id.length === 0) return undefined;
  return id;
}

function setAtPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let node = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i] as string;
    const next = node[key];
    if (next === null || next === undefined || typeof next !== 'object' || Array.isArray(next)) {
      const fresh: Record<string, unknown> = {};
      node[key] = fresh;
      node = fresh;
    } else {
      node = next as Record<string, unknown>;
    }
  }
  node[path[path.length - 1] as string] = value;
}
