/**
 * `SignedOfferTaker` — the shape two venues genuinely share.
 *
 * ## Why this exists, and why it is this small
 *
 * Aqua/SwapVM and Morpho Midnight are different protocols from different teams,
 * but they are the same *shape* of market:
 *
 * - **SwapVM** — a maker publishes an `Order` (program bytecode plus traits) and
 *   a taker builds `TakerTraits` and calls `swap(order, tokenIn, tokenOut,
 *   amount, takerData)`. In Aqua mode the order carries no maker signature at all
 *   (`useAquaInsteadOfSignature`); the authorisation is a balance in the Aqua
 *   registry.
 * - **Morpho Midnight** — makers publish signed offers to a Mempool log, a Router
 *   returns executable **takeable offers** for a requested size and slippage, and
 *   the taker consumes them. Offers "do not lock capital and source liquidity only
 *   at settlement".
 *
 * Both are *signed maker offers consumed by a taker*, so a taker implementation
 * has one job either way: ask what is takeable, then build the fill. That is all
 * this interface says. It is deliberately three methods and two types, because an
 * abstraction that grew past the genuinely shared part would be a layer over the
 * existing port rather than a use of it.
 *
 * ## What is *not* here
 *
 * **Morpho Vaults.** A vault is a standard ERC-4626 position — `deposit`,
 * `redeem`, `convertToAssets` — with no offer book and no taker. It implements
 * `QuoteSource` and `TransactionBuilder` directly, and forcing it through this
 * port to make the picture tidier would be exactly backwards. The two shapes are
 * kept apart precisely because only one of them is shared.
 *
 * ## Where this goes next
 *
 * This is the seam a third offer venue plugs into without touching either
 * existing adapter, and it is why `OfferVenue` is a closed union rather than a
 * free string: adding a venue should be a deliberate act that changes a type,
 * not a value that appears at runtime.
 */

import type { Address } from "./chains/address.js";
import type { BuildContext, QuoteOutcome, SourceId, UnsignedTransaction } from "./port.js";

/** The venues whose markets are order books of signed offers. */
export const OFFER_VENUES = ["swapvm", "morpho-midnight"] as const;
export type OfferVenue = (typeof OFFER_VENUES)[number];

/**
 * A maker's offer, as a taker sees it.
 *
 * `bytes` is opaque on purpose. The two venues encode an order completely
 * differently — SwapVM packs a program and traits into a struct, Midnight packs a
 * market, a maturity and a unit price — and the point of carrying it verbatim is
 * that the *only* correct calldata for a quoted offer comes from the venue that
 * produced it. Re-encoding it here would be a second implementation that can
 * disagree with the first, and the disagreement would surface as a reverted fill
 * after the quote had already been trusted.
 *
 * `expiresAt` is not optional, matching `QuoteEnvelope`. A signed offer without
 * an expiry cannot be safely acted on, and making the field mandatory is the
 * cheapest way to guarantee the taker knows when it has gone stale.
 */
export interface SignedOffer<Payload> {
  readonly venue: OfferVenue;
  readonly maker: Address;
  /** The maker's order, encoded by the venue. Passed through, never rebuilt. */
  readonly orderBytes: `0x${string}`;
  readonly expiresAt: Date;
  /**
   * What the venue says the offer is, in typed form.
   *
   * A generic parameter rather than a union so each adapter declares its own
   * shape: a SwapVM payload is a program and a strategy hash, a Midnight payload
   * is a market, a maturity and a unit price. A union here would force both
   * adapters to know about each other's fields.
   */
  readonly payload: Payload;
}

/**
 * Taking offers.
 *
 * `takeable` mirrors Midnight's own Router vocabulary — "executable takeable
 * offers for the requested size and slippage" — which is also exactly what a
 * taker needs from SwapVM: an offer it can fill *now*, at a bounded price, rather
 * than a mid-price that will not survive execution.
 *
 * `supports` is here for the same reason it is on `QuoteSource`: the service
 * should be able to ask whether a venue can serve a request rather than discover
 * it by catching an `unsupported_pair` failure it could have predicted.
 *
 * Failure is a value, as everywhere else in this port: no offers is
 * `{ok: false, reason: "insufficient_liquidity"}`, not a thrown error.
 */
export interface SignedOfferTaker<Request, Offer> {
  readonly source: SourceId;
  supports(request: Request): boolean;
  /** The offers executable for this size and slippage bound, best first. */
  takeable(request: Request): Promise<QuoteOutcome<readonly Offer[]>>;
  /** The transaction that consumes one offer. */
  buildFill(offer: Offer, context: BuildContext): Promise<UnsignedTransaction>;
}
