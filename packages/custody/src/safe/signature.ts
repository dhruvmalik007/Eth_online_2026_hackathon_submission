/**
 * Signature encoding shared by every Safe owner signer.
 *
 * A Safe packs an owner signature as `r ‖ s ‖ v`, with `v` a single 0/1 recovery
 * id byte. Signers disagree about that byte: Ledger's DMK returns 0/1, while
 * viem and most RPC signers return 27/28. A wrong recovery id produces a
 * signature that fails to validate on-chain **with no error at signing time** —
 * so normalising in exactly one place means adding a signer cannot reintroduce
 * the bug.
 */

/**
 * Collapse a recovery id to 0/1.
 *
 * @throws {RangeError} if `v` is neither the 0/1 nor the 27/28 form — better to
 *   refuse than to emit a signature that silently fails on-chain.
 */
export function normalizeRecoveryId(v: number): 0 | 1 {
  const recovery = v >= 27 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1) {
    throw new RangeError(`Unsupported signature recovery id: ${v}`);
  }
  return recovery;
}

/**
 * Encode `r`/`s`/`v` into the canonical `0x<r><s><v>` owner signature.
 *
 * @throws {RangeError} if `v` does not yield a 0/1 recovery id.
 */
export function encodeSignature(v: number, r: string, s: string): `0x${string}` {
  const recovery = normalizeRecoveryId(v);
  const vByte = recovery.toString(16).padStart(2, "0");
  return `0x${r.replace(/^0x/, "")}${s.replace(/^0x/, "")}${vByte}` as `0x${string}`;
}

/** A 65-byte hex signature, split into its parts. */
export interface SplitSignature {
  readonly r: `0x${string}`;
  readonly s: `0x${string}`;
  readonly v: number;
}

/**
 * Split a packed `0x<r><s><v>` signature.
 *
 * @throws {RangeError} if the input is not exactly 65 bytes.
 */
export function splitSignature(signature: `0x${string}`): SplitSignature {
  const hex = signature.replace(/^0x/, "");
  if (hex.length !== 130) {
    throw new RangeError(`Expected a 65-byte signature, got ${hex.length / 2} bytes.`);
  }
  return {
    r: `0x${hex.slice(0, 64)}` as `0x${string}`,
    s: `0x${hex.slice(64, 128)}` as `0x${string}`,
    v: Number.parseInt(hex.slice(128, 130), 16),
  };
}

/** Re-normalise any 65-byte signature to the Safe `0x<r><s><v>` form. */
export function toSafeSignature(signature: `0x${string}`): `0x${string}` {
  const { r, s, v } = splitSignature(signature);
  return encodeSignature(v, r, s);
}
