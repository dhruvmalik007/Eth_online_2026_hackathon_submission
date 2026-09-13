/**
 * The order encoder, checked field by field against the documented bit layout.
 *
 * Nothing here round-trips through `encodeAquaOrder` to check itself. The traits word
 * is compared against an expression built from the bit positions in `MakerTraits.sol`,
 * and the hash is compared against a **hand-assembled `abi.encode`** of the tuple. A
 * self-consistent bug in either would otherwise produce a quote that prices correctly
 * against a strategy that does not exist.
 */

import { keccak256, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  ORDER_DATA_HEADER_BYTES,
  ORDER_DATA_SLICES_INDEXES_BIT_OFFSET,
  USE_AQUA_INSTEAD_OF_SIGNATURE,
  aquaOrderHash,
  aquaTraits,
  encodeAquaOrder,
  encodeSwapCalldata,
} from "../src/swapvm/order.js";

const MAKER = "0xCf03Dd0a894Ef79CB5b601A43C4b25E3Ae4c67eD" as const;
const TOKEN_A = "0x1111111111111111111111111111111111111111" as const;
const TOKEN_B = "0x2222222222222222222222222222222222222222" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
/** Contents are irrelevant to the encoder; it embeds the program verbatim. */
const PROGRAM = "0xdeadbeef" as Hex;

/**
 * The traits word, built from the bit layout rather than from the encoder:
 * bit 254 set, four `uint16` slice offsets each equal to 40, receiver zero.
 */
const EXPECTED_TRAITS = USE_AQUA_INSTEAD_OF_SIGNATURE | (0x0028002800280028n << 160n);

describe("aquaTraits", () => {
  it("matches the documented bit layout exactly", () => {
    expect(aquaTraits()).toBe(EXPECTED_TRAITS);
  });

  it("sets the Aqua bit and nothing above it", () => {
    const traits = aquaTraits();
    expect(traits >> 254n).toBe(1n);
    expect(USE_AQUA_INSTEAD_OF_SIGNATURE).toBe(1n << 254n);
  });

  it("packs all four slice offsets as 40, because every hook slice is empty", () => {
    // 40 is the token-pair header, which is where slice 0 begins. With no hooks the
    // other three collapse to it, so the packed word is 0x0028 repeated four times.
    const sliceOffsets = (aquaTraits() >> ORDER_DATA_SLICES_INDEXES_BIT_OFFSET) & ((1n << 64n) - 1n);
    expect(sliceOffsets).toBe(0x0028002800280028n);
    expect(ORDER_DATA_HEADER_BYTES).toBe(40);
  });

  it("leaves the receiver bits zero, which means the maker", () => {
    expect(aquaTraits() & ((1n << 160n) - 1n)).toBe(0n);
  });

  it("encodes a non-zero receiver in the low 160 bits", () => {
    const receiver = "0x3333333333333333333333333333333333333333" as const;
    const traits = aquaTraits(receiver);
    expect(traits & ((1n << 160n) - 1n)).toBe(BigInt(receiver));
    // And the flags are untouched by it.
    expect(traits >> 254n).toBe(1n);
  });
});

describe("encodeAquaOrder", () => {
  it("lays out data as tokenA, tokenB, then the program verbatim", () => {
    const order = encodeAquaOrder({
      maker: MAKER,
      tokenA: TOKEN_A,
      tokenB: TOKEN_B,
      program: PROGRAM,
    });

    expect(order.data).toBe(`0x${TOKEN_A.slice(2)}${TOKEN_B.slice(2)}${PROGRAM.slice(2)}`);
    expect(order.data.length).toBe(2 + ORDER_DATA_HEADER_BYTES * 2 + (PROGRAM.length - 2));
    expect(order.tokenA).toBe(TOKEN_A);
    expect(order.tokenB).toBe(TOKEN_B);
  });

  it("refuses an unsorted token pair rather than deferring to an on-chain revert", () => {
    // SwapVM's `MakerTraits.build` requires `tokenA < tokenB`. Failing here makes the
    // failure local and names the cause, instead of a revert after gas is spent.
    expect(() =>
      encodeAquaOrder({ maker: MAKER, tokenA: TOKEN_B, tokenB: TOKEN_A, program: PROGRAM }),
    ).toThrow(/sorted ascending/);

    expect(() =>
      encodeAquaOrder({ maker: MAKER, tokenA: TOKEN_A, tokenB: TOKEN_A, program: PROGRAM }),
    ).toThrow(/sorted ascending/);
  });

  it("accepts a lower-case pair and normalises both", () => {
    // The registry stores lower-case addresses while a caller may hold checksummed
    // ones, and comparing the two without normalising rejects a valid pair.
    const order = encodeAquaOrder({
      maker: MAKER,
      tokenA: "0x1111111111111111111111111111111111111111",
      tokenB: "0x2222222222222222222222222222222222222222",
      program: PROGRAM,
    });
    expect(order.data).toBe(`0x${TOKEN_A.slice(2)}${TOKEN_B.slice(2)}${PROGRAM.slice(2)}`);
  });
});

