import type { DocumentNode } from 'graphql';
import type { GraphQLClient } from 'graphql-request';

/**
 * The one `unknown` in the package: what comes back from the wire is
 * untrusted until a zod schema parses it. Everything above this boundary is
 * fully inferred from query definitions — no casts anywhere else.
 */
export interface SubgraphTransport {
  requestRaw(document: DocumentNode, variables: Record<string, string | number | boolean | null | undefined>, signal: AbortSignal): Promise<unknown>;
}

/** Request options shared by client methods (time-boxing per ops principles). */
export interface RequestOptions {
  /** Abort if the call takes longer than this (ms). Default 20s for queries, 10s for health. */
  readonly timeoutMs?: number;
}

export const DEFAULT_QUERY_TIMEOUT_MS = 20_000;
export const DEFAULT_HEALTH_TIMEOUT_MS = 10_000;

export class SubgraphTransportError extends Error {
  readonly endpointName: string;
  readonly causeError: unknown;

  constructor(endpointName: string, message: string, cause: unknown) {
    super(`[${endpointName}] ${message}`);
    this.name = 'SubgraphTransportError';
    this.endpointName = endpointName;
    this.causeError = cause;
  }
}

/** Adapter around graphql-request's GraphQLClient (DIP composition root). */
export class GraphQLClientTransport implements SubgraphTransport {
  constructor(
    private readonly client: GraphQLClient,
    private readonly endpointName: string,
  ) {}

  async requestRaw(
    document: DocumentNode,
    variables: Record<string, string | number | boolean | null | undefined>,
    signal: AbortSignal,
  ): Promise<unknown> {
    try {
      return await this.client.request<unknown>({
        document,
        variables,
        signal,
      });
    } catch (err) {
      // graphql-request can reject with undefined-shaped bodies (e.g. Studio's
      // {"message":"Not found"} with a 4xx). Surface endpoint + cause cleanly.
      const message = err instanceof Error ? err.message : String(err);
      throw new SubgraphTransportError(this.endpointName, `request failed: ${message}`, err);
    }
  }
}
