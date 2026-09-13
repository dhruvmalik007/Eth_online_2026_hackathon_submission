import { keccak256, toBytes, type Hex } from "viem";

/**
 * Ethereum log Bloom filters, as a pure function.
 *
 * A block header carries a 2048-bit bloom of the addresses and topics in its logs. Testing it is a
 * cheap negative: if the bloom does not match, the block provably has no matching log and no receipt
 * fetch is needed. Only a positive result needs the expensive call — which is exactly the shape a
 * stateless, per-block façade wants.
 *
 * Pure and total by design: no network, no clock, so it is testable without a node.
 */
const BLOOM_BITS = 2048;
const BLOOM_BYTES = BLOOM_BITS / 8;
const BITS_PER_HASH = 3;

/** True when `value` looks like a 256-byte bloom (`0x` + 512 hex characters). */
export function isBloomHex(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{512}$/.test(value);
}

/** The three bit positions a value sets in the bloom. */
export function bloomBitPositions(value: string): readonly number[] {
  const hash = toBytes(keccak256(value.startsWith("0x") ? (value as Hex) : (`0x${value}` as Hex)));
  const positions: number[] = [];
  for (let index = 0; index < BITS_PER_HASH; index += 1) {
    const high = hash[index * 2] ?? 0;
    const low = hash[index * 2 + 1] ?? 0;
    positions.push(((high << 8) | low) & (BLOOM_BITS - 1));
  }
  return positions;
}

/**
 * Whether a bloom *may* contain `value`.
 *
 * `false` is a proof of absence; `true` is only a maybe (the filter has false positives by design).
 * The asymmetry is the useful part, so the function is named `mayContain` rather than `contains`.
 */
export function bloomMayContain(bloom: Hex, value: string): boolean {
  const bytes = toBytes(bloom);
  if (bytes.length !== BLOOM_BYTES) return false;
  for (const position of bloomBitPositions(value)) {
    const byteIndex = BLOOM_BYTES - 1 - (position >> 3);
    const mask = 1 << (position & 7);
    if (((bytes[byteIndex] ?? 0) & mask) === 0) return false;
  }
  return true;
}

/** Whether a bloom may contain every value (address and topics of one log). */
export function bloomMayContainAll(bloom: Hex, values: readonly string[]): boolean {
  return values.every((value) => bloomMayContain(bloom, value));
}
