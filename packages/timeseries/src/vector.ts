import { randomUUID } from 'node:crypto';
import { assertVectorLayer } from './migrate.js';
import type { EmbeddingService } from './embeddings.js';
import type { SqlRunner } from './runner.js';
import { hashChunk, type SerializedChunk } from './serializer.js';
import {
  EMBEDDING_DIMENSION,
  EmbeddingKindSchema,
  VectorUnavailableError,
  type CapabilityReport,
  type EmbeddingKind,
  type RetrievalHit,
} from './types.js';
import { asDate, asNumber, asString, asStringArray } from './wire.js';

export interface TemporalSearchInput {
  readonly query: string;
  /** Restrict to one pool — always set when the question names a pool. */
  readonly poolId?: string;
  readonly kinds?: readonly EmbeddingKind[];
  readonly from?: Date;
  readonly to?: Date;
  /** Number of hits requested; the search over-fetches then re-ranks. */
  readonly k?: number;
}

export interface VectorUpsertResult {
  readonly embedded: number;
  readonly inserted: number;
  readonly skipped: number;
}

const DEFAULT_K = 8;
/** Over-fetch factor: ANN before a selective filter can starve the result set. */
const OVERFETCH = 5;
const MAX_K = 50;

/**
 * Recall budget for one search, applied with `SET LOCAL` inside the search
 * transaction. Both indexes post-filter, so a selective pool/time predicate can
 * otherwise return fewer rows than requested; a larger candidate list is the
 * documented mitigation.
 *
 * `diskann.query_search_list_size` is pgvectorscale's knob; `hnsw.ef_search`
 * plus `relaxed_order` iterative scan is pgvector's. Which pair applies is read
 * from the live capability report, never assumed — setting the wrong one would
 * fail, because the GUC's namespace only exists once its library is loaded.
 */
const DISKANN_SEARCH_LIST_SIZE = 200;
const HNSW_EF_SEARCH = 100;

function recallStatements(capabilities: CapabilityReport): readonly string[] {
  return capabilities.vectorscaleEnabled
    ? [`SET LOCAL diskann.query_search_list_size = ${DISKANN_SEARCH_LIST_SIZE}`]
    : [
        `SET LOCAL hnsw.ef_search = ${HNSW_EF_SEARCH}`,
        `SET LOCAL hnsw.iterative_scan = relaxed_order`,
      ];
}

/**
 * Time-series vector store over `ts_embeddings`.
 *
 * TimescaleDB is Postgres, so the temporal-vector pattern is a `vector` column
 * plus a time column: an ANN index serves similarity while btree/pool filters
 * bound the window. The table is deliberately uncompressed because ANN indexes
 * are not maintained across compressed chunks.
 *
 * The column is full-precision `vector`, not `halfvec`, even though `halfvec`
 * halves index size. On this stack pgvectorscale's StreamingDiskANN — the index
 * that supports label-based *filtered* search, which is what every query here
 * needs — accepts only `vector_*_ops`; `halfvec_cosine_ops` exists for hnsw
 * alone. Since our predicates always filter by pool and time, filtered-search
 * quality is worth more than the storage saving.
 */
export class VectorRepository {
  constructor(
    private readonly runner: SqlRunner,
    private readonly embeddings: EmbeddingService,
  ) {}

  /** Fail with a typed error (not a SQL error) when the layer is absent. */
  async assertAvailable(): Promise<CapabilityReport> {
    return assertVectorLayer(this.runner);
  }

