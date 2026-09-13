/**
 * The capability port — capabilities, never protocols.
 *
 * ## This file moved, and that was the plan
 *
 * It used to live in `packages/bridges/src/port.ts`, which said so:
 *
 * > *"The vocabulary is defined here rather than in `execution-domain` on purpose:
 * > one package needs it today, and extracting an abstraction for a single
 * > consumer is how a shared module ends up shaped around its first user. **It
 * > moves when `packages/oneinch` needs the same types.**"*
 *
 * `packages/oneInch` needs them, so it moved. `packages/bridges/src/port.ts` is
 * now a re-export shim, which keeps every existing import site compiling — no
 * call site changed.
 *
 * ## Nothing here names a vendor
 *
 * LI.FI, LayerZero, Circle, 1inch, Aqua, SwapVM and Morpho are all adapters
 * behind these interfaces, so `apps/execution` can swap one for another without
 * being edited, and a new venue is a new file rather than a change to the service.
 *
 * @remarks
 * Verified against the installed packages, not the docs:
 * - `@layerzerolabs/lz-v2-utilities` ^3.0.168 exports `Options`, `calculateGuid`
 *   and `addressToBytes32`.
 * - `@lifi/sdk` ^4.7.0 is the task-based v4 architecture and expects a storage
 *   adapter (`InMemoryStorage` on a server, never `LocalStorageAdapter`).
 * - `@circle-fin/bridge-kit` ^1.14.1 sits alongside `app-kit` ^1.14.0, which
 *   `packages/arc` already uses.
 */
import { z } from "zod";
import { FeeLineSchema } from "@ethonline2026/execution-domain";

/**
 * Which adapter produced a quote. Used for audit, never for branching.
 *
 * `"1inch"` predates this package: it was already a member when the port lived in
 * `packages/bridges`, which is the clearest evidence the port was designed with
 * this work in mind. `"morpho"` is the one value added, and it covers the whole
 * Morpho family — Vaults, Midnight and Blue — because the id identifies the
 * vendor, and a per-product id would multiply the enum for no gain.
 */
export const SOURCE_IDS = ["1inch", "uniswap", "lifi", "layerzero", "circle-cctp", "morpho"] as const;
export const SourceIdSchema = z.enum(SOURCE_IDS);
export type SourceId = z.infer<typeof SourceIdSchema>;

/** A transaction we have built but not signed — the service signs it. */
export const UnsignedTransactionSchema = z.object({
  chainId: z.number().int().positive(),
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  data: z.string().regex(/^0x[0-9a-fA-F]*$/),
  value: z.string().regex(/^\d+$/),
  gas: z
    .object({
      limit: z.string().regex(/^\d+$/).optional(),
      maxFeePerGas: z.string().regex(/^\d+$/).optional(),
      maxPriorityFeePerGas: z.string().regex(/^\d+$/).optional(),
    })
    .optional(),
});
export type UnsignedTransaction = z.infer<typeof UnsignedTransactionSchema>;

/**
 * One leg of a route.
 *
 * `raw` is carried rather than discarded: when a quote disappoints, the first
 * question is what the provider actually said, and dropping it makes that
 * unanswerable.
 */
export const RouteHopSchema = z.object({
  source: SourceIdSchema,
  /** The provider's own name for this hop, e.g. a bridge slug. */
  protocol: z.string().min(1),
  /**
   * The vault leg reuses `deposit`/`withdraw`, and Aqua's `ship`/`dock` map onto
   * the same two. That is why a new venue needs **no new vocabulary** — the
   * strongest kind of interoperability, and the reason this enum has not grown.
   */
  kind: z.enum(["swap", "bridge", "deposit", "withdraw", "pay"]),
  /**
   * The EVM chain id, where the provider identifies a hop that way.
   *
   * Optional because not every provider does. **CCTP identifies chains by
   * domain**, not chain id, so its adapter cannot state one — and requiring it
   * made every CCTP quote fail validation on a `chainId` of `0`. A domain is the
   * native identifier for that hop, not a missing chain id.
   */
  chainId: z.number().int().positive().optional(),
  fromToken: z.string().min(1),
  toToken: z.string().min(1),
  fromAmount: z.string().regex(/^\d+$/),
  toAmount: z.string().regex(/^\d+$/),
  // The domain's own fee schema, not bare JSON: the `cost` / `bound` / `market`
  // tiers and the `included` flag are what stop a fee being double-counted.
  feeLines: z.array(FeeLineSchema),
  estimatedDurationSec: z.number().int().nonnegative().optional(),
});
export type RouteHop = z.infer<typeof RouteHopSchema>;

