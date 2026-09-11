/**
 * Embedding pipeline for risk records.
 *
 * Turns validated risk records into citation-tagged chunks and persists them to
 * the temporal vector store, where the agent retrieves them by meaning — "has
 * this chain had sequencing outages?" — rather than only by key.
 *
 * Two properties carry over from the serializer and are what make the store
 * trustworthy:
 *
 *  - **Text comes from records, never from a model.** The serializer renders only
 *    fields that arrived from upstream, so a hallucination cannot enter the store.
 *  - **Ids are content-hashed.** Re-running a backfill re-embeds nothing already
 *    stored, which is what makes the step safe to repeat and cheap to run every
 *    sweep.
 *
 * Embedding is the one part of the pipeline that spends money per call, so the
 * chunk set is assembled fully before any request is made: a malformed record
 * fails before the first embedding rather than halfway through a batch.
 */

import type { EmbeddingService, SerializedChunk, VectorRepository } from '@ethonline2026/timeseries';
import type {
  ChainRiskProfile,
  MarketMakerProfile,
  ProtocolGovernanceProfile,
} from './types.js';
import {
  serializeChainRisk,
  serializeGovernanceSummary,
  serializeMarketMaker,
  serializeProposal,
} from './serializer.js';

/** What one embedding run did. */
export interface EmbeddingReport {
  /** Chunks assembled from the records. */
  readonly chunks: number;
  /** Vectors newly stored. */
  readonly inserted: number;
  /** Chunks already present, skipped by content hash. */
  readonly skipped: number;
  /** Non-fatal problems, one per record that could not be serialized. */
  readonly notes: readonly string[];
}

/**
 * One sweep's records, as the input to serialization and embedding.
 *
 * Shared by {@link buildChunks} and {@link embedRiskRecords} because they operate
 * on the same set: naming it once keeps the two from drifting apart, and gives
 * each family a single documented home.
 */
export interface RiskRecordsInput {
  /** The instant stamped onto every serialized chunk and its time window. */
  readonly observedAt: Date;
  /** Chain profiles to serialize. */
  readonly chains?: readonly ChainRiskProfile[] | undefined;
  /** Governance profiles; each yields a summary plus one chunk per proposal. */
  readonly protocols?: readonly ProtocolGovernanceProfile[] | undefined;
  /** Market-maker profiles to serialize. */
  readonly marketMakers?: readonly MarketMakerProfile[] | undefined;
}

/**
 * Assemble the chunk set for one sweep.
 *
 * Pure and separate from the write, so the exact bytes that will be embedded can
 * be inspected in a test without an embedding service or a database. That matters
 * here more than elsewhere: this is the text a retrieval hit will quote, so being
 * able to read it is the review surface.
 *
 * One chunk per proposal, plus one governance summary per protocol, because the
 * two answer different questions: the proposal is the evidence, the summary is
 * the state of play.
 *
 * @param input - The records to serialize and the instant to stamp them with.
 * @returns The chunks, plus a note per record that produced none.
 */
export function buildChunks(input: RiskRecordsInput): {
  readonly chunks: readonly SerializedChunk[];
  readonly notes: readonly string[];
} {
  const chunks: SerializedChunk[] = [];
  const notes: string[] = [];

  for (const chain of input.chains ?? []) {
    chunks.push(serializeChainRisk(chain, input.observedAt));
  }

  for (const protocol of input.protocols ?? []) {
    chunks.push(serializeGovernanceSummary(protocol, input.observedAt));
    for (const proposal of protocol.proposals) {
      const chunk = serializeProposal(protocol.slug, proposal);
      if (chunk === null) {
        // A proposal with no parseable timestamp cannot be placed on the
        // timeline, so it is skipped and reported rather than dropped silently.
        notes.push(`proposal ${protocol.slug}:${proposal.id} has no parseable timestamp`);
        continue;
      }
      chunks.push(chunk);
    }
  }

  for (const maker of input.marketMakers ?? []) {
    chunks.push(serializeMarketMaker(maker, input.observedAt));
  }

  return { chunks, notes };
}

/**
 * Embed and persist a sweep's chunks.
 *
 * @param vectors - The vector repository (supplied by the timeseries package).
 * @param input - The records to embed.
 * @returns What was written, skipped and noted.
 * @example
 * ```ts
 * const report = await embedRiskRecords(vectors, { observedAt, chains, protocols });
 * ```
 */
export async function embedRiskRecords(
  vectors: VectorRepository,
  input: RiskRecordsInput,
): Promise<EmbeddingReport> {
  const { chunks, notes } = buildChunks(input);
  if (chunks.length === 0) {
    return { chunks: 0, inserted: 0, skipped: 0, notes };
  }

  const result = await vectors.upsertBatch(chunks);
  return {
    chunks: chunks.length,
    inserted: result.inserted,
    skipped: result.skipped,
    notes,
  };
}

/**
 * Probe whether the vector layer is usable before a sweep depends on it.
 *
 * Embedding is optional: a store without pgvector still produces snapshots and
 * history, so the sweep asks first and degrades rather than failing. Returning a
 * boolean rather than throwing keeps that decision at the call site.
 *
 * @param vectors - The vector repository.
 * @returns `true` when the layer is present and queryable.
 */
export async function vectorLayerAvailable(vectors: VectorRepository): Promise<boolean> {
  try {
    await vectors.assertAvailable();
    return true;
  } catch {
    return false;
  }
}

/**
 * The embedding service's identity, for logging which model produced a vector.
 *
 * @param embeddings - The embedding service.
 * @returns The model name, or `null` when the service exposes none.
 */
export function embeddingModelName(embeddings: EmbeddingService | undefined): string | null {
  return embeddings === undefined ? null : embeddings.model;
}
