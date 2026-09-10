import type { AnyQueryDefinition } from './QueryDefinition.js';

/**
 * Id-keyed catalog of query definitions. Duplicate ids fail fast at
 * registration; lookups are exact-string. The registry is the composition
 * root for extractors: they `require()` their queries by id, giving one
 * place to enumerate every GraphQL query the package can send.
 */
export class QueryRegistry {
  private readonly defs = new Map<string, AnyQueryDefinition>();

  register(def: AnyQueryDefinition): void {
    const existing = this.defs.get(def.id);
    if (existing !== undefined) {
      throw new Error(`QueryRegistry: duplicate query id "${def.id}" (already registered)`);
    }
    this.defs.set(def.id, def);
  }

  registerAll(defs: readonly AnyQueryDefinition[]): void {
    for (const def of defs) this.register(def);
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  get(id: string): AnyQueryDefinition | undefined {
    return this.defs.get(id);
  }

  require(id: string): AnyQueryDefinition {
    const def = this.defs.get(id);
    if (def === undefined) {
      const available = [...this.defs.keys()].sort().join(', ');
      throw new Error(`QueryRegistry: unknown query id "${id}". Registered: ${available || '(none)'}`);
    }
    return def;
  }

  list(): readonly AnyQueryDefinition[] {
    return [...this.defs.values()];
  }

  ids(): readonly string[] {
    return [...this.defs.keys()].sort();
  }

  get size(): number {
    return this.defs.size;
  }
}
