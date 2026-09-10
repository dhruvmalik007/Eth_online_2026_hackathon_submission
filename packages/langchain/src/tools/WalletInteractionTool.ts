import { z } from 'zod';
import { BaseTool, type ToolResult } from './BaseTool.js';
import type { WalletSigner, WalletSession, TestnetChain } from '@ethonline2026/graph-fno-indexer';

/**
 * Wallet interaction tool.
 * Handles on-chain interactions via Ledger or private key.
 */

const WalletInputSchema = z.object({
  chain: z.enum(['sepolia', 'arbitrum-sepolia', 'base-sepolia', 'optimism-sepolia', 'polygon-amoy']).default('sepolia'),
  action: z.enum(['get-session', 'get-balance']).default('get-session'),
});

type WalletInput = z.infer<typeof WalletInputSchema>;

export class WalletInteractionTool extends BaseTool {
  readonly name = 'walletInteraction';
  readonly description = 'Interact with wallets for on-chain operations. Supports Ledger and private-key modes.';
  readonly schema = WalletInputSchema;

  private signer: WalletSigner | null = null;

  constructor(signer?: WalletSigner) {
    super();
    this.signer = signer ?? null;
  }

  setSigner(signer: WalletSigner): void {
    this.signer = signer;
  }

  /**
   * Get wallet session for a chain.
   */
  async getSession(chain: TestnetChain): Promise<ToolResult<WalletSession>> {
    const startTime = Date.now();

    if (!this.signer) {
      return {
        success: false,
        error: 'Wallet signer not set. Call setSigner() first.',
        toolName: this.name,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const session = await this.signer.session(chain);

      return {
        success: true,
        data: session,
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

  protected async run(input: WalletInput): Promise<unknown> {
    if (input.action === 'get-session') {
      return this.getSession(input.chain);
    }
    throw new Error(`Unsupported action: ${input.action}`);
  }
}