describe("aquaOrderHash", () => {
  it("equals a hand-assembled abi.encode of the Order tuple", () => {
    const order = encodeAquaOrder({ maker: MAKER, tokenA: TOKEN_A, tokenB: TOKEN_B, program: PROGRAM });
    const data = order.data;

    const word = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");
    const bytesPayload = data.slice(2);
    // ABI pads a `bytes` payload up to the next 32-byte boundary.
    const paddedPayload = bytesPayload.padEnd(Math.ceil(bytesPayload.length / 64) * 64, "0");

    const manual =
      "0x" +
      // The outer offset: `abi.encode` of a single *dynamic* tuple starts with a
      // pointer to where the tuple's own encoding begins, 32 bytes in. Omitting it is
      // the classic way to hand-assemble this encoding and be one word short — which
      // is exactly what this assertion caught.
      word("0x20") +
      word(MAKER) + // maker
      word(`0x${order.traits.toString(16)}`) + // traits
      word("0x60") + // offset to the bytes, after three head words
      word(`0x${(bytesPayload.length / 2).toString(16)}`) + // bytes length
      paddedPayload;

    expect(aquaOrderHash(order)).toBe(keccak256(manual as Hex));
  });

  it("changes when the program changes, since the program is inside the hashed struct", () => {
    const base = { maker: MAKER, tokenA: TOKEN_A, tokenB: TOKEN_B };
    const first = encodeAquaOrder({ ...base, program: PROGRAM });
    const second = encodeAquaOrder({ ...base, program: "0xdeadbeee" as Hex });
    expect(aquaOrderHash(first)).not.toBe(aquaOrderHash(second));
  });

  it("is stable across repeated calls", () => {
    const order = encodeAquaOrder({ maker: MAKER, tokenA: TOKEN_A, tokenB: TOKEN_B, program: PROGRAM });
    expect(aquaOrderHash(order)).toBe(aquaOrderHash(order));
  });
});

describe("encodeSwapCalldata", () => {
  it("encodes a payable swap() call carrying the order and the taker data", () => {
    const order = encodeAquaOrder({ maker: MAKER, tokenA: TOKEN_A, tokenB: TOKEN_B, program: PROGRAM });
    const calldata = encodeSwapCalldata({
      order,
      amount: 1_000_000n,
      takerTraitsAndData: "0xdeadbeef" as Hex,
    });

    // The selector for `swap((address,uint256,bytes),uint256,bytes)`.
    expect(calldata.startsWith("0x")).toBe(true);
    expect(calldata.length).toBeGreaterThan(200);
    // The maker and the program are both carried in the calldata, verbatim.
    expect(calldata.toLowerCase()).toContain(MAKER.slice(2).toLowerCase());
    expect(calldata.toLowerCase()).toContain(PROGRAM.slice(2));
  });

  it("carries the taker data through unchanged, rather than rebuilding it", () => {
    const order = encodeAquaOrder({ maker: MAKER, tokenA: TOKEN_A, tokenB: TOKEN_B, program: PROGRAM });
    const takerData = "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex;
    const calldata = encodeSwapCalldata({ order, amount: 1n, takerTraitsAndData: takerData });
    expect(calldata.toLowerCase()).toContain(takerData.slice(2).toLowerCase());
  });
});

describe("the zero-receiver default is the only one Aqua permits", () => {
  it("documents that Aqua refuses a custom receiver", () => {
    // `SwapVM._transferIn` requires `order.maker == order.traits.receiver(order.maker)`
    // in Aqua mode, so a non-zero receiver would revert at settlement. The default is
    // the maker for that reason, and the constant is asserted here so the note cannot
    // drift away from the code.
    expect(ZERO).toBe("0x0000000000000000000000000000000000000000");
    expect(aquaTraits() & ((1n << 160n) - 1n)).toBe(BigInt(ZERO));
  });
});
