import { z } from 'zod';
import { BaseTool, type ToolResult } from './BaseTool.js';
import type { SubgraphClient, SubgraphHealth } from '@ethonline2026/graph-fno-indexer';

/**
 * Subgraph health check tool.
 * Monitors indexing status and errors across configured endpoints.
 * Uses the-graph's health probe (indexerMeta template) — the _meta response
 * is validated and block-flattened upstream by SubgraphClient.health().
 */

const HealthInputSchema = z.object({
  endpoint: z.string().optional(),
});

type HealthInput = z.infer<typeof HealthInputSchema>;

export class SubgraphHealthTool extends BaseTool {
  readonly name = 'subgraphHealth';
  readonly description = 'Check subgraph indexing health, block status, and indexing errors.';
  readonly schema = HealthInputSchema;

  private client: SubgraphClient | null = null;

  constructor(client?: SubgraphClient) {
    super();
    this.client = client ?? null;
  }

  setClient(client: SubgraphClient): void {
    this.client = client;
  }

  /**
   * Check health of a specific endpoint.
   */
  async checkHealth(_endpoint?: string): Promise<ToolResult<SubgraphHealth>> {
    const startTime = Date.now();

    if (!this.client) {
      return {
        success: false,
        error: 'Subgraph client not set. Call setClient() first.',
        toolName: this.name,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const health = await this.client.health();

      return {
        success: true,
        data: health,
        toolName: this.name,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        toolName: this.name,
        durationMs: Date.now() - startTime,
      };
    }
  }

  protected async run(input: HealthInput): Promise<unknown> {
    return this.checkHealth(input.endpoint);
  }
}
