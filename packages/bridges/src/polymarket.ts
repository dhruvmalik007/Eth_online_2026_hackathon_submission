/**
 * Polymarket CLOB V2 — the EIP-712 order payload.
 *
 * ## Why the protocol owns this
 *
 * The signing layer in `apps/execution` must not know what Polymarket is. It
 * receives typed data and signs it. Everything that makes an order *valid* —
 * the domain version, the contract, the field order, the numeric `side` —
 * lives here, next to the protocol it belongs to, where it can be checked
 * against fixtures.
 *
 * A wallet-agnostic signer is only genuinely agnostic if the thing it signs is
 * opaque to it.
 *
 * ## Two things that look like mistakes and are not
 *
 * **The signed struct keeps `taker`, `nonce` and `feeRateBps`.** The migration
 * guide's summary says V2 "drops" them, and the SDK's `UserOrderV2` does — but
 * the *signed* payload keeps them, zeroed, because the exchange contract still
 * hashes them. Dropping them from the struct changes the digest and every
 * signature silently fails to verify. Only the SDK's input shape changed.
 *
 * **`expiration` is signed but is not the timestamp.** The guide is explicit:
 * `timestamp` (ms) replaces `nonce` for per-address uniqueness and *is* part of
 * the signed struct; `expiration` is a GTD concern that stays on the wire. They
 * are easy to conflate because both are "when", and conflating them produces an
 * order that posts and never fills.
 */
import { z } from "zod";

/** Signature types, as Polymarket defines them. The funder differs for each. */
export const CLOB_SIGNATURE_TYPES = {
  /** A plain EOA signs and funds. */
  EOA: 0,
  /** A Polymarket proxy wallet holds the funds; the EOA signs. */
  POLY_PROXY: 1,
  /** A Gnosis Safe holds the funds; the EOA signs. */
  POLY_GNOSIS_SAFE: 2,
} as const;

export type ClobSignatureType = (typeof CLOB_SIGNATURE_TYPES)[keyof typeof CLOB_SIGNATURE_TYPES];

/** V2 exchange addresses on Polygon. Chain-specific, so they are data, not code. */
export const CLOB_V2_EXCHANGE: Readonly<Record<"standard" | "negRisk", `0x${string}`>> = {
  standard: "0xE111180000d2663C0091e4f400237545B87B996B",
  negRisk: "0xe2222d279d744050d28e00520010520000310F59",
};

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/**
 * A validated 0x-prefixed hex string of a fixed byte length.
 *
 * The regex is the guard; the cast only tells the compiler what it cannot infer
 * from a pattern. Every field EIP-712 encodes as `address` or `bytes32` wants
 * `0x${string}`, and a plain `string` is rejected — which is the check that
 * stops a placeholder address reaching a signature.
 */
