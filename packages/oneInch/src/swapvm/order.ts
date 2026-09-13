/**
 * SwapVM orders, encoded for the Aqua path.
 *
 * ## Why this file exists and what it deliberately does not cover
 *
 * A SwapVM `Order` is a maker address, a packed 256-bit traits word, and a `bytes`
 * blob holding the token pair followed by the program. Every field is load-bearing
 * and none of it is validated on-chain: a traits word with the wrong bit set changes
 * *where the proceeds go* or *whether a signature is required at all*.
 *
 * This implements the **Aqua case only** — `useAquaInsteadOfSignature = true`, no
 * hooks, no custom receiver, no WETH unwrapping. That is the case the flight uses,
 * and it is genuinely simpler: with every hook slice empty, the four `uint16` data
 * offsets all collapse to the same value, so the traits word reduces to
 *
 * ```
 * bits 255..0
 *   254         USE_AQUA_INSTEAD_OF_SIGNATURE
 *   160..223    four uint16 slice offsets, each equal to 40 (the 20-byte tokenA plus
 *               20-byte tokenB header, which is where slice 0 begins)
 *   0..159      receiver, zero meaning "the maker"
 * ```
 *
 * The signature-mode path (EIP-712, hooks, `ORDER_TYPEHASH`) is **not** implemented
 * here. It is a different encoding with a different hash, and half of it would be
 * worse than none: a traits word that looked right but omitted a hook flag would take
 * a trade and skip the maker's hook. The general encoder belongs in its own change,
 * against `MakerTraits.build` in full.
 *
 * ## The hash must match the contract, or nothing settles
 *
 * `SwapVM.hash` for an Aqua order is `keccak256(abi.encode(order))` — the whole struct,
 * not a typed-data digest. The shipped strategy's identity **is** that hash, so a
 * mismatch between this function and the contract would make every quote succeed and
 * every settlement fail with "strategy not found". It is asserted against a
 * hand-computed value in `test/order.test.ts` for that reason.
 */

import { encodeAbiParameters, encodeFunctionData, keccak256, type Hex } from "viem";
import type { Address } from "../chains/address.js";

/** `useAquaInsteadOfSignature` — bit 254. Orders using it are hashed, not signed. */
export const USE_AQUA_INSTEAD_OF_SIGNATURE = 1n << 254n;

/** Where the packed hook-slice offsets begin in the traits word. */
export const ORDER_DATA_SLICES_INDEXES_BIT_OFFSET = 160n;

/**
 * The token-pair header every order's `data` starts with: `tokenA ++ tokenB`.
 *
 * Both are 20 bytes, so slice 0 begins at byte 40 — which is exactly why the empty
 * case's four offsets are all 40.
 */
export const ORDER_DATA_HEADER_BYTES = 40;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/**
 * The Aqua order: `maker`, packed `traits`, and `data`.
 *
 * `data` is opaque to viem, which is right — the program inside it is bytecode.
 */
export interface AquaOrder {
  readonly maker: Address;
  readonly traits: bigint;
  readonly data: Hex;
  /** The token pair, carried separately so a caller does not re-parse `data`. */
  readonly tokenA: Address;
  readonly tokenB: Address;
}

export interface AquaOrderInput {
  readonly maker: Address;
  /** Must be strictly less than `tokenB`; SwapVM's builder requires a sorted pair. */
  readonly tokenA: Address;
  readonly tokenB: Address;
  /** The compiled program, e.g. from `buildYieldBandFlight`. */
  readonly program: Hex;
  /** Defaults to the maker, encoded as zero — the only receiver Aqua permits. */
  readonly receiver?: Address;
}

/** The `Order` tuple, as `ISwapVM` sees it. */
const ORDER_ABI = [
  { name: "maker", type: "address" },
  { name: "traits", type: "uint256" },
  { name: "data", type: "bytes" },
] as const;

