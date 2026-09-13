/**
 * LayerZero adapter — permissionless cross-chain messaging (V2).
 *
 * Verified against the installed `@layerzerolabs/lz-v2-utilities` **^3.0.168**,
 * which exports `Options`, `calculateGuid` and `addressToBytes32`.
 *
 * ## It implements two capabilities, not three — deliberately
 *
 * LayerZero is a *messaging* protocol, not a token bridge with a fixed ABI. The
 * `send(...)` calldata belongs to the **OApp** the caller owns, so this adapter
 * quotes and tracks but does **not** build the transaction. That is the port's
 * ISP split being used rather than worked around: a `QuoteSource` and a
 * `StatusReader`, no `TransactionBuilder`, and nothing pretending otherwise.
 *
 * ## Why the fee comes from an injected port
 *
 * The protocol fee is an on-chain `quoteSend` read whose ABI varies by endpoint
 * version. Embedding an ABI here would be a guess that fails silently at the
 * wrong moment, so the read is injected — the adapter decides *what* to quote and
 * the caller supplies the *how*.
 *
 * ## The options model, which is the whole point
 *
 * `Options` are the **request** to the executor, and executors are permissionless.
 * Under-allocating gas does not revert: the message is mined, looks successful,
 * and is never delivered. So the allocated `msg.value` is a genuine **cost line**,
 * separate from the protocol fee — a LayerZero leg has two costs, not one — and
 * the caller must allocate enough for the post-bridge `lzCompose` leg to run.
 */
import { Options, addressToBytes32, calculateGuid } from "@layerzerolabs/lz-v2-utilities";
// viem exports `toHex`, not ethers' `hexlify`.
import { toHex } from "viem";
import { z } from "zod";
import type { NativePriceSource } from "./nativePrice.js";
import {
  QuoteEnvelopeSchema,
  StatusSnapshotSchema,
  type QuoteEnvelope,
  type QuoteFailure,
  type QuoteOutcome,
  type RouteHop,
  type StatusOutcome,
} from "./port.js";

/** The fee read, injected because the endpoint ABI cannot be safely embedded. */
export interface LayerZeroFeeReader {
  quoteSend(input: {
    readonly chainId: number;
    readonly endpoint: string;
    /** LayerZero's *endpoint id*, not an EVM chain id — they differ. */
    readonly dstEid: number;
    readonly receiver: string;
    readonly message: string;
    readonly options: string;
    readonly payInLzToken: boolean;
  }): Promise<{ readonly nativeFee: bigint; readonly lzTokenFee: bigint }>;
}

export interface LayerZeroConfig {
  /** `https://scan.layerzero-api.com/v1` — keyless, unlike LI.FI. */
  readonly scanBaseUrl: string;
  readonly feeReader: LayerZeroFeeReader;
  /** Chain ids this adapter is configured to send from. */
  readonly endpointByChainId: Readonly<Record<number, string>>;
  /**
   * Prices the native-denominated fee.
   *
   * LayerZero's endpoint returns wei and nothing denominated in dollars — unlike
   * Circle, which reports the rate it applied. Without this, every LayerZero leg
   * contributed `amountUsd: 0` to a headline total and silently understated the
   * most expensive part of a route.
   *
   * Optional, so the adapter still quotes without one — but then the lines are
   * labelled unpriced rather than reported as free.
   */
  readonly nativePrice?: NativePriceSource;
}

export interface LayerZeroQuoteRequest {
  readonly fromChainId: number;
  /** LayerZero endpoint id of the destination. */
  readonly toEid: number;
  readonly sender: string;
  readonly receiver: string;
  /** Subunit integer string. */
  readonly amount: string;
  /** Gas for `lzReceive` on the destination. */
  readonly receiveGas: number;
  /** Native value to drop on the destination, in wei. */
  readonly nativeDropWei?: string;
  /**
   * Gas for each `lzCompose` call on the destination.
   *
   * Our multi-step strategies live here: bridging then supplying is an `lzSend`
   * followed by an `lzCompose`, so this allocation is what lets the second leg
   * run at all.
   */
  readonly composeGas?: readonly number[];
}

/** The Scan API's message shape, read permissively. */
const ScanSchema = z.object({
  data: z
    .array(
      z.object({
        status: z.string().optional(),
        pathway: z
          .object({
            dvns: z
              .object({ requiredDVNs: z.array(z.string()).optional() })
              .optional(),
          })
          .optional(),
        dvnVerification: z
          .object({ receivedDVNs: z.array(z.string()).optional() })
          .optional(),
        destination: z
          .object({ tx: z.object({ txHash: z.string().optional() }).optional() })
          .optional(),
      }),
    )
    .optional(),
});

