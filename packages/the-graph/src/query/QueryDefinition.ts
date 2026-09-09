import type { z } from 'zod';
import { parse } from 'graphql';

/**
 * Query templates — the single source of truth for every GraphQL query in the
 * package. A QueryDefinition couples:
 *  - the parameterized SDL (variables only — value interpolation is banned),
 *  - a zod schema validating request variables *before* the network call,
 *  - a zod schema validating the wire response *after* it arrives,
 *  - an optional pagination spec driving cursor-based `collectAll`.
 *
 * Subgraph responses are untrusted wire data. Schema drift on a deployment
 * must fail loudly at the validation boundary (SubgraphValidationError), never
 * silently surface `undefined` into a risk report.
 */

/** Cursor-pagination spec. `id_gt` cursors only (SUBGRAPH_SPEC.md §7). */
export interface PaginationSpec {
  /** Path from the response root to the paginated list, e.g. `['positions']`. */
  readonly listPath: readonly string[];
  /** Name of the cursor variable, e.g. `'lastID'`. */
  readonly cursorArg: string;
  /** Name of the page-size variable, e.g. `'first'`. */
  readonly pageSizeArg: string;
}

/**
 * Structural contract every query definition satisfies. The generic
 * `QueryDefinition<TVars, TData>` binds concrete zod schemas; this erased
 * form lets registries and the client store heterogeneous definitions.
 */
export interface AnyQueryDefinition {
  readonly id: string;
  readonly operationName: string;
  readonly sdl: string;
  readonly variables: z.ZodType;
  readonly response: z.ZodType;
  readonly pagination?: PaginationSpec | undefined;
}

export interface QueryDefinition<TVars extends z.ZodType, TData extends z.ZodType> {
  readonly id: string;
  readonly operationName: string;
  readonly sdl: string;
  readonly variables: TVars;
  readonly response: TData;
  readonly pagination?: PaginationSpec | undefined;
}

/**
 * What `defineQuery` returns: the input definition type itself, so a literal
 * that *includes* `pagination` keeps `{ pagination: PaginationSpec }` (needed
 * by `collectAll`'s constraint) while one without it stays optional.
 */
export type DefinedQuery<TDef extends AnyQueryDefinition> = TDef;

/**
 * Identity + inference anchor. Accepts only structurally valid definitions;
 * the SDL parse in `validateDefinition` runs at construction sites so a
 * malformed template fails at module load, not on first network call.
 */
export function defineQuery<TDef extends AnyQueryDefinition>(def: TDef): DefinedQuery<TDef> {
  validateDefinition(def);
  return def;
}

/** Cast a structurally-valid definition to the erased form for registries. */
export function toAnyQueryDefinition(def: QueryDefinition<z.ZodType, z.ZodType>): AnyQueryDefinition {
  return def;
}

export class QueryDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryDefinitionError';
  }
}

/** Fail-fast structural checks: parseable SDL, no interpolated values. */
export function validateDefinition(def: AnyQueryDefinition): void {
  if (def.id.trim().length === 0) {
    throw new QueryDefinitionError('query definition id must be non-empty');
  }
  if (def.operationName.trim().length === 0) {
    throw new QueryDefinitionError(`[${def.id}] operationName must be non-empty`);
  }
  let document: ReturnType<typeof parse>;
  try {
    document = parse(def.sdl);
    // check (validation) of the document happens via graphql-js assert rules:
    // parse-only here; semantic validation via the transport's first request.
  } catch (err) {
    throw new QueryDefinitionError(`[${def.id}] SDL does not parse: ${(err as Error).message}`);
  }
  const def0 = document.definitions.at(0);
  if (def0?.kind !== KindOperationDefinition) {
    throw new QueryDefinitionError(`[${def.id}] SDL must contain exactly one anonymous-root operation named "${def.operationName}"`);
  }
  const opName = def0.name?.value;
  if (opName !== def.operationName) {
    throw new QueryDefinitionError(`[${def.id}] SDL operation name "${opName ?? '(anonymous)'}" does not match operationName "${def.operationName}"`);
  }

  // Value interpolation ban: every GraphQL variable referenced in the SDL must
  // be declared; any `${` inside the SDL means a value was interpolated into
  // the template instead of passed as a variable (injection-prone,
  // uncacheable). Templates carry placeholders, never values.
  if (def.sdl.includes('${')) {
    throw new QueryDefinitionError(`[${def.id}] SDL contains "\${" — value interpolation is banned; declare a GraphQL variable instead`);
  }

  // Every variable the SDL declares must be produced by the variables schema.
  // We cannot execute the schema here, but we check the declared names against
  // the zod shape keys when the schema is an object schema.
  const declared = varNames(document);
  const shape = varShapeKeys(def.variables);
  if (shape !== null) {
    for (const name of declared) {
      if (!shape.has(name)) {
        throw new EveryVariableDeclaredError(def.id, name, shape);
      }
    }
  }
}

export class EveryVariableDeclaredError extends QueryDefinitionError {
  constructor(id: string, variableName: string, schemaKeys: Set<string>) {
    super(`[${id}] SDL declares variable "$${variableName}" but the variables schema has no key for it. Known keys: ${[...schemaKeys].sort().join(', ') || '(none)'}`);
  }
}

const KindOperationDefinition = 'OperationDefinition' as const;

function varNames(document: ReturnType<typeof parse>): Set<string> {
  const names = new Set<string>();
  const def0 = document.definitions.at(0);
  if (def0?.kind !== KindOperationDefinition) return names;
  for (const v of def0.variableDefinitions ?? []) {
    names.add(v.variable.name.value);
  }
  usedVariableNames(document, names);
  return names;
}

/** Walk the selection set collecting referenced variables ($name). */
function usedVariableNames(document: ReturnType<typeof parse>, into: Set<string>): void {
  const def0 = document.definitions.at(0);
  if (def0?.kind !== KindOperationDefinition) return;
  visitAst(def0.selectionSet, into);
}

/** Depth-first walk over AST nodes, ignoring `loc` (which back-references the AST cyclically). */
function visitAst(node: unknown, into: Set<string>): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) visitAst(child, into);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (rec.kind === 'Variable' && rec.name !== null && typeof rec.name === 'object') {
    const n = (rec.name as { value?: unknown }).value;
    if (typeof n === 'string') into.add(n);
  }
  for (const [key, value] of Object.entries(rec)) {
    if (key === 'loc') continue;
    visitAst(value, into);
  }
}

function varShapeKeys(schema: z.ZodType): Set<string> | null {
  const shape = (schema as { shape?: unknown }).shape;
  if (shape === null || shape === undefined || typeof shape !== 'object') return null;
  return new Set(Object.keys(shape as Record<string, unknown>));
}
