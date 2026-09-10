/**
 * @todo Move this to the @ethonline-2026/wallet package.
 * Currently used only for local/testnet integration testing.
 */



import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { sepolia, arbitrumSepolia, baseSepolia, optimismSepolia } from 'viem/chains';
import type { Chain } from 'viem';
import type { Env, TestnetChain } from '../config/index.js';
import { CHAIN_INFO } from '../config/index.js';

const VIEM_CHAINS: Record<TestnetChain, Chain> = {
  sepolia,
  'arbitrum-sepolia': arbitrumSepolia,
  'base-sepolia': baseSepolia,
  'optimism-sepolia': optimismSepolia,
  'polygon-amoy': sepolia, // replace with polygonAmoy import when signing on Amoy
};

export interface WalletSession {
  readonly walletClient: WalletClient;
  readonly publicClient: PublicClient;
  readonly address: Address;
  readonly chainId: number;
  readonly mode: 'ledger' | 'private-key' | 'readonly';
}

/**
 * OPTIONAL signing layer. Data extraction (health/query/extract-fno/deltas)
 * never needs a wallet — this exists only for on-chain interaction tasks
 * (e.g. executing a scripted testnet trade so the subgraph has an event to index).
 *
 * Modes:
 *  - ledger:      v2 payload (BIP32 path + address). The key NEVER leaves the device;
 *                 requires the Ledger connected with the Ethereum app open. viem's
 *                 Ledger HTTP transport talks to the device over the browser extension
 *                 bridge (`custom()` transport) or via a local iframe transport.
 *  - private-key: plaintext key from env — TESTNET ONLY fallback.
 *  - readonly:    no signer; view calls only (default for the dry run).
 */
export class WalletSigner {
  constructor(private readonly env: Env) { }

  async session(chain: TestnetChain = 'sepolia'): Promise<WalletSession> {
    const info = CHAIN_INFO[chain];
    const viemChain = VIEM_CHAINS[chain];
    const rpcUrl = this.env[info.rpcEnvKey] as string | undefined;
    const publicClient = createPublicClient({
      chain: viemChain,
      transport: http(rpcUrl),
    });

    const mode = this.env.WALLET_MODE || 'readonly';

    if (mode === 'ledger') {
      // v2 payload: path + address only. Requires @ledgerhq/connect-kit-iframe style
      // bridge or browser extension. For headless CLI runs we surface a precise setup
      // error instead of silently falling back.
      throw new Error(
        'Ledger mode requires the Ledger Connect Kit bridge (browser context) or ' +
        '@ledgerhq/hw-transport-node-hid + a signing adapter wired into walletClient. ' +
        'For headless testnet dry-runs, use WALLET_MODE=private-key with a throwaway testnet key, ' +
        'or keep mode unset (readonly) and sign trades from a browser session.',
      );
    }

    if (mode === 'private-key') {
      if (!this.env.WALLET_PRIVATE_KEY) {
        throw new Error('WALLET_MODE=private-key but WALLET_PRIVATE_KEY is empty');
      }
      const { privateKeyToAccount } = await import('viem/accounts');
      const realAccount = privateKeyToAccount(this.env.WALLET_PRIVATE_KEY as `0x${string}`);
      const walletClient = createWalletClient({
        account: realAccount,
        chain: viemChain,
        transport: http(rpcUrl),
      });
      return {
        walletClient,
        publicClient,
        address: realAccount.address,
        chainId: info.id,
        mode: 'private-key',
      };
    }

    // readonly: wallet client without an account — view calls only
    const walletClient = createWalletClient({
      chain: viemChain,
      transport: http(rpcUrl),
    });
    return {
      walletClient,
      publicClient,
      address: (this.env.WALLET_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address,
      chainId: info.id,
      mode: 'readonly',
    };
  }
}