/** The subset of `ISwapVM` this package calls. */
export const SWAP_VM_ABI = [
  {
    type: "function",
    name: "swap",
    stateMutability: "payable",
    inputs: [
      { name: "order", type: "tuple", components: ORDER_ABI },
      { name: "amount", type: "uint256" },
      { name: "takerTraitsAndData", type: "bytes" },
    ],
    outputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOut", type: "uint256" },
      { name: "orderHash", type: "bytes32" },
    ],
  },
  {
    // The static-call read. Declared alongside `swap` on purpose: a quote and a fill that answer
    // differently is the whole risk for a caller approving a number, so both live in one ABI where a
    // change to either is visible next to the other.
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [
      { name: "order", type: "tuple", components: ORDER_ABI },
      { name: "amount", type: "uint256" },
      { name: "takerTraitsAndData", type: "bytes" },
    ],
    outputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOut", type: "uint256" },
      { name: "orderHash", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "hash",
    stateMutability: "view",
    inputs: [{ name: "order", type: "tuple", components: ORDER_ABI }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "flightOpcode",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

/**
 * Pack the traits word for the Aqua case.
 *
 * Exposed separately from {@link encodeAquaOrder} because the traits word is the part
 * worth unit-testing on its own: a wrong bit here is silent, and it decides who
 * receives the maker's tokens.
 */
export function aquaTraits(receiver: Address = ZERO_ADDRESS): bigint {
  // Four empty hook slices, all starting at byte 40. Packed high-to-low as
  // index3, index2, index1, index0 — all equal here, so the order does not show, but
  // the layout is stated so a future hook-carrying encoder cannot get it backwards.
  const sliceOffset = ORDER_DATA_HEADER_BYTES;
  const indexes =
    (BigInt(sliceOffset) << 48n) | (BigInt(sliceOffset) << 32n) | (BigInt(sliceOffset) << 16n) | BigInt(sliceOffset);

  return USE_AQUA_INSTEAD_OF_SIGNATURE | (indexes << ORDER_DATA_SLICES_INDEXES_BIT_OFFSET) | BigInt(receiver);
}

/**
 * Encode an Aqua order.
 *
 * @throws {Error} when `tokenA >= tokenB`. SwapVM's own builder reverts on an unsorted
 *   pair, so failing here turns an on-chain revert into a local one — and the check is
 *   the same comparison, so it cannot disagree with the contract.
 */
export function encodeAquaOrder(input: AquaOrderInput): AquaOrder {
  const tokenA = input.tokenA.toLowerCase();
  const tokenB = input.tokenB.toLowerCase();

  if (tokenA >= tokenB) {
    throw new Error(
      `Aqua order tokens must be sorted ascending: got tokenA=${input.tokenA} tokenB=${input.tokenB}. ` +
        `SwapVM's MakerTraits.build requires tokenA < tokenB and reverts otherwise.`,
    );
  }

  const receiver = input.receiver ?? ZERO_ADDRESS;
  // `concat` rather than `encodePacked`: the header is raw 20-byte addresses with no
  // padding, which is exactly what `abi.encodePacked(address, address)` produces.
  const data = `0x${tokenA.slice(2)}${tokenB.slice(2)}${input.program.slice(2)}` as Hex;

  return {
    maker: input.maker,
    traits: aquaTraits(receiver),
    data,
    tokenA: tokenA as Address,
    tokenB: tokenB as Address,
  };
}

/**
 * The order's identity — which is also the shipped strategy's hash.
 *
 * `keccak256(abi.encode(order))`, matching `SwapVM.hash` for the Aqua branch. Must
 * agree with the contract byte for byte: the Aqua balances are keyed by this value,
 * so a mismatch means a quote that prices correctly against a position that does not
 * exist.
 */
export function aquaOrderHash(order: Pick<AquaOrder, "maker" | "traits" | "data">): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "tuple", components: ORDER_ABI }], [
      { maker: order.maker, traits: order.traits, data: order.data },
    ]),
  );
}

/**
 * Calldata for the taker side.
 *
 * `takerTraitsAndData` is passed through rather than built here. Its encoding is a
 * 176-bit header plus up to ten variable slices, and an independent implementation of
 * it would be a second thing that can disagree with the contract about a swap's
 * direction and slippage bound. It is supplied by the composition root, the same way
 * `packages/bridges` injects its fee readers rather than embedding an ABI.
 */
export function encodeSwapCalldata(input: {
  readonly order: Pick<AquaOrder, "maker" | "traits" | "data">;
  readonly amount: bigint;
  readonly takerTraitsAndData: Hex;
}): Hex {
  return encodeFunctionData({
    abi: SWAP_VM_ABI,
    functionName: "swap",
    args: [
      { maker: input.order.maker, traits: input.order.traits, data: input.order.data },
      input.amount,
      input.takerTraitsAndData,
    ],
  });
}