/** Map a thrown error onto the closed failure union, keeping the message. */
function classify(error: unknown): { reason: QuoteFailure; detail: string } {
  const detail = error instanceof Error ? error.message : String(error);
  const status = (error as { status?: number }).status;
  if (status === 429) return { reason: "rate_limited", detail };
  const message = detail.toLowerCase();
  if (message.includes("rate limit")) return { reason: "rate_limited", detail };
  if (message.includes("not found") || message.includes("no message")) return { reason: "no_route", detail };
  return { reason: "upstream_error", detail };
}

export class LayerZeroBridge {
  readonly id = "layerzero" as const;

  constructor(private readonly config: LayerZeroConfig) {}

  supports(request: LayerZeroQuoteRequest): boolean {
    return (
      this.config.endpointByChainId[request.fromChainId] !== undefined &&
      Number.isInteger(request.toEid) &&
      request.toEid > 0 &&
      /^\d+$/.test(request.amount) &&
      request.receiveGas > 0
    );
  }

  /**
   * Build the execution options, as a hex string.
   *
   * Exported as its own method because these bytes are what the caller embeds in
   * their OApp `send` call — and because a wrong allocation is the failure mode
   * described in the header, so it is worth being able to inspect them alone.
   *
   * `toBytes()` returns a `Uint8Array`, but everything crossing this package
   * speaks hex — including the fee reader and the quote's `raw` — so it is
   * hexlified here rather than leaking the buffer upward.
   */
  buildOptions(request: LayerZeroQuoteRequest): string {
    let options = Options.newOptions().addExecutorLzReceiveOption(request.receiveGas, 0);

    if (request.nativeDropWei !== undefined) {
      // The option builder wants a hex string; `addressToBytes32` returns bytes.
      options = options.addExecutorNativeDropOption(
        BigInt(request.nativeDropWei),
        toHex(addressToBytes32(request.receiver)),
      );
    }

    for (const [index, gas] of (request.composeGas ?? []).entries()) {
      // Named `Compose`, not `LzCompose` — confirmed against the installed types.
      options = options.addExecutorComposeOption(index, gas, 0);
    }

    return toHex(options.toBytes());
  }

  /**
   * Quote the protocol fee and surface the allocated native value.
   *
   * Two separate cost lines, because they are two separate charges: the DVN and
   * executor fee paid on the source chain, and the `msg.value` allocated for
   * execution on the destination. Modelling only the first understates every
   * cross-chain leg.
   */
  async quote(request: LayerZeroQuoteRequest): Promise<QuoteOutcome<QuoteEnvelope>> {
    if (!this.supports(request)) return { ok: false, reason: "unsupported_pair" };

    const endpoint = this.config.endpointByChainId[request.fromChainId];
    if (endpoint === undefined) return { ok: false, reason: "unsupported_pair" };

    try {
      const options = this.buildOptions(request);
      const fee = await this.config.feeReader.quoteSend({
        chainId: request.fromChainId,
        endpoint,
        dstEid: request.toEid,
        receiver: request.receiver,
        // The payload itself belongs to the caller's OApp; the fee depends only
        // on its length and the options, so an empty payload would misprice it.
        message: "0x",
        options,
        payInLzToken: false,
      });

      const hop: RouteHop = {
        source: "layerzero",
        protocol: "layerzero-v2",
        kind: "bridge",
        chainId: request.fromChainId,
        fromToken: "native",
        toToken: "native",
        fromAmount: request.amount,
        toAmount: request.amount,
        feeLines: [],
      };

      // The fee arrives in wei; only the price source can make it dollars, and
      // only it knows the chain's native decimals (Arc settles gas in USDC).
      const protocolFeeUsd =
        this.config.nativePrice === undefined
          ? null
          : await this.config.nativePrice.nativeToUsd(request.fromChainId, fee.nativeFee.toString());

      const dropUsd =
        request.nativeDropWei === undefined || this.config.nativePrice === undefined
          ? 0
          : (await this.config.nativePrice.nativeToUsd(request.fromChainId, request.nativeDropWei)) ?? 0;

      return {
        ok: true,
        quote: QuoteEnvelopeSchema.parse({
          sourceId: "layerzero",
          hops: [hop],
          feeLines: [
            {
              id: "layerzero:protocol-fee",
              // Labelled unpriced rather than left at zero, so a caller can tell
              // "not priced" apart from "genuinely free".
              label:
                protocolFeeUsd === null
                  ? "LayerZero DVN and executor fee (unpriced — no native price source)"
                  : "LayerZero DVN and executor fee",
              tier: "cost",
              amountUsd: protocolFeeUsd ?? 0,
              included: false,
            },
            // Appears only when a native drop is actually funded. An always-present
            // zero-valued line made the total look like it had two parts when it had
            // one — which is the case for every transfer we quote.
            ...(request.nativeDropWei === undefined
              ? []
              : [
                  {
                    id: "layerzero:option-value",
                    label: "Allocated destination native drop",
                    tier: "cost" as const,
                    amountUsd: dropUsd,
                    included: false,
                  },
                ]),
          ],
          expiresAt: new Date(Date.now() + 60_000),
          // The raw fee and options travel with the quote so the caller can
          // embed the options and pay the fee it was quoted.
          raw: {
            nativeFee: fee.nativeFee.toString(),
            lzTokenFee: fee.lzTokenFee.toString(),
            options,
            dstEid: request.toEid,
          },
        }),
      };
    } catch (error) {
      return { ok: false, ...classify(error) };
    }
  }

