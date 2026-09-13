/**
 * `takerTraitsAndData` — the taker side of a SwapVM fill.
 *
 * ## Why this exists at all
 *
 * The maker's side of an order is a program; the taker's side is a traits word and a list of slices.
 * Both encode the same kind of thing — direction, a bound, a recipient — and both fail *silently*
 * when they disagree with the contract: a wrong direction bit swaps what is bought for what is sold,
 * and a wrong threshold means no protection at all. So it is pinned against the contract's own
 * encoding rather than reasoned about.
 *
 * ## The wire format
 *
 * Derived from `TakerTraitsLib.build`, not from the documentation:
 *
 * ```
 * bytes  0..21   uint176 = [ 10 x uint16 indexes ][ uint16 flags ]   (big-endian)
 * bytes 22..     threshold | to | deadline | hooks | callbacks | instructionsArgs | signature
 * ```
 *
 * The 22-byte header packs the **indexes above the flags**: index 0 occupies bits 16..31, index 9
 * occupies bits 160..175, and the flags are the low 16 bits. Each index is the **end offset** of its
 * slice, measured from the start of the tail (byte 22), so slice `i` spans
 * `index[i-1] .. index[i]` with `index[-1] == 0`. The final slice is not indexed at all — it runs to
 * the end of the data.
 *
 * That is why `index0` equals the threshold's *length*: slice 0 starts at zero. Reading it as an
 * offset without noticing that would produce a header that is internally consistent and wrong.
 *
 * ## Why unsupported slices throw
 *
 * Only the threshold, recipient and deadline slices are implemented — the three a flight needs. The
 * hooks, callbacks and `instructionsArgs` are not, and a partial encoder that quietly omitted them
 * would emit a header whose indexes point at the wrong bytes: the taker would be charged against a
 * threshold read from part of a hook. Refusing is the only failure mode that cannot be misread.
 */

import type { Address } from "../chains/address.js";

/** A 0x-prefixed hex string. */
type Hex = `0x${string}`;

/**
 * The flag bits, taken from `TakerTraitsLib` with their line numbers.
 *
 * Only the bits this encoder can set are listed. `useTransferFromAndAquaPush` and
 * `allowPartialFill` are deliberately absent rather than guessed: a wrong constant here is
 * indistinguishable from a correct one until funds move.
 */
export const TAKER_FLAGS = {
  /** `IS_EXACT_IN_BIT_FLAG` */
  isExactIn: 0x0001,
  /** `SHOULD_UNWRAP_BIT_FLAG` */
  shouldUnwrapWeth: 0x0002,
  /** `HAS_PRE_TRANSFER_IN_CALLBACK_BIT_FLAG` */
  hasPreTransferInCallback: 0x0004,
  /** `HAS_PRE_TRANSFER_OUT_CALLBACK_BIT_FLAG` */
  hasPreTransferOutCallback: 0x0008,
  /** `IS_STRICT_THRESHOLD_BIT_FLAG` */
  isStrictThreshold: 0x0010,
  /** `IS_FIRST_TRANSFER_FROM_TAKER_BIT_FLAG` */
  isFirstTransferFromTaker: 0x0020,
  /** `IS_A_TO_B_BIT_FLAG` */
  isAToB: 0x0080,
} as const;

/** The header is `[20 bytes of indexes][2 bytes of flags]`. */
export const TAKER_HEADER_BYTES = 22;

/** The keys this encoder understands. Anything else is a slice it cannot index correctly. */
const KNOWN_KEYS = new Set<string>([
  "taker",
  "isExactIn",
  "isAToB",
  "threshold",
  "recipient",
  "deadline",
  "preTransferInCallback",
  "strictThreshold",
  "isFirstTransferFromTaker",
  "shouldUnwrapWeth",
]);

export interface TakerTraitsInput {
  /** The taker's own address, so a recipient equal to it can be omitted as the contract does. */
  readonly taker: Address;
  /** `exactIn` fixes the input; otherwise the output is fixed. */
  readonly isExactIn: boolean;
  /**
   * `tokenA -> tokenB` when true.
   *
   * The single most expensive bit to get wrong: it decides which asset leaves the taker.
   */
  readonly isAToB: boolean;
  /**
   * The bound, as a `uint256`.
   *
   * `exactIn` treats it as a minimum output; otherwise as a maximum input. Marked exact with
   * `strictThreshold`, it must match rather than bound.
   */
  readonly threshold?: bigint;
  /** Where the output goes. Omitted when zero or equal to `taker`, matching the contract. */
  readonly recipient?: Address;
  /** A `uint40` unix timestamp; 0 is "no deadline". */
  readonly deadline?: number;
  /** Whether the taker pushes its input in a pre-transfer-in callback — the Aqua path. */
  readonly preTransferInCallback?: boolean;
  readonly strictThreshold?: boolean;
  readonly isFirstTransferFromTaker?: boolean;
  readonly shouldUnwrapWeth?: boolean;
}

/** Thrown when a caller asks for a slice this encoder does not implement. */
export class UnsupportedTakerSlice extends Error {
  constructor(readonly slices: readonly string[]) {
    super(
      `This encoder implements only the threshold, recipient and deadline slices, but was asked ` +
        `for: ${slices.join(", ")}. Those slices shift every later index, so omitting them would ` +
        `produce a header pointing at the wrong bytes. Extend the index arithmetic before using them.`,
    );
    this.name = "UnsupportedTakerSlice";
  }
}

