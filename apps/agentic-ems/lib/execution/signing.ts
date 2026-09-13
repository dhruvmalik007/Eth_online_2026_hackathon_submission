import type { ChainKey } from "./types";

/**
 * Signing shapes per leg kind.
 *
 * This file records two things that are easy to get wrong and expensive to get
 * wrong, because they are what the user actually authorises:
 *
 * CAVEAT A — **Polymarket CLOB V2 removed fields from the signed struct.**
 * `taker`, `expiration`, `nonce` and `feeRateBps` are gone; `timestamp` (ms),
 * `metadata` and `builder` were added, and the exchange EIP-712 domain version
 * moved from "1" to "2". V1-signed orders no longer work against production. A UI
 * that renders an 11-field order but signs a 12-field one is a security bug.
 *
 * CAVEAT B — **`@polymarket/client/privy` is a SERVER adapter.** It is backed by
 * `@privy-io/node` and needs a Privy wallet the *server* can sign with. Our user's
 * wallet is a browser `@privy-io/react-auth` embedded wallet, so the correct
 * adapter for us is `@polymarket/client/viem` with Privy's viem wallet client.
 */

/* ── Polymarket CLOB V2 ────────────────────────────────────────────────────── */

export const POLYMARKET_CHAIN_ID = 137;

/** Selected by `neg_risk` from `GET /book` — never hardcoded to one of them. */
export const POLYMARKET_EXCHANGE = {
  standard: "0xE111180000d2663C0091e4f400237545B87B996B",
  negRisk: "0xe2222d279d744050d28e00520010520000310F59",
} as const;

export const POLYMARKET_COLLATERAL = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB"; // pUSD
export const POLYMARKET_CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";

/**
 * 0 EOA · 1 POLY_PROXY · 2 GNOSIS_SAFE · 3 DEPOSIT_WALLET (ERC-1271 + ERC-7739).
 *
 * Our Privy smart wallet is a Safe, so 2 is the intended value — but see the
 * risk note: whether Polymarket accepts an *externally created* Safe as `maker`
 * is not documented and must be prototyped.
 */
export enum PolymarketSignatureType {
  EOA = 0,
  PolyProxy = 1,
  GnosisSafe = 2,
  DepositWallet = 3,
}

export type PolymarketSide = "BUY" | "SELL";
export type PolymarketOrderType = "GTC" | "GTD" | "FOK" | "FAK";

/** Verbatim V2 signed struct — 11 fields. */
export const POLYMARKET_ORDER_TYPES = {
  Order: [
    { name: "salt", type: "uint256" },
    { name: "maker", type: "address" },
    { name: "signer", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "makerAmount", type: "uint256" },
    { name: "takerAmount", type: "uint256" },
    { name: "side", type: "uint8" },
    { name: "signatureType", type: "uint8" },
    { name: "timestamp", type: "uint256" },
    { name: "metadata", type: "bytes32" },
    { name: "builder", type: "bytes32" },
  ],
} as const;

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

/** Amounts are 6-decimal integers on both sides of the book. */
const COLLATERAL_DECIMALS = 6;
const UNIT = 10n ** BigInt(COLLATERAL_DECIMALS);

export interface PolymarketOrderInput {
  tokenId: string;
  side: PolymarketSide;
  /** Limit price in collateral per share, 0–1. */
  price: number;
  /** Number of shares. */
  size: number;
  maker: string;
  signer: string;
  signatureType: PolymarketSignatureType;
  negRisk: boolean;
  salt: bigint;
  timestampMs: number;
  /** Optional builder attribution code. */
  builder?: string;
}

/**
 * Build the EIP-712 payload the user signs. BUY: `makerAmount` is the collateral
 * spent and `takerAmount` the shares received; SELL is inverted. Tick-size
 * rounding is applied by the caller against the market's `tick_size`.
 */
export function buildPolymarketOrder(input: PolymarketOrderInput) {
  const shares = BigInt(Math.round(input.size * 1e6));
  const collateral = BigInt(Math.round(input.price * input.size * 1e6));
  const buying = input.side === "BUY";

  const message = {
    salt: input.salt.toString(),
    maker: input.maker,
    signer: input.signer,
    tokenId: input.tokenId,
    makerAmount: (buying ? collateral : shares).toString(),
    takerAmount: (buying ? shares : collateral).toString(),
    side: buying ? 0 : 1,
    signatureType: input.signatureType,
    timestamp: String(input.timestampMs),
    metadata: ZERO_BYTES32,
    builder: input.builder ?? ZERO_BYTES32,
  };

  return {
    primaryType: "Order" as const,
    domain: {
      name: "Polymarket CTF Exchange",
      // "2" — V1 ("1") orders are rejected by production.
      version: "2",
      chainId: POLYMARKET_CHAIN_ID,
      verifyingContract: input.negRisk
        ? POLYMARKET_EXCHANGE.negRisk
        : POLYMARKET_EXCHANGE.standard,
    },
    types: POLYMARKET_ORDER_TYPES,
    message,
  };
}

export function polymarketUnit(): bigint {
  return UNIT;
}

/* ── Safe batch ────────────────────────────────────────────────────────────── */

/**
 * `@safe-global/protocol-kit`'s `createTransaction({ transactions })` wraps more
 * than one call into a `MultiSend` automatically, and `getTransactionHash()`
 * yields the EIP-712 `safeTxHash` over
 * `SafeTx{to,value,data,operation,safeTxGas,baseGas,gasPrice,gasToken,refundReceiver,nonce}`.
 * `operation: 0` = CALL, `1` = DELEGATECALL (MultiSend uses 1).
 */
export const SAFE_MULTISEND_OPERATION = 1;

export interface SafeBatchCall {
  to: string;
  value: string;
  data: string;
  operation: 0 | 1;
}

/* ── Deterministic digests ─────────────────────────────────────────────────── */

/**
 * Deterministic stand-in for a real keccak hash while the adapter is simulated.
 * Seeded so two runs of the same plan produce the same digest — which is what
 * makes the "read = sign" demo reproducible and screenshot-stable.
 */
export function deterministicHex(seed: string, bytes = 32): `0x${string}` {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i += 1) {
    h1 ^= seed.charCodeAt(i);
    h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = (Math.imul(h2 ^ seed.charCodeAt(i), 2246822519) + i) >>> 0;
  }
  let out = "";
  let a = h1;
  let b = h2;
  while (out.length < bytes * 2) {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    b = (Math.imul(b, 22695477) + 1) >>> 0;
    out += a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
  }
  return `0x${out.slice(0, bytes * 2)}`;
}

export function safeBatchDigest(planSeed: string): `0x${string}` {
  return deterministicHex(`safeTxHash:${planSeed}`);
}

export function eip5792Digest(planSeed: string): `0x${string}` {
  return deterministicHex(`eip5792:${planSeed}`);
}

export const SOURCE_CHAIN: ChainKey = "base";
