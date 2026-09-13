/**
 * The EIP-712 typed data a SwapVM maker signs, and the digest it produces.
 *
 * ## The thing that is easy to get wrong
 *
 * SwapVM hashes an order **two different ways** depending on how it will be authorised, and picking
 * the wrong one produces a signature that fails verification on-chain with no indication why:
 *
 * | Mode | `traits.useAquaInsteadOfSignature()` | `hash(order)` |
 * |---|---|---|
 * | Aqua | `true` | `keccak256(abi.encode(order))` — **not** EIP-712 |
 * | Signature | `false` | `_hashTypedDataV4(structHash)` — what this file builds |
 *
 * An Aqua order needs no signature at all: the maker pre-committed the balances by shipping them, so
 * there is nothing for them to authorise later. That is why `encodeAquaOrder` in
 * `@ethonline2026/oneinch-aqua` computes the first hash and this file computes the second — and why
 * conflating them is a mistake that looks like a bad key.
 *
 * ## Where the signature goes
 *
 * It is supplied by the **taker**, not the maker: `SwapVM.swap` reads it from
 * `takerTraits.signature(takerData)` and calls `order.maker.recoverOrIsValidSignature(orderHash, sig)`.
 * `recoverOrIsValidSignature` falls back to ERC-1271, so a Safe, an EIP-7702 account or a Privy smart
 * wallet can be the maker — which is the case this repository actually runs. The maker signs
 * off-chain; the taker carries the result.
 *
 * ## Provenance
 *
 * `ORDER_TYPEHASH` is `keccak256("Order(address maker,uint256 traits,bytes data)")`, read from
 * `SwapVM.sol`'s own constant rather than reconstructed, and pinned here as a literal so a divergence
 * fails loudly. `TakerTraitsParity`-style tests assert both ends against this value.
 */

import { hashTypedData, keccak256, toHex } from "viem";
import type { Eip712TypedData } from "../eip712.js";

/** The struct source, exactly as `SwapVM.sol` declares it. */
export const SWAP_VM_ORDER_TYPE = "Order(address maker,uint256 traits,bytes data)";

/**
 * `SwapVM.ORDER_TYPEHASH`.
 *
 * Pinned as a literal rather than computed, so that a change upstream is a failing test rather than a
 * silently different digest.
 */
export const SWAP_VM_ORDER_TYPEHASH =
  "0x4ff6e0f284e5bda3bffd2bfd3adc9a8f89d4c787c8be730b8c214c0e10bb3d40" as const;

/** The struct definition, in the shape custody's signers already speak. */
export const SWAP_VM_ORDER_TYPES: Record<string, { readonly name: string; readonly type: string }[]> = {
  Order: [
    { name: "maker", type: "address" },
    { name: "traits", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
};

export interface SwapVmOrder {
  readonly maker: string;
  readonly traits: bigint;
  readonly data: string;
}

export interface SwapVmDomain {
  /** The router's EIP-712 name, from its constructor. */
  readonly name: string;
  /** The router's EIP-712 version, from its constructor. */
  readonly version: string;
  readonly chainId: number;
  /** The deployed router — the address a signature is bound to, so it cannot be replayed elsewhere. */
  readonly verifyingContract: string;
}

/**
 * The payload a maker signs.
 *
 * `verifyingContract` is the router, so a signature is bound to one deployment: the same order signed
 * for a testnet router does not authorise anything on mainnet, and a redeployed router invalidates
 * signatures made for the old one.
 */
export function swapVmOrderTypedData(input: {
  readonly order: SwapVmOrder;
  readonly domain: SwapVmDomain;
}): Eip712TypedData {
  return {
    domain: {
      name: input.domain.name,
      version: input.domain.version,
      chainId: input.domain.chainId,
      verifyingContract: input.domain.verifyingContract,
    },
    // `EIP712Domain` is deliberately absent: viem derives it, and leaving it in is the difference
    // between a valid digest and a plausible one.
    types: { Order: [...SWAP_VM_ORDER_TYPES["Order"]!] },
    primaryType: "Order",
    message: {
      maker: input.order.maker,
      traits: input.order.traits,
      data: input.order.data,
    },
  };
}

/** The digest a signature-mode order must be signed over. */
export function hashSwapVmOrder(input: {
  readonly order: SwapVmOrder;
  readonly domain: SwapVmDomain;
}): `0x${string}` {
  return hashTypedData({
    domain: {
      name: input.domain.name,
      version: input.domain.version,
      chainId: input.domain.chainId,
      verifyingContract: input.domain.verifyingContract as `0x${string}`,
    },
    types: {
      Order: [
        { name: "maker", type: "address" },
        { name: "traits", type: "uint256" },
        { name: "data", type: "bytes" },
      ],
    },
    primaryType: "Order",
    message: {
      maker: input.order.maker as `0x${string}`,
      traits: input.order.traits,
      data: input.order.data as `0x${string}`,
    },
  });
}

/** Confirms this module's typehash constant still matches the struct source it claims to describe. */
export function orderTypehashMatchesSource(): boolean {
  return keccak256(toHex(SWAP_VM_ORDER_TYPE)) === SWAP_VM_ORDER_TYPEHASH;
}
