import { GoogleAuth } from 'google-auth-library';
import { z } from 'zod';
import { EMBEDDING_DIMENSION } from './types.js';

/** Per-call task hint — Vertex embeds queries and documents differently. */
export type EmbeddingTask = 'document' | 'query';

/**
 * Embedding port (DIP): the vector repository depends on this interface, so
 * tests inject a deterministic fake and production wires Vertex.
 */
export interface EmbeddingService {
  readonly model: string;
  readonly dimension: number;
  /** Embed a batch of texts, preserving order and cardinality. */
  embed(
    texts: readonly string[],
    options?: { readonly task?: EmbeddingTask },
  ): Promise<readonly (readonly number[])[]>;
}

export class EmbeddingError extends Error {
  constructor(message: string, readonly causeError?: unknown) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

const EmbedResponseSchema = z.object({
  predictions: z.array(
    z.object({
      embeddings: z.object({
        values: z.array(z.number()),
      }),
    }),
  ),
});

export interface VertexEmbeddingOptions {
  readonly project: string;
  /** Vertex region; the embedding model is served from us-central1. */
  readonly location?: string;
  readonly model?: string;
  readonly dimension?: number;
  readonly taskType?: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' | 'SEMANTIC_SIMILARITY' | 'CLASSIFICATION';
  /** Instances per request — Vertex accepts up to 250. */
  readonly batchSize?: number;
  /** Injectable for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Vertex AI `text-embedding-005` adapter.
 *
 * Auth follows the same Application Default Credentials path as the LLM
 * (gcloud locally, a service-account JSON on Vercel), so there is one
 * credential story across the stack.
 *
 * The output dimension is asserted on every response: a model swap or a
 * server-side default change must fail loudly rather than silently write
 * vectors that do not match the `vector(768)` column.
 */
export class VertexEmbeddingService implements EmbeddingService {
  readonly model: string;
  readonly dimension: number;
  private readonly project: string;
  private readonly location: string;
  private readonly taskType: string;
  private readonly batchSize: number;
  private readonly fetchImpl: typeof fetch;
  private readonly auth: GoogleAuth;
  private clientPromise: ReturnType<GoogleAuth['getClient']> | null = null;

  constructor(options: VertexEmbeddingOptions) {
    this.project = options.project;
    this.location = options.location ?? 'us-central1';
    this.model = options.model ?? 'text-embedding-005';
    this.dimension = options.dimension ?? EMBEDDING_DIMENSION;
    this.taskType = options.taskType ?? 'RETRIEVAL_DOCUMENT';
    this.batchSize = options.batchSize ?? 32;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }

  private async accessToken(): Promise<string> {
    this.clientPromise ??= this.auth.getClient();
    const client = await this.clientPromise;
    const token = await client.getAccessToken();
    if (token.token === null || token.token === undefined) {
      throw new EmbeddingError('Vertex embedding: ADC returned no access token');
    }
    return token.token;
  }

  async embed(
    texts: readonly string[],
    options?: { readonly task?: EmbeddingTask },
  ): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];
    const taskType = options?.task === 'query' ? 'RETRIEVAL_QUERY' : this.taskType;
    const out: number[][] = [];
    for (let start = 0; start < texts.length; start += this.batchSize) {
      const batch = texts.slice(start, start + this.batchSize);
      const embeddings = await this.embedBatch(batch, taskType);
      out.push(...embeddings as number[][]);
    }
    return out;
  }

  private async embedBatch(
    batch: readonly string[],
    taskType: string,
  ): Promise<readonly (readonly number[])[]> {
    const token = await this.accessToken();
    const url =
      `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.project}` +
      `/locations/${this.location}/publishers/google/models/${this.model}:predict`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          instances: batch.map((content) => ({ content, task_type: taskType })),
          parameters: { outputDimensionality: this.dimension },
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new EmbeddingError(`Vertex embedding request failed: ${message}`, err);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new EmbeddingError(
        `Vertex embedding returned ${response.status}: ${text.slice(0, 300)}`,
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text) as unknown;
    } catch (err) {
      throw new EmbeddingError('Vertex embedding returned non-JSON body', err);
    }

    const parsed = EmbedResponseSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new EmbeddingError(
        `Vertex embedding response shape drifted: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
      );
    }
    if (parsed.data.predictions.length !== batch.length) {
      throw new EmbeddingError(
        `Vertex embedding returned ${parsed.data.predictions.length} vectors for ${batch.length} inputs`,
      );
    }

    return parsed.data.predictions.map((p, i) => {
      const values = p.embeddings.values;
      if (values.length !== this.dimension) {
        throw new EmbeddingError(
          `Vertex embedding vector ${i} has dimension ${values.length}, expected ${this.dimension}`,
        );
      }
      return values;
    });
  }
}
