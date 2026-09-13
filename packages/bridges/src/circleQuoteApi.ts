/**
 * The Circle Quote API reader — the binding for {@link CctpQuoteReader}.
 *
 * Verified against Circle's API reference for
 * `POST /v2/quote/burn/usdc/{sourceDomainId}/{destDomainId}`. Two details in the
 * response are load-bearing, and both fixed something the adapter previously had
 * to guess:
 *
 * ## 1. The fee's USD value comes from the API, not an oracle
 *
 * The fee is denominated in a **token** — native gas by default, or the source
 * chain's USDC if asked. `metadata.exchangeRates.feeTokenUsd` gives the rate
 * Circle applied, so `feeTotalAmount × feeTokenUsd` is the dollar figure without
 * this service needing a price feed of its own.
 *
 * ## 2. The expiry is Circle's, and may be a block number
 *
 * `issuedAt` plus `expiry` — where `expiry.mode` is `TIMESTAMP` or
 * `BLOCK_NUMBER` — is authoritative. The reference says explicitly to compute
 * remaining validity **from `issuedAt` rather than the client clock**, so the
 * adapter now uses the quote's own expiry instead of a made-up window.
 *
 * ## Standard transfers have no quote
 *
 * Fees apply to **Fast Transfers only**; a Standard transfer is free. So a
 * standard request prices at zero *without calling the API* — `requests` requires
 * at least one element, meaning there is genuinely nothing to ask for.
 */
import { z } from "zod";
import type { CctpChain, CctpQuoteReader, CctpSpeed } from "./circleCctp.js";

/** The fee types Circle prices. `FORWARD` is the Forwarding Service. */
const PRE_FINALITY = "PRE_FINALITY" as const;
const FORWARD = "FORWARD" as const;

/**
 * The response, using the field names from the API reference.
 *
 * `expiry` is a discriminated union on `mode`: a wall-clock `expiresAt`, or an
 * `expiresAtBlock` with an advisory `blockEstimatedAt`. Both are modelled because
 * a block-number expiry cannot be compared against a clock.
 */
const ExpirySchema = z.union([
  z.object({ mode: z.literal("TIMESTAMP"), expiresAt: z.number() }),
  z.object({
    mode: z.literal("BLOCK_NUMBER"),
    expiresAtBlock: z.number(),
    blockEstimatedAt: z.number().optional(),
  }),
]);

const QuoteSchema = z.object({
  signedQuote: z.string(),
  issuedAt: z.number(),
  expiry: ExpirySchema,
  feeTotalAmount: z.string(),
  feeToken: z.string(),
  items: z.array(z.object({ type: z.string(), amount: z.string() })).optional(),
  nonce: z.string().optional(),
  metadata: z
    .object({
      exchangeRates: z
        .object({ feeTokenUsd: z.string().optional(), destinationTokenUsd: z.string().optional() })
        .optional(),
    })
    .optional(),
});

const ErrorSchema = z.object({ errorCode: z.string().optional(), error: z.string().optional() });