/**
 * A quote, with the expiry made mandatory.
 *
 * Every provider's quote expires. Making it optional is how a stale price
 * reaches a signature, so the schema refuses a quote that does not say when it
 * stops being true.
 */
export const QuoteEnvelopeSchema = z.object({
  sourceId: SourceIdSchema,
  hops: z.array(RouteHopSchema).min(1),
  feeLines: z.array(FeeLineSchema),
  expiresAt: z.date(),
  raw: z.unknown(),
});
export type QuoteEnvelope = z.infer<typeof QuoteEnvelopeSchema>;

/**
 * Bridge status.
 *
 * `attesting` is deliberately distinct from `pending`: a bridge is waiting on a
 * verifier, not on a block, and conflating them loses the only signal that
 * explains why a cross-chain leg is slow.
 */
export const STATUS_STATES = ["pending", "attesting", "delivered", "failed"] as const;
export const StatusSnapshotSchema = z.object({
  state: z.enum(STATUS_STATES),
  deliveredTxHash: z.string().optional(),
  attestations: z
    .object({
      required: z.number().int().nonnegative(),
      received: z.number().int().nonnegative(),
    })
    .optional(),
  raw: z.unknown(),
});
export type StatusSnapshot = z.infer<typeof StatusSnapshotSchema>;

/**
 * Why a quote failed — a closed set, so a caller can retry some and abandon
 * others, and the dashboard can say *why* rather than "something went wrong".
 *
 * `insufficient_liquidity` already earns its place twice over: it is both CCTP's
 * and LI.FI's failure mode, and it is exactly how a constrained ERC-4626
 * redemption surfaces. A vault we cannot fully exit needs no new vocabulary.
 */
export const QUOTE_FAILURES = [
  "rate_limited",
  "no_route",
  "insufficient_liquidity",
  "unsupported_pair",
  "expired",
  "upstream_error",
] as const;
export type QuoteFailure = (typeof QUOTE_FAILURES)[number];

/**
 * Quoting is a network operation that fails routinely, so failure is a value
 * rather than an exception. Only genuine bugs throw.
 */
export type QuoteOutcome<Q> =
  | { readonly ok: true; readonly quote: Q }
  | { readonly ok: false; readonly reason: QuoteFailure; readonly detail?: string };

/** The same, for status reads. */
export type StatusOutcome =
  | { readonly ok: true; readonly status: StatusSnapshot }
  | { readonly ok: false; readonly reason: QuoteFailure; readonly detail?: string };

/**
 * Quoting — the capability a swap source and a bridge both have.
 *
 * `supports` exists so the service can ask before quoting, rather than catching
 * an `unsupported_pair` failure it could have predicted.
 */
export interface QuoteSource<Request, Quote> {
  readonly id: SourceId;
  supports(request: Request): boolean;
  quote(request: Request): Promise<QuoteOutcome<Quote>>;
}

/** Building the transaction a quote describes. Separated from quoting (ISP). */
export interface TransactionBuilder<Quote> {
  build(quote: Quote, context: BuildContext): Promise<UnsignedTransaction>;
}

/** Tracking a transfer after it is sent. Separated so quote-only callers avoid it. */
export interface StatusReader<Reference> {
  status(reference: Reference): Promise<StatusOutcome>;
}

/** Everything a builder needs that the quote itself does not carry. */
export interface BuildContext {
  /** The address that will sign — affects allowance and receiver encoding. */
  readonly sender: string;
  /** Recipient, when it differs from the sender. */
  readonly recipient?: string;
  /** Deadline the caller is willing to accept, as a unix timestamp. */
  readonly deadline?: number;
}

/**
 * A bridge, composed from the three capabilities.
 *
 * Composition rather than a fourth interface, so a caller can take a bridge's
 * quoting without taking its status tracking — the asymmetry that makes this
 * design worth having.
 */
export interface BridgeAdapter<Request, Quote, Reference>
  extends QuoteSource<Request, Quote>,
    TransactionBuilder<Quote> {
  status(reference: Reference): Promise<StatusOutcome>;
}
