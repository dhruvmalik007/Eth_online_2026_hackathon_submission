/**
 * The on-chain LayerZero fee reader — the binding for {@link LayerZeroFeeReader}.
 *
 * LayerZero quotes a message fee by calling the OApp on the source chain. There
 * is no keyed quote endpoint to poll: `quote(...)` is a `view` function, so the
 * fee is read the same way any other contract state is.
 *
 * ## Two call shapes exist, and this covers one
 *
 * - **`quote(dstEid, payload, options, payInLzToken)`** — the OApp/endpoint form,
 *   implemented here. This is what a generic OApp exposes.
 * - **`quoteSend(SendParam, payInLzToken)`** — the OFT form, which takes a packed
 *   struct rather than separate arguments. It is *not* a rename: the argument
 *   shape differs, so an OFT caller supplies its own reader through the port
 *   rather than this class pretending to cover both.
 *
 * ## Why the ABI is declared, not imported
 *
 * The endpoint ABI varies by version, so declaring the one function we call keeps
 * the surface honest: if the target contract exposes a different signature, the
 * read fails at the call rather than silently decoding garbage.
 */
import { createPublicClient, http, parseAbi, type PublicClient } from "viem";
import type { LayerZeroFeeReader } from "./layerzero.js";

/**
 * The single function this reader calls.
 *
 * The return is a `MessagingFee` struct — a tuple, hence the `((...))` — which
 * viem decodes to named fields.
 */
const QUOTE_ABI = parseAbi([
  "function quote(uint32 dstEid, bytes payload, bytes options, bool payInLzToken) view returns ((uint256 nativeFee, uint256 lzTokenFee) fee)",
]);

export interface OnchainFeeReaderConfig {
  /** RPC per EVM chain id. The user's `LAYERZERO_RPCS` provides these. */
  readonly rpcUrls: Readonly<Record<number, string>>;
  /**
   * OApp address per chain id.
   *
   * The fee is a property of the *OApp* being called, not of LayerZero globally,
   * which is why it is per chain rather than a single address.
   */
  readonly oappByChainId: Readonly<Record<number, `0x${string}`>>;
  /** Kept so clients are reused rather than rebuilt per quote. */
  readonly cache?: Map<number, PublicClient>;
}

export class OnchainFeeReader implements LayerZeroFeeReader {
  private readonly clients: Map<number, PublicClient>;

  constructor(private readonly config: OnchainFeeReaderConfig) {
    this.clients = config.cache ?? new Map<number, PublicClient>();
  }

  /** A client per chain, reused — constructing one per quote would leak sockets. */
  private client(chainId: number): PublicClient {
    const existing = this.clients.get(chainId);
    if (existing !== undefined) return existing;

    const rpcUrl = this.config.rpcUrls[chainId];
    if (rpcUrl === undefined) {
      throw new Error(
        `No RPC configured for chain ${chainId}. Add it to LAYERZERO_RPCS so the fee can be quoted.`,
      );
    }
    const client = createPublicClient({ transport: http(rpcUrl) });
    this.clients.set(chainId, client);
    return client;
  }

  /**
   * Read the fee for a send.
   *
   * The `message` and `options` are passed through as given: the fee depends on
   * the payload *length* and the option bytes, so quoting with anything other
   * than the exact values that will be sent would return a fee for a message
   * that is not the one being sent.
   */
  async quoteSend(input: {
    readonly chainId: number;
    readonly endpoint: string;
    readonly dstEid: number;
    readonly receiver: string;
    readonly message: string;
    readonly options: string;
    readonly payInLzToken: boolean;
  }): Promise<{ nativeFee: bigint; lzTokenFee: bigint }> {
    const oapp = this.config.oappByChainId[input.chainId];
    if (oapp === undefined) {
      throw new Error(
        `No OApp configured for chain ${input.chainId}. The fee belongs to the OApp being called, not to LayerZero globally.`,
      );
    }

    const fee = await this.client(input.chainId).readContract({
      address: oapp,
      abi: QUOTE_ABI,
      functionName: "quote",
      args: [
        input.dstEid,
        input.message as `0x${string}`,
        input.options as `0x${string}`,
        input.payInLzToken,
      ],
    });

    return { nativeFee: fee.nativeFee, lzTokenFee: fee.lzTokenFee };
  }
}
