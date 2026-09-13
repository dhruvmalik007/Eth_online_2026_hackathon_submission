import { describe, expect, it } from "vitest";
import {
  TAKER_FLAGS,
  UnsupportedTakerSlice,
  encodeTakerTraits,
  readTakerHeader,
  type TakerTraitsInput,
} from "../src/index.js";

const TAKER = "0x2222222222222222222222222222222222222222" as const;
const RECIPIENT = "0x1111111111111111111111111111111111111111" as const;

/**
 * Hand-assembled from the layout in `TakerTraitsLib.build`, *not* produced by this encoder.
 *
 * ```
 * 0034 0034 0034 0034 0034 0034 0034 0034 0034 0020   nine indexes of 52, then 32
 * 0085                                                 flags = 0x0001 | 0x0004 | 0x0080
 * 0000...0001                                          threshold = 1, 32-byte word
 * 1111...1111                                          recipient, 20 bytes
 * ```
 *
 * 52 = 32 (threshold) + 20 (recipient). The nine identical indexes are the empty slices, all of
 * which end where the recipient does. `TakerTraitsParity.t.sol` asserts this same literal against
 * the contract's own encoder, so a mistake here cannot survive as a mistake on both sides.
 */
const EXPECTED =
  "0x00340034003400340034003400340034003400200085" +
  "0000000000000000000000000000000000000000000000000000000000000001" +
  "1111111111111111111111111111111111111111";

function input(over: Partial<TakerTraitsInput> = {}): TakerTraitsInput {
  return {
    taker: TAKER,
    isExactIn: true,
    isAToB: true,
    threshold: 1n,
    recipient: RECIPIENT,
    preTransferInCallback: true,
    ...over,
  };
}

describe("encodeTakerTraits", () => {
  it("produces the hand-assembled bytes exactly", () => {
    expect(encodeTakerTraits(input())).toBe(EXPECTED);
  });

  it("keeps the header at 22 bytes", () => {
    const encoded = encodeTakerTraits(input());
    // 22 header + 32 threshold + 20 recipient
    expect((encoded.length - 2) / 2).toBe(74);
  });

  it("packs the flags into the low 16 bits, above nothing", () => {
    const { flags } = readTakerHeader(encodeTakerTraits(input()));

    expect(flags).toBe(TAKER_FLAGS.isExactIn | TAKER_FLAGS.hasPreTransferInCallback | TAKER_FLAGS.isAToB);
    expect(flags).toBe(0x0085);
  });

  it("reports the cumulative end offsets", () => {
    const { offsets } = readTakerHeader(encodeTakerTraits(input()));

    expect(offsets).toEqual([32, 52, 52, 52, 52, 52, 52, 52, 52, 52]);
  });

  it("omits the recipient slice when it is the taker, matching the contract", () => {
    // The contract skips this slice, so including it here would shift every later index by 20.
    const { offsets, flags } = readTakerHeader(encodeTakerTraits(input({ recipient: TAKER })));

    expect(offsets[0]).toBe(32);
    expect(offsets[1]).toBe(32);
    expect(flags).toBe(0x0085);
  });

  it("omits the recipient slice when it is the zero address", () => {
    const { offsets } = readTakerHeader(
      encodeTakerTraits(input({ recipient: "0x0000000000000000000000000000000000000000" })),
    );

    expect(offsets[1]).toBe(32);
  });

  it("adds a 5-byte deadline slice and shifts every later index", () => {
    const { offsets } = readTakerHeader(encodeTakerTraits(input({ deadline: 1_800_000_000 })));

    expect(offsets[0]).toBe(32);
    expect(offsets[1]).toBe(52);
    expect(offsets[2]).toBe(57);
    expect(offsets[9]).toBe(57);
  });

  it("omits an explicit zero deadline, which is the contract's own sentinel", () => {
    const { offsets } = readTakerHeader(encodeTakerTraits(input({ deadline: 0 })));

    expect(offsets[2]).toBe(52);
  });

  it("keeps a zero threshold rather than dropping it", () => {
    // A caller who asked for a bound of zero asked for something; dropping the slice would remove
    // their protection and read as "no threshold given".
    const { offsets } = readTakerHeader(encodeTakerTraits(input({ threshold: 0n })));

    expect(offsets[0]).toBe(32);
    expect(encodeTakerTraits(input({ threshold: 0n }))).toContain(
      "0000000000000000000000000000000000000000000000000000000000000000",
    );
  });

  it("omits the threshold slice entirely when none is given", () => {
    // Written literally rather than through `input()`: with `exactOptionalPropertyTypes`, overriding
    // a key to `undefined` is not the same as omitting it, and omitting is what is under test.
    const { offsets } = readTakerHeader(
      encodeTakerTraits({ taker: TAKER, isExactIn: true, isAToB: true, recipient: RECIPIENT }),
    );

    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBe(20);
  });

  it("sets each flag independently", () => {
    const bare = encodeTakerTraits({ taker: TAKER, isExactIn: false, isAToB: false });
    expect(readTakerHeader(bare).flags).toBe(0);

    expect(readTakerHeader(encodeTakerTraits({ taker: TAKER, isExactIn: true, isAToB: false })).flags).toBe(0x0001);
    expect(readTakerHeader(encodeTakerTraits({ taker: TAKER, isExactIn: false, isAToB: true })).flags).toBe(0x0080);
    expect(
      readTakerHeader(encodeTakerTraits({ taker: TAKER, isExactIn: false, isAToB: false, strictThreshold: true })).flags,
    ).toBe(0x0010);
  });

  it("round-trips an exactIn to aB fill", () => {
    const { flags, tail } = readTakerHeader(encodeTakerTraits(input()));

    expect(flags & TAKER_FLAGS.isExactIn).toBeTruthy();
    expect(flags & TAKER_FLAGS.isAToB).toBeTruthy();
    expect(tail.startsWith("0x1111")).toBe(false); // the tail starts with the threshold, not `to`
  });

  it("refuses a negative threshold", () => {
    expect(() => encodeTakerTraits(input({ threshold: -1n }))).toThrow(RangeError);
  });

  it("refuses a threshold wider than uint256", () => {
    // Silently truncating would turn an unreachable bound into a reachable one.
    expect(() => encodeTakerTraits(input({ threshold: 2n ** 256n }))).toThrow(RangeError);
  });

  it("refuses a deadline that does not fit uint40", () => {
    expect(() => encodeTakerTraits(input({ deadline: 2 ** 40 }))).toThrow(RangeError);
  });

  it("refuses slices it cannot index, rather than dropping them", () => {
    // The type stops a literal, not a value assembled from JSON. Dropping a hook would leave the
    // header pointing at bytes that are not where it says they are.
    const fromJson = { ...input(), preTransferInHookData: "0xdead" } as unknown as TakerTraitsInput;

    expect(() => encodeTakerTraits(fromJson)).toThrow(UnsupportedTakerSlice);
  });

  it("refuses taker data shorter than its header", () => {
    expect(() => readTakerHeader("0x0034")).toThrow(RangeError);
  });
});
