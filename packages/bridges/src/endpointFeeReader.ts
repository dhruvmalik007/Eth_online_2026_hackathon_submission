/**
 * LayerZero V2 **endpoint** fee reader — the binding that needs no OApp address.
 *
 * `OnchainFeeReader` calls an OApp's `quote(uint32,bytes,bytes,bool)`, which
 * requires the caller to name their own contract. That is fine for an
 * integrator, but it made LayerZero the one adapter nobody could quote with
 * out of the box.
 *
 * The endpoint removes that requirement: it is the protocol's own contract, at
 * **the same address on every chain**, and it exposes
 *
 * ```
 * quote(MessagingParams, address sender) returns (MessagingFee)
 * ```
 *
 * where `MessagingParams` is a packed struct — so this is *not* a rename of the
 * OApp form. The argument shapes genuinely differ, which is exactly why the port
 * exists as an injection point rather than a single hardcoded call.
 *
 * ## Why the address is a constant
 *
 * EndpointV2 is deployed by LayerZero at a fixed address across chains; that is
 * the point of an omnichain endpoint. A wrong address fails loudly on the read
 * rather than returning a plausible fee, which is the failure mode worth having.
 */
import { createPublicClient, http, parseAbi, type PublicClient } from "viem";
import type { LayerZeroFeeReader } from "./layerzero.js";

/**
 * The endpoint address, re-exported from {@link addressBook} so there is **one**
 * definition of it, carrying its provenance, rather than a constant that exists
 * twice and drifts.
 */
import { ENDPOINT_V2_ADDRESS } from "./addressBook.js";
export { ENDPOINT_V2_ADDRESS };

/**
 * The endpoint's quote, in its packed-struct form.
 *
 * The tuple nesting matters: `((uint32,bytes32,bytes,bytes,bool),address)` is a
 * struct argument followed by an address, and `((uint256,uint256))` is the
 * returned struct.
 */
const QUOTE_ABI = parseAbi([
  "function quote((uint32 dstEid, bytes32 receiver, bytes message, bytes options, bool payInLzToken) _params, address _sender) view returns ((uint256 nativeFee, uint256 lzTokenFee) fee)",
]);

export interface EndpointFeeReaderConfig {
  /** RPC per EVM chain id — `LAYERZERO_RPCS` in the environment. */
  readonly rpcUrls: Readonly<Record<number, string>>;
  /** Override the endpoint per chain. Defaults to {@link ENDPOINT_V2_ADDRESS}. */
  readonly endpointByChainId?: Readonly<Record<number, `0x${string}`>>;
  /** Reused across quotes; one client per chain, not per call. */
  readonly cache?: Map<number, PublicClient>;
}

export class EndpointFeeReader implements LayerZeroFeeReader {
  private readonly clients: Map<number, PublicClient>;

  constructor(private readonly config: EndpointFeeReaderConfig) {
    this.clients = config.cache ?? new Map<number, PublicClient>();
  }

  private client(chainId: number): PublicClient {
    const existing = this.clients.get(chainId);
    if (existing !== undefined) return existing;

    const rpcUrl = this.config.rpcUrls[chainId];
    if (rpcUrl === undefined || rpcUrl.length === 0) {
      throw new Error(
        `No RPC configured for chain ${chainId}. Add it to LAYERZERO_RPCS so the endpoint fee can be read.`,
      );
    }
    const client = createPublicClient({ transport: http(rpcUrl) });
    this.clients.set(chainId, client);
    return client;
  }

  /**
   * Read the endpoint's quoted fee.
   *
   * `message` and `options` are passed through verbatim: the fee depends on the
   * payload's **length** and on the option bytes, so quoting with substitutes
   * returns the price of a message that will never be sent.
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
    const endpoint =
      this.config.endpointByChainId?.[input.chainId] ??
      (input.endpoint.length > 0
        ? (input.endpoint as `0x${string}`)
        : ENDPOINT_V2_ADDRESS);

    const fee = await this.client(input.chainId).readContract({
      address: endpoint,
      abi: QUOTE_ABI,
      functionName: "quote",
      args: [
        {
          dstEid: input.dstEid,
          receiver: toBytes32(input.receiver),
          message: input.message as `0x${string}`,
          options: input.options as `0x${string}`,
          payInLzToken: input.payInLzToken,
        },
        // The refund address. The fee barely moves with it, and using the
        // receiver is honest: it is where any refund would actually go.
        input.receiver as `0x${string}`,
      ],
    });

    return { nativeFee: fee.nativeFee, lzTokenFee: fee.lzTokenFee };
  }
}

/**
 * Left-pad an address to the 32 bytes the endpoint's `receiver` field wants.
 *
 * Done here rather than importing `addressToBytes32` so this module has no
 * dependency on the utilities package — it is one pad, and the shape is stable.
 */
function toBytes32(address: string): `0x${string}` {
  const bare = address.startsWith("0x") ? address.slice(2) : address;
  if (!/^[0-9a-fA-F]{40}$/.test(bare)) {
    throw new Error(`Not a 20-byte address: ${address}`);
  }
  return `0x${bare.padStart(64, "0")}`;
}
