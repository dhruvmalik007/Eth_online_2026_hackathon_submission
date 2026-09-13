/**
 * Circle CCTP adapter — native USDC bridging (CCTP V2).
 *
 * Verified against the installed `@circle-fin/bridge-kit` **^1.14.1**,
 * `@circle-fin/provider-cctp-v2` **^1.13.0** and
 * `@circle-fin/adapter-viem-v2` **^1.17.1** — the same generation as the
 * `@circle-fin/app-kit` **^1.14.0** that `packages/arc` already uses.
 *
 * ## TransferSpeed is a pricing input, not a preference
 *
 * CCTP V2 bills fast transfers differently from standard ones, so speed is part
 * of the quote rather than a UI toggle. It is required here because a default
 * would silently choose a price the user never saw.
 *
 * ## Errors are classified by Circle, not by us
 *
 * The kit ships `isRateLimitError`, `isRetryableError`, `isInputError` and
 * friends. String-matching provider messages is how a rate limit gets mistaken
 * for a bad request, and only one of those is worth retrying — so the kit's own
 * taxonomy drives that decision.
 *
 * ## What is injected, and why
 *
 * The provider's quote call is injected rather than called directly. Its config
 * surface must be read from its own types at composition time, and embedding a
 * guessed method name here would fail at the wrong moment — the same lesson the
 * first LI.FI draft taught. The adapter owns the *shape* of a CCTP quote and its
 * failure taxonomy; the composition root owns the binding.
 */
import { TransferSpeed, isRateLimitError, isRetryableError } from "@circle-fin/bridge-kit";
import { z } from "zod";
import {
  QuoteEnvelopeSchema,
  StatusSnapshotSchema,
  type QuoteEnvelope,
  type QuoteFailure,
  type QuoteOutcome,
  type RouteHop,
  type StatusOutcome,
} from "./port.js";

/**
 * A chain this adapter can bridge between.
 *
 * Deliberately **not** `keyof typeof BridgeChain`. That enum is mainnet-only —
 * its keys are Arbitrum, Avalanche, Base, Ethereum, Polygon and so on, with no
 * testnet entries at all — so deriving from it would make a Sepolia pair
 * unrepresentable.
 *
 * The real gate is the **domain map** the quote reader is configured with,
 * because a CCTP transfer is identified by domain ids rather than chain names.
 * A chain with no configured domain fails at the reader with a message saying
 * so, which is more useful than a type that cannot express the case.
 */
export type CctpChain = string;
/** Fast or standard. The SDK says `SLOW` where Circle's prose says "Standard". */
export type CctpSpeed = keyof typeof TransferSpeed;

/** The quote read, injected — see the header. */
export interface CctpQuoteReader {
  quote(input: {
    readonly from: CctpChain;
    readonly to: CctpChain;
    readonly amount: string;
    readonly recipient: string;
    readonly speed: CctpSpeed;
  }): Promise<{
    readonly feeUsd: number;
    /** Base units of the fee token. */
    readonly feeAmount: string;
    readonly estimatedDurationSec: number;
    /**
     * When the quote lapses.
     *
     * Supplied by the reader rather than assumed: Circle's quotes are signed and
     * time-bound, expiring roughly two minutes after issue, and submitting a
     * lapsed quote reverts.
     */
    readonly expiresAt: Date;
    readonly raw: unknown;
  }>;
}

export interface CircleCctpConfig {
  readonly quoteReader: CctpQuoteReader;
  /**
   * API key — required for the attestation service, optional for on-chain reads.
   *
   * Defaults to `CIRCLE_TEST_API_KEY` at wiring time when the chain is a testnet.
   */
  readonly apiKey?: string;
}

export interface CctpQuoteRequest {
  readonly from: CctpChain;
  readonly to: CctpChain;
  /** Subunit integer string. */
  readonly amount: string;
  readonly recipient: string;
  readonly speed: CctpSpeed;
}

/** An attestation as the service handles it. */
const AttestationSchema = z.object({
  /** CCTP attestations are `0x`-prefixed and expire; both matter. */
  attestation: z.string().optional(),
  expirationBlock: z.coerce.number().optional(),
});

export class CircleCctpBridge {
  readonly id = "circle-cctp" as const;

  constructor(private readonly config: CircleCctpConfig) {}