/** A 32-byte big-endian word. Negative values are meaningless here and rejected. */
function word(value: bigint): string {
  if (value < 0n) throw new RangeError(`A threshold cannot be negative: ${value}.`);
  if (value > 2n ** 256n - 1n) throw new RangeError(`A threshold exceeds uint256: ${value}.`);
  return value.toString(16).padStart(64, "0");
}

/** A `uint16` index, big-endian. */
function index16(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`A slice offset must fit a uint16: ${value}.`);
  }
  return value.toString(16).padStart(4, "0");
}

function uint40(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffffff) {
    throw new RangeError(`A deadline must fit a uint40: ${value}.`);
  }
  return value.toString(16).padStart(10, "0");
}

/**
 * Encode `takerTraitsAndData`.
 *
 * @throws {UnsupportedTakerSlice} for any slice outside threshold / recipient / deadline.
 * @throws {RangeError} for a threshold that is negative, wider than `uint256`, or a deadline that
 *   does not fit `uint40` — all of which would otherwise be truncated into a plausible-looking bound.
 */
export function encodeTakerTraits(input: TakerTraitsInput): Hex {
  const slices: string[] = [];

  // Slice 0 — threshold. Present when given, even as zero, because a caller who passed `0n` asked
  // for a bound of zero and silently dropping it would remove their protection.
  const threshold = input.threshold === undefined ? "" : word(input.threshold);
  slices.push(threshold);

  // Slice 1 — recipient. Omitted when it is the taker or the zero address, exactly as the contract
  // does, because the contract's own index arithmetic depends on that decision.
  const includeRecipient =
    input.recipient !== undefined &&
    input.recipient !== "0x0000000000000000000000000000000000000000" &&
    input.recipient.toLowerCase() !== input.taker.toLowerCase();
  slices.push(
    includeRecipient ? (input.recipient as string).replace(/^0x/, "").toLowerCase() : "",
  );

  // Slice 2 — deadline. Absent means "no deadline", which is the contract's own sentinel.
  slices.push(input.deadline === undefined || input.deadline === 0 ? "" : uint40(input.deadline));

  // Slices 3..9 belong to hooks, callbacks and instructionsArgs, which this encoder does not
  // produce. The type prevents a literal from carrying them, but not a value assembled from JSON —
  // and a caller who *meant* to pass a hook would otherwise have it dropped without a word.
  const unknown = Object.keys(input).filter((key) => !KNOWN_KEYS.has(key));
  if (unknown.length > 0) throw new UnsupportedTakerSlice(unknown);

  // Cumulative end offsets. Slice 0 ends at its own length because it starts at zero.
  const ends: number[] = [];
  let offset = 0;
  for (const slice of slices) {
    offset += slice.length / 2;
    ends.push(offset);
  }
  // The remaining slices are empty, so they all end where slice 2 does.
  while (ends.length < 10) ends.push(offset);

  // Indexes are packed highest-first, and the flags follow as the low 16 bits.
  const indexes = [...ends].reverse().map(index16).join("");
  const flags = flagsFor(input);

  const header = `${indexes}${flags}`;
  if (header.length / 2 !== TAKER_HEADER_BYTES) {
    throw new Error(`The taker header must be ${TAKER_HEADER_BYTES} bytes, got ${header.length / 2}.`);
  }

  return `0x${header}${slices.join("")}` as Hex;
}

function flagsFor(input: TakerTraitsInput): string {
  let flags = 0;
  if (input.isExactIn) flags |= TAKER_FLAGS.isExactIn;
  if (input.isAToB) flags |= TAKER_FLAGS.isAToB;
  if (input.preTransferInCallback === true) flags |= TAKER_FLAGS.hasPreTransferInCallback;
  if (input.strictThreshold === true) flags |= TAKER_FLAGS.isStrictThreshold;
  if (input.isFirstTransferFromTaker === true) flags |= TAKER_FLAGS.isFirstTransferFromTaker;
  if (input.shouldUnwrapWeth === true) flags |= TAKER_FLAGS.shouldUnwrapWeth;
  return index16(flags);
}

/**
 * Decode a header back into its flags and offsets.
 *
 * Exists so a caller can assert what it encoded — the direction bit and the threshold bound are
 * both things that must be checked *before* a transaction, and this is the only read of the wire
 * format that does not go through the contract.
 */
export function readTakerHeader(takerTraitsAndData: Hex): {
  readonly flags: number;
  readonly offsets: readonly number[];
  readonly tail: Hex;
} {
  const header = takerTraitsAndData.slice(2, 2 + TAKER_HEADER_BYTES * 2);
  if (header.length !== TAKER_HEADER_BYTES * 2) {
    throw new RangeError(`Taker data is shorter than its ${TAKER_HEADER_BYTES}-byte header.`);
  }
  const value = BigInt(`0x${header}`);
  const flags = Number(value & 0xffffn);
  const offsets: number[] = [];
  for (let slice = 0; slice < 10; slice += 1) {
    offsets.push(Number((value >> (16n + BigInt(slice) * 16n)) & 0xffffn));
  }
  return { flags, offsets, tail: `0x${takerTraitsAndData.slice(2 + TAKER_HEADER_BYTES * 2)}` as Hex };
}