function hexField(bytes: number) {
  return z
    .string()
    .regex(new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`))
    .transform((value) => value as `0x${string}`);
}

export const ClobOrderInputSchema = z.object({
  /** Funds the order. Equals `signer` for EOA; a proxy or Safe address otherwise. */
  maker: hexField(20),
  /** Produces the signature. */
  signer: hexField(20),
  tokenId: z.string().regex(/^\d+$/),
  /** Atomic units. Prices are derived from the ratio, so both must be integers. */
  makerAmount: z.string().regex(/^\d+$/),
  takerAmount: z.string().regex(/^\d+$/),
  side: z.enum(["BUY", "SELL"]),
  signatureType: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  /** Creation time in **milliseconds**. Not an expiry — see the note above. */
  timestampMs: z.number().int().positive(),
  /** GTD expiry. Signed, but not the same field as `timestampMs`. */
  expiration: z.string().regex(/^\d+$/).default("0"),
  /** Public attribution code; zero unless you are a builder. */
  builderCode: hexField(32).default(ZERO_BYTES32),
  metadata: hexField(32).default(ZERO_BYTES32),
  /** Neg-risk markets settle against a different exchange contract. */
  negRisk: z.boolean().default(false),
  salt: z.string().regex(/^\d+$/).optional(),
});

export type ClobOrderInput = z.input<typeof ClobOrderInputSchema>;

/** The EIP-712 payload, ready to hand to any signer. */
export interface ClobOrderTypedData {
  readonly domain: {
    readonly name: "Polymarket CTF Exchange";
    readonly version: "2";
    readonly chainId: number;
    readonly verifyingContract: `0x${string}`;
  };
  readonly types: typeof CLOB_ORDER_TYPES;
  readonly primaryType: "Order";
  readonly message: ClobOrderMessage;
}

/**
 * The message to sign.
 *
 * `uint256` fields are **`bigint`**, not strings. EIP-712 encodes them as
 * 32-byte words, and a decimal string is not encodable — the typechecker caught
 * this, which is the difference between a payload that signs and one that throws
 * at the last step. The wire body is where they become strings again.
 */
export interface ClobOrderMessage {
  readonly salt: bigint;
  readonly maker: `0x${string}`;
  readonly signer: `0x${string}`;
  readonly taker: `0x${string}`;
  readonly tokenId: bigint;
  readonly makerAmount: bigint;
  readonly takerAmount: bigint;
  readonly expiration: bigint;
  readonly nonce: bigint;
  readonly feeRateBps: bigint;
  readonly side: 0 | 1;
  readonly signatureType: ClobSignatureType;
  readonly timestamp: bigint;
  readonly metadata: `0x${string}`;
  readonly builder: `0x${string}`;
}

/**
 * Field order is part of the type hash, so this array is a protocol constant.
 * Reordering it produces a different digest and signatures that fail silently.
 */
const CLOB_ORDER_TYPES = {
  Order: [
    { name: "salt", type: "uint256" },
    { name: "maker", type: "address" },
    { name: "signer", type: "address" },
    { name: "taker", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "makerAmount", type: "uint256" },
    { name: "takerAmount", type: "uint256" },
    { name: "expiration", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "feeRateBps", type: "uint256" },
    { name: "side", type: "uint8" },
    { name: "signatureType", type: "uint8" },
    { name: "timestamp", type: "uint256" },
    { name: "metadata", type: "bytes32" },
    { name: "builder", type: "bytes32" },
  ],
} as const;

/**
 * Build the payload a signer must sign for a CLOB V2 order.
 *
 * Pure: no client, no chain, no key. The `chainId` is a parameter rather than a
 * lookup so this stays testable and so a caller cannot accidentally inherit the
 * wrong network — the domain separator is chain-bound, and a wrong one produces
 * a signature the exchange rejects.
 */
export function clobOrderTypedData(input: ClobOrderInput, chainId: number): ClobOrderTypedData {
  const order = ClobOrderInputSchema.parse(input);

  return {
    domain: {
      name: "Polymarket CTF Exchange",
      version: "2",
      chainId,
      verifyingContract: CLOB_V2_EXCHANGE[order.negRisk ? "negRisk" : "standard"],
    },
    types: CLOB_ORDER_TYPES,
    primaryType: "Order",
    message: {
      // The SDK generates a salt when omitted; a caller supplying one keeps it
      // deterministic across retries, which matters when re-submitting an order
      // that was signed but never accepted.
      salt: BigInt(order.salt ?? String(Date.now())),
      maker: order.maker,
      signer: order.signer,
      taker: ZERO_ADDRESS,
      tokenId: BigInt(order.tokenId),
      makerAmount: BigInt(order.makerAmount),
      takerAmount: BigInt(order.takerAmount),
      expiration: BigInt(order.expiration),
      // V2 removed the nonce system entirely; the field remains in the struct and
      // is always zero.
      nonce: 0n,
      // Fees are set by the protocol at match time, so nothing is embedded here.
      feeRateBps: 0n,
      // Numeric in the signed payload, a string on the wire.
      side: order.side === "BUY" ? 0 : 1,
      signatureType: order.signatureType,
      timestamp: BigInt(order.timestampMs),
      metadata: order.metadata,
      builder: order.builderCode,
    },
  };
}

/**
 * The `order` object for `POST /order`, with the signature attached.
 *
 * Separate from the typed data on purpose: `side` is a **number** when signing
 * and a **string** when posting, and `expiration` appears on the wire even
 * though it is a policy field rather than a uniqueness one. Sending the signed
 * struct verbatim gets both wrong.
 */
export function clobOrderWireBody(
  input: ClobOrderInput,
  signature: string,
): { readonly order: Record<string, unknown> } {
  const order = ClobOrderInputSchema.parse(input);

  // Built from the parsed input rather than from the signed message: the message
  // is bigints, the wire is decimal strings, and JSON-serialising a bigint throws.
  return {
    order: {
      salt: order.salt ?? String(order.timestampMs),
      maker: order.maker,
      signer: order.signer,
      taker: ZERO_ADDRESS,
      tokenId: order.tokenId,
      makerAmount: order.makerAmount,
      takerAmount: order.takerAmount,
      expiration: order.expiration,
      nonce: "0",
      feeRateBps: "0",
      side: order.side,
      signatureType: order.signatureType,
      timestamp: String(order.timestampMs),
      metadata: order.metadata,
      builder: order.builderCode,
      signature,
    },
  };
}