  /**
   * Track a message by its GUID.
   *
   * The GUID is computable locally (see {@link guidFor}), so tracking can begin
   * the moment a message is sent rather than waiting on an indexer — which
   * shortens the window in which a sent message is untracked.
   *
   * `attesting` is distinct from `pending` and that distinction is the point:
   * DVN verification is what makes a bridge slow, and it is reported separately
   * from delivery.
   */
  async status(reference: { readonly guid: string }): Promise<StatusOutcome> {
    try {
      const response = await fetch(`${this.config.scanBaseUrl}/messages/guid/${reference.guid}`);
      if (!response.ok) {
        return { ok: false, reason: response.status === 429 ? "rate_limited" : "upstream_error" };
      }
      const parsed = ScanSchema.safeParse(await response.json());
      if (!parsed.success || (parsed.data.data ?? []).length === 0) {
        return { ok: false, reason: "no_route" };
      }

      const message = parsed.data.data?.[0];
      const required = message?.pathway?.dvns?.requiredDVNs ?? [];
      const received = message?.dvnVerification?.receivedDVNs ?? [];
      const raw = await response.json();

      const snapshot = {
        state: mapState(message?.status, required.length, received.length),
        ...(message?.destination?.tx?.txHash === undefined
          ? {}
          : { deliveredTxHash: message.destination.tx.txHash }),
        ...(required.length === 0 ? {} : { attestations: { required: required.length, received: received.length } }),
        raw,
      };
      return { ok: true, status: StatusSnapshotSchema.parse(snapshot) };
    } catch (error) {
      return { ok: false, ...classify(error) };
    }
  }

  /**
   * The message GUID for a send, computable without an indexer.
   *
   * Wrapped rather than inlined so the SDK dependency stays in one place. The
   * installed `calculateGuid` takes a `PacketHeader` — hence `version`, which is
   * LayerZero's packet version, not ours — and hex strings rather than buffers.
   */
  guidFor(input: {
    readonly nonce: bigint;
    readonly srcEid: number;
    readonly sender: string;
    readonly dstEid: number;
    readonly receiver: string;
  }): string {
    return calculateGuid({
      version: 1,
      nonce: input.nonce.toString(),
      srcEid: input.srcEid,
      sender: toHex(addressToBytes32(input.sender)),
      dstEid: input.dstEid,
      receiver: toHex(addressToBytes32(input.receiver)),
    });
  }
}

/**
 * Map LayerZero's vocabulary onto ours.
 *
 * The DVN count is consulted before the status word: a message that has been
 * *sent* but not yet verified is `attesting`, and reporting it as merely pending
 * hides the reason a cross-chain leg is slow.
 */
function mapState(
  status: string | undefined,
  requiredDvns: number,
  receivedDvns: number,
): "pending" | "attesting" | "delivered" | "failed" {
  const word = (status ?? "").toUpperCase();
  if (word === "DELIVERED") return "delivered";
  if (word === "FAILED" || word.includes("BLOCKED")) return "failed";
  if (requiredDvns > 0 && receivedDvns < requiredDvns) return "attesting";
  return "pending";
}