  /**
   * Embed and persist chunks. Idempotent by content hash: re-running a
   * backfill re-embeds nothing that is already stored (the ON CONFLICT keeps
   * the existing row), so the operation is safe to repeat.
   */
  async upsertBatch(chunks: readonly SerializedChunk[]): Promise<VectorUpsertResult> {
    if (chunks.length === 0) return { embedded: 0, inserted: 0, skipped: 0 };
    await this.assertAvailable();

    const vectors = await this.embeddings.embed(
      chunks.map((c) => c.content),
      { task: 'document' },
    );
    if (vectors.length !== chunks.length) {
      throw new Error(
        `embedding service returned ${vectors.length} vectors for ${chunks.length} chunks`,
      );
    }

    const values: unknown[] = [];
    const tuples = chunks.map((chunk, i) => {
      const vector = vectors[i]!;
      const b = i * 10;
      values.push(
        randomUUID(),
        chunk.tsStart,
        chunk.tsEnd,
        chunk.poolId,
        chunk.kind,
        [...chunk.sourceIds],
        chunk.content,
        `[${vector.join(',')}]`,
        this.embeddings.model,
        hashChunk(chunk),
      );
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::text[], $${b + 7}, $${b + 8}::vector(${EMBEDDING_DIMENSION}), $${b + 9}, $${b + 10})`;
    });

    const res = await this.runner.query(
      `INSERT INTO ts_embeddings
         (id, ts_start, ts_end, pool_id, kind, source_ids, content, embedding, model, content_hash)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (content_hash, ts_start) DO NOTHING
       RETURNING id`,
      values,
    );

    const inserted = res.rows.length;
    return { embedded: chunks.length, inserted, skipped: chunks.length - inserted };
  }

  /**
   * Temporal similarity search. The filter runs server-side so an agent can
   * never widen its own evidence window, then results are re-ranked by score.
   */
  async searchTemporal(input: TemporalSearchInput): Promise<readonly RetrievalHit[]> {
    const capabilities = await this.assertAvailable();

    const k = Math.min(Math.max(input.k ?? DEFAULT_K, 1), MAX_K);
    const [queryVector] = await this.embeddings.embed([input.query], { task: 'query' });
    if (queryVector === undefined) {
      throw new Error('embedding service returned no vector for the query');
    }

    const kinds = input.kinds === undefined ? null : [...input.kinds];
    // The recall settings and the search must share one connection, so both run
    // inside the same transaction (`SET LOCAL` is transaction-scoped).
    const res = await this.runner.transaction(async (tx) => {
      for (const statement of recallStatements(capabilities)) {
        await tx.query(statement);
      }
      return tx.query(
        `SELECT id, pool_id, kind, ts_start, ts_end, source_ids, content,
                1 - (embedding <=> $1::vector(${EMBEDDING_DIMENSION})) AS score
         FROM ts_embeddings
         WHERE ($2::text IS NULL OR pool_id = $2)
           AND ($3::timestamptz IS NULL OR ts_end >= $3)
           AND ($4::timestamptz IS NULL OR ts_start <= $4)
           AND ($5::text[] IS NULL OR kind = ANY($5::text[]))
         ORDER BY embedding <=> $1::vector(${EMBEDDING_DIMENSION})
         LIMIT $6`,
        [
          `[${queryVector.join(',')}]`,
          input.poolId ?? null,
          input.from ?? null,
          input.to ?? null,
          kinds,
          k * OVERFETCH,
        ],
      );
    });

    const hits: RetrievalHit[] = [];
    for (const row of res.rows) {
      const id = asString(row['id']);
      const poolId = asString(row['pool_id']);
      const content = asString(row['content']);
      const tsStart = asDate(row['ts_start']);
      const tsEnd = asDate(row['ts_end']);
      const kind = EmbeddingKindSchema.safeParse(row['kind']);
      if (id === null || poolId === null || content === null || tsStart === null || tsEnd === null) {
        continue;
      }
      if (!kind.success) continue;
      hits.push({
        id,
        poolId,
        kind: kind.data,
        tsStart,
        tsEnd,
        sourceIds: [...asStringArray(row['source_ids'])],
        content,
        score: asNumber(row['score']) ?? 0,
      });
    }

    // Re-rank after the server-side filter, then trim to the requested k.
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }

  /** How many chunks are indexed, optionally for one pool. */
  async count(poolId?: string): Promise<number> {
    await this.assertAvailable();
    const res = await this.runner.query(
      `SELECT count(*)::int AS n FROM ts_embeddings
       WHERE ($1::text IS NULL OR pool_id = $1)`,
      [poolId ?? null],
    );
    return asNumber(res.rows[0]?.['n']) ?? 0;
  }
}

/**
 * Raised when a caller asks for the vector layer on a server that cannot
 * provide it. Re-exported here so `VectorRepository` consumers have one
 * import site.
 */
export { VectorUnavailableError };
