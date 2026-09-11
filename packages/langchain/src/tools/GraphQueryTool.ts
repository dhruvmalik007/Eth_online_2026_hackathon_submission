import { BaseTool, type ToolResult } from './BaseTool.js';
import {
  ProtocolSnapshotInputSchema,
  FundingInputSchema,
  OpenPositionsInputSchema,
  FdvTokensInputSchema,
  DeltasInputSchema,
  type ProtocolSnapshotInput,
  type FundingInput,
  type OpenPositionsInput,
  type FdvTokensInput,
  type DeltasInput,
} from '../graphql/schema.js';
import {
  type ProtocolSnapshot,
  type FundingSnapshot,
  type PositionRow,
  type TokenFdvRow,
  type DeltaRow,
  FnoDataExtractor,
  type SubgraphClient,
} from '@ethonline2026/graph-fno-indexer';

/**
 * Graph query tool — wraps FnoDataExtractor operations with type-safe queries.
 * All execution flows through the-graph query templates (validated before
 * send, validated after receive); no inline SDL lives in this package.
 */

export interface GraphQueryResult {
  readonly query: string;
  readonly data: unknown;
  readonly blockNumber: number;
}

export class GraphQueryTool extends BaseTool {
  readonly name = 'graphQuery';
  readonly description = 'Execute type-safe GraphQL queries against The Graph subgraphs for protocol data, funding rates, positions, and FDV tokens.';
  readonly schema = ProtocolSnapshotInputSchema; // Default schema, overridden per operation

  private client: SubgraphClient | null = null;

  constructor(client?: SubgraphClient) {
    super();
    this.client = client ?? null;
  }

  setClient(client: SubgraphClient): void {
    this.client = client;
  }

  private requireExtractor(): FnoDataExtractor {
    if (!this.client) {
      throw new Error('Subgraph client not set. Call setClient() first.');
    }
    return new FnoDataExtractor(this.client);
  }

  private clientGuard(): ToolResult<never> | null {
    if (!this.client) {
      return {
        success: false,
        error: 'Subgraph client not set. Call setClient() first.',
        toolName: this.name,
        durationMs: 0,
      };
    }
    return null;
  }

  /**
   * Get protocol snapshot (TVL, OI, revenue).
   */
  async getProtocolSnapshot(input: ProtocolSnapshotInput): Promise<ToolResult<ProtocolSnapshot>> {
    const startTime = Date.now();

    const guard = this.clientGuard();
    if (guard) return guard;

    const parsed = ProtocolSnapshotInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        toolName: this.name,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const protocol = await this.requireExtractor().protocolSnapshot(parsed.data.protocolId);

      if (protocol === null) {
        return {
          success: false,
          error: `Protocol ${parsed.data.protocolId} not found`,
          toolName: this.name,
          durationMs: Date.now() - startTime,
        };
      }

      return {
        success: true,
        data: protocol,
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

  /**
   * Get funding rates and pool data.
   */
  async getFunding(input: FundingInput): Promise<ToolResult<FundingSnapshot>> {
    const startTime = Date.now();

    const guard = this.clientGuard();
    if (guard) return guard;

    const parsed = FundingInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        toolName: this.name,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const funding = await this.requireExtractor().funding(parsed.data.poolId, parsed.data.hours);

      if (funding === null) {
        return {
          success: false,
          error: `Pool ${parsed.data.poolId} not found`,
          toolName: this.name,
          durationMs: Date.now() - startTime,
        };
      }

      return {
        success: true,
        data: funding,
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

  /**
   * Get open positions for a pool.
   */
  async getOpenPositions(input: OpenPositionsInput): Promise<ToolResult<PositionRow[]>> {
    const startTime = Date.now();

    const guard = this.clientGuard();
    if (guard) return guard;

    const parsed = OpenPositionsInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        toolName: this.name,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const positions = await this.requireExtractor().openPositions(parsed.data.poolId);

      return {
        success: true,
        data: positions,
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

  /**
   * Get FDV tokens.
   */
  async getFdvTokens(input: FdvTokensInput): Promise<ToolResult<TokenFdvRow[]>> {
    const startTime = Date.now();

    const guard = this.clientGuard();
    if (guard) return guard;

    const parsed = FdvTokensInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        toolName: this.name,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const tokens = await this.requireExtractor().fdvTokens();

      return {
        success: true,
        data: tokens,
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

  /**
   * Get incremental deltas since last block.
   */
  async getDeltas(input: DeltasInput): Promise<ToolResult<{ swaps: DeltaRow[]; liquidates: DeltaRow[] }>> {
    const startTime = Date.now();

    const guard = this.clientGuard();
    if (guard) return guard;

    const parsed = DeltasInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        toolName: this.name,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const data = await this.requireExtractor().deltas(
        parsed.data.lastBlock,
        parsed.data.lastID,
        parsed.data.first,
      );

      return {
        success: true,
        data,
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

  /**
   * Base execute method — delegates to appropriate operation based on input.
   */
  protected async run(input: unknown): Promise<unknown> {
    // Determine which operation to perform based on input shape
    const inputObj = input as Record<string, unknown>;

    if ('protocolId' in inputObj && !('poolId' in inputObj)) {
      return this.getProtocolSnapshot(input as ProtocolSnapshotInput);
    }
    if ('poolId' in inputObj && 'hours' in inputObj) {
      return this.getFunding(input as FundingInput);
    }
    if ('poolId' in inputObj && 'first' in inputObj) {
      return this.getOpenPositions(input as OpenPositionsInput);
    }
    if ('lastBlock' in inputObj) {
      return this.getDeltas(input as DeltasInput);
    }
    if ('first' in inputObj) {
      return this.getFdvTokens(input as FdvTokensInput);
    }

    throw new Error('Unable to determine operation from input. Provide protocolId, poolId, or lastBlock.');
  }
}
