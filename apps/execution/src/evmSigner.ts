/**
 * The wallet contract the execution service depends on, and one implementation.
 *
 * ## Why the shape is declared here instead of imported
 *
 * Polymarket's client expects a signer with four methods. Declaring that shape
 * structurally rather than importing `Signer` from `@polymarket/client` keeps the
 * service from taking a protocol dependency in order to describe a *wallet* —
 * and since TypeScript matches structurally, any object with these methods
 * satisfies the SDK without an adapter.
 *
 * That is the seam the whole agnostic requirement rests on: `privateKeyEvmSigner`
 * is the demo case, and Privy, a Safe and Ledger DMK are each a class with these
 * four methods and nothing else.
 */
import {
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Chain } from "viem";

/** An EIP-712 domain, as every typed-data payload carries one. */
export interface EvmTypedDataDomain {
  readonly name?: string;
  readonly version?: string;
  readonly chainId?: number | bigint;
  readonly verifyingContract?: `0x${string}`;
}

/** An EIP-712 field definition. */
export interface EvmTypedDataField {
  readonly name: string;
  readonly type: string;
}

/** A complete EIP-712 payload — the ClobAuth message and every order use this. */
export interface EvmTypedDataPayload {
  readonly domain: EvmTypedDataDomain;
  readonly types: Readonly<Record<string, readonly EvmTypedDataField[]>>;
  readonly primaryType: string;
  readonly message: Readonly<Record<string, unknown>>;
}

/** A transaction a signer is asked to send. */
export interface EvmTransactionRequest {
  readonly chainId: number;
  readonly to: `0x${string}`;
  readonly data?: `0x${string}`;
  readonly value?: bigint;
}

/** What a signer returns once a transaction settles. */
export interface EvmTransactionHandle {
  readonly transactionHash: string;
}

/**
 * The four methods a wallet exposes.
 *
 * `signMessage` is separate from `signTypedData` because Polymarket's L1
 * credential derivation signs a plain message while orders sign typed data —
 * providers that support one and not the other are visible as a missing method
 * rather than a runtime failure.
 */
export interface EvmSigner {
  getAddress(): Promise<`0x${string}`>;
  signTypedData(payload: EvmTypedDataPayload): Promise<`0x${string}`>;
  signMessage(message: `0x${string}`): Promise<`0x${string}`>;
  sendTransaction(request: EvmTransactionRequest): Promise<EvmTransactionHandle>;
}

/**
 * The demo implementation, backed by a local private key.
 *
 * Deliberately the only implementation that holds a key. The production signers
 * (Privy, Safe, Ledger DMK) never see one — that is the difference between this
 * and the rest, and it is why this one is named for what it is.
 */
export function privateKeyEvmSigner(input: {
  readonly privateKey: `0x${string}`;
  readonly chain: Chain;
  readonly transport?: (url?: string) => ReturnType<typeof http>;
  readonly rpcUrl?: string;
}): EvmSigner {
  const account = privateKeyToAccount(input.privateKey);
  const wallet: WalletClient = createWalletClient({
    account,
    chain: input.chain,
    transport: input.transport?.(input.rpcUrl) ?? http(input.rpcUrl),
  });

  return {
    async getAddress(): Promise<`0x${string}`> {
      return account.address;
    },

    async signTypedData(payload): Promise<`0x${string}`> {
      // The payload is passed through as given rather than rebuilt: whatever the
      // protocol assembled is what gets signed, so a mismatch between the order
      // that is signed and the order that is submitted cannot originate here.
      return account.signTypedData({
        domain: payload.domain,
        types: payload.types,
        primaryType: payload.primaryType,
        message: payload.message,
      });
    },

    async signMessage(message): Promise<`0x${string}`> {
      return account.signMessage({ message: { raw: message } });
    },

    async sendTransaction(request): Promise<EvmTransactionHandle> {
      const hash = await wallet.sendTransaction({
        account,
        chain: input.chain,
        to: request.to,
        data: request.data,
        value: request.value,
      });
      return { transactionHash: hash };
    },
  };
}

/** Exposed for callers that need a read client alongside the signer. */
export type { PublicClient };