  /**
   * Whether the request is well-formed enough to attempt.
   *
   * Note what is deliberately *not* checked: whether the chains are known. That
   * belongs to the domain map, which the reader owns — so an unmapped chain
   * produces "no CCTP domain configured for X" rather than a bare
   * `unsupported_pair`, and testnets work without the mainnet-only enum.
   */
  supports(request: CctpQuoteRequest): boolean {
    return (
      request.from !== request.to &&
      request.from.length > 0 &&
      request.to.length > 0 &&
      /^\d+$/.test(request.amount) &&
      request.speed in TransferSpeed
    );
  }

  /**
   * Quote a CCTP transfer.
   *
   * CCTP has no on-top aggregator fee — the cost is the protocol fee (which
   * differs by speed) plus destination gas. So there is exactly one cost line
   * here, and no `bound` line: CCTP does not slip, it either attests or it does
   * not.
   */
  async quote(request: CctpQuoteRequest): Promise<QuoteOutcome<QuoteEnvelope>> {
    if (!this.supports(request)) return { ok: false, reason: "unsupported_pair" };

    try {
      const quote = await this.config.quoteReader.quote({
        from: request.from,
        to: request.to,
        amount: request.amount,
        recipient: request.recipient,
        speed: request.speed,
      });

      const hop: RouteHop = {
        source: "circle-cctp",
        protocol: `cctp-v2:${request.speed}`,
        kind: "bridge",
        // No `chainId`: a CCTP hop is identified by *domain*, which the quote
        // carries in `raw`. Forcing a chain id here is what produced a `0` that
        // the envelope schema rightly rejected.
        fromToken: "usdc",
        toToken: "usdc",
        fromAmount: request.amount,
        toAmount: request.amount,
        feeLines: [],
        estimatedDurationSec: quote.estimatedDurationSec,
      };

      return {
        ok: true,
        quote: QuoteEnvelopeSchema.parse({
          sourceId: "circle-cctp",
          hops: [hop],
          feeLines: [
            {
              id: `circle-cctp:${request.speed}-fee`,
              label: `CCTP ${request.speed.toLowerCase()} transfer fee`,
              tier: "cost",
              amountUsd: quote.feeUsd,
              included: false,
            },
          ],
          // Circle's own expiry, not one we invented. Its quotes lapse about two
          // minutes after issue and submitting a lapsed one reverts.
          expiresAt: quote.expiresAt,
          raw: quote.raw,
        }),
      };
    } catch (error) {
      return { ok: false, ...classify(error) };
    }
  }

  /**
   * Read an attestation's state.
   *
   * Expiry is checked before presence, because an expired attestation is not a
   * pending one: it can no longer be used to mint, and reporting it as pending
   * would leave the user waiting for something that will never arrive.
   */
  status(reference: {
    readonly attestation: unknown;
    readonly currentBlock: number;
  }): StatusOutcome {
    const parsed = AttestationSchema.safeParse(reference.attestation);
    if (!parsed.success) {
      return { ok: true, status: StatusSnapshotSchema.parse({ state: "pending", raw: reference.attestation }) };
    }

    const hasAttestation = (parsed.data.attestation ?? "").length > 2;
    // Compared here rather than via the kit's `isAttestationExpired`, which takes
    // its own `AttestationMessage` shape. Expiry is one comparison, and owning it
    // beats guessing a type — the lesson this package has already taught twice.
    const expired =
      parsed.data.expirationBlock !== undefined &&
      reference.currentBlock > parsed.data.expirationBlock;

    if (expired && !hasAttestation) {
      return {
        ok: true,
        status: StatusSnapshotSchema.parse({ state: "failed", raw: parsed.data }),
      };
    }

    return {
      ok: true,
      status: StatusSnapshotSchema.parse({
        state: hasAttestation ? "delivered" : "attesting",
        raw: parsed.data,
      }),
    };
  }
}

/**
 * Classify a Circle failure.
 *
 * The kit's taxonomy comes first; only genuinely unrecognised errors fall
 * through to message inspection. `isRetryableError` is what makes a rate limit
 * worth another attempt and an input error not.
 */
function classify(error: unknown): { reason: QuoteFailure; detail: string } {
  const detail = error instanceof Error ? error.message : String(error);
  if (isRateLimitError(error)) return { reason: "rate_limited", detail };
  if (isRetryableError(error)) return { reason: "upstream_error", detail };
  const message = detail.toLowerCase();
  if (message.includes("insufficient") || message.includes("balance")) {
    return { reason: "insufficient_liquidity", detail };
  }
  if (message.includes("unsupported") || message.includes("not supported")) {
    return { reason: "unsupported_pair", detail };
  }
  return { reason: "upstream_error", detail };
}