export interface CircleQuoteApiConfig {
  /**
   * API key, if your account requires one.
   *
   * The published reference shows **no auth header** on this endpoint, so the key
   * is optional and only sent when present — sending a guessed header name to an
   * endpoint that does not want one is its own failure mode.
   */
  readonly apiKey?: string;
  /** Defaults to Circle's production IRIS host; the sandbox uses `-sandbox`. */
  readonly baseUrl?: string;
  /**
   * CCTP **domain ids** per chain.
   *
   * These are Circle's protocol constants and are not EVM chain ids — the API
   * takes domains. Supplied as config rather than imported from `packages/arc`
   * so this package keeps no cross-package dependency.
   */
  readonly domainByChain: Readonly<Record<CctpChain, number>>;
  /** Send a `FORWARD` request too, for destination-chain forwarding. */
  readonly includeForwardingService?: boolean;
  /**
   * Decimals of the token the fee is denominated in.
   *
   * Defaults to **18**, because the request omits `feeToken` and Circle then
   * prices in the source chain's native gas token — 18 decimals on every EVM
   * chain. Set to 6 if you ask for the fee in USDC instead.
   */
  readonly feeTokenDecimals?: number;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export class CircleQuoteApiReader implements CctpQuoteReader {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  /** Resolved once so the scaling cannot silently become `10 ** undefined`. */
  private readonly feeTokenDecimals: number;

  constructor(private readonly config: CircleQuoteApiConfig) {
    this.baseUrl = config.baseUrl ?? "https://iris-api.circle.com";
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.feeTokenDecimals = config.feeTokenDecimals ?? 18;
  }

  async quote(input: {
    readonly from: CctpChain;
    readonly to: CctpChain;
    readonly amount: string;
    readonly recipient: string;
    readonly speed: CctpSpeed;
  }): Promise<{
    feeUsd: number;
    feeAmount: string;
    estimatedDurationSec: number;
    expiresAt: Date;
    raw: unknown;
  }> {
    const fromDomain = this.config.domainByChain[input.from];
    const toDomain = this.config.domainByChain[input.to];
    if (fromDomain === undefined || toDomain === undefined) {
      throw new Error(
        `No CCTP domain configured for ${input.from} → ${input.to}. Domains are Circle protocol constants, not chain ids.`,
      );
    }
    if (fromDomain === toDomain) {
      throw new Error("CCTP cannot quote a transfer within one domain — the API rejects it.");
    }

    // Standard transfers carry no upfront fee, so there is nothing to price and
    // nothing to send. The API requires at least one request type, so calling it
    // here would be an error rather than a zero quote.
    //
    // The enum says `SLOW` where Circle's prose says "Standard" — the same tier
    // under two names, confirmed against the installed types.
    if (input.speed !== "FAST") {
      return {
        feeUsd: 0,
        feeAmount: "0",
        estimatedDurationSec: 900,
        expiresAt: new Date(Date.now() + 900_000),
        raw: { priced: false, reason: "standard transfers carry no upfront fee" },
      };
    }

    const requests = [
      { type: PRE_FINALITY },
      ...(this.config.includeForwardingService === true ? [{ type: FORWARD }] : []),
    ];

    const response = await this.fetchImpl(
      `${this.baseUrl}/v2/quote/burn/usdc/${fromDomain}/${toDomain}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey === undefined
            ? {}
            : { authorization: `Bearer ${this.config.apiKey}` }),
        },
        // `feeToken` is omitted, which defaults to the zero address — fees in the
        // source chain's native gas token. The response's exchange rate is what
        // makes that comparable in USD.
        body: JSON.stringify({ amount: input.amount, requests }),
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      const parsed = ErrorSchema.safeParse(safeJson(detail));
      const message = parsed.success ? parsed.data.error : undefined;
      throw new Error(
        `Circle rejected the quote request (${response.status})${message === undefined ? "" : `: ${message}`}`,
      );
    }

    const parsed = QuoteSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("Circle returned a quote this package could not read.");
    }
    const quote = parsed.data;

    // `feeTotalAmount` is in the fee token's **minor units**, so it must be
    // scaled before it means anything in USD. Skipping this is how a real
    // $0.0001 fee reads as 1e14 — caught by the testnet harness, not by a unit
    // test, because no fixture would have had the right scale either.
    const rate = Number(quote.metadata?.exchangeRates?.feeTokenUsd ?? "0");
    const amount = Number(quote.feeTotalAmount) / 10 ** this.feeTokenDecimals;
    const feeUsd = Number.isFinite(rate) && Number.isFinite(amount) ? amount * rate : 0;

    return {
      feeUsd,
      feeAmount: quote.feeTotalAmount,
      // Rough, and deliberately documented as such: a fast transfer is
      // faster-than-finality, which is seconds-to-minutes, not exact.
      estimatedDurationSec: 120,
      expiresAt: expiryToDate(quote.issuedAt, quote.expiry),
      raw: quote,
    };
  }
}

/**
 * The quote's expiry as a `Date`.
 *
 * A `BLOCK_NUMBER` expiry has no wall-clock time of its own, so the advisory
 * `blockEstimatedAt` is used — and when even that is absent the fallback is
 * conservative (two minutes from issue), because submitting after expiry reverts
 * and that is the failure worth avoiding.
 */
function expiryToDate(
  issuedAt: number,
  expiry: z.infer<typeof ExpirySchema>,
): Date {
  if (expiry.mode === "TIMESTAMP") return new Date(expiry.expiresAt * 1000);
  if (expiry.blockEstimatedAt !== undefined) return new Date(expiry.blockEstimatedAt * 1000);
  return new Date((issuedAt + 120) * 1000);
}

/** Parse a body that may not be JSON, without throwing. */
function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
