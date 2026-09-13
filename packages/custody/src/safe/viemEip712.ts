/**
 * EIP-712 conversions for viem.
 *
 * Two differences between our canonical `Eip712TypedData` and what viem accepts,
 * both of which silently produce a *different digest* if handled wrong:
 *
 *  1. viem derives the domain from `domain` and **rejects** `EIP712Domain`
 *     appearing inside `types`; Safe's protocol-kit leaves it in.
 *  2. viem types `domain.salt` as 32 bytes of hex, we carry it as a string.
 *
 * Shared with the verification path (`recoverTypedDataAddress`) on purpose: the
 * recovery must reconstruct byte-for-byte what was signed, so both directions
 * have to agree on the transformation.
 */
import type { Eip712Domain, Eip712TypedData } from "../eip712.js";
import { SafeSignerError } from "./SafeTypedDataSigner.js";

/**
 * Convert our domain to viem's.
 *
 * A non-hex `salt` is **rejected, not dropped** — dropping it changes the digest
 * and yields a signature that validates locally and fails on-chain, which is the
 * worst possible failure mode.
 *
 * @throws {SafeSignerError} if `salt` is present and not 32 bytes of hex.
 */
export function toViemDomain(domain: Eip712Domain): Record<string, unknown> {
  if (domain.salt !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(domain.salt)) {
    throw new SafeSignerError(
      "The typed-data domain carries a salt that cannot be represented for signing.",
      `domain.salt must be 32 bytes of hex, got ${domain.salt.length} chars`,
      "failed",
    );
  }
  return {
    ...(domain.name === undefined ? {} : { name: domain.name }),
    ...(domain.version === undefined ? {} : { version: domain.version }),
    ...(domain.chainId === undefined ? {} : { chainId: domain.chainId }),
    ...(domain.verifyingContract === undefined
      ? {}
      : { verifyingContract: domain.verifyingContract }),
    ...(domain.salt === undefined ? {} : { salt: domain.salt as `0x${string}` }),
  };
}

/** Remove `EIP712Domain` from a `types` map, copying the rest. */
export function withoutDomainType(
  types: Eip712TypedData["types"],
): Record<string, Array<{ name: string; type: string }>> {
  const out: Record<string, Array<{ name: string; type: string }>> = {};
  for (const [name, fields] of Object.entries(types)) {
    if (name === "EIP712Domain") continue;
    out[name] = fields.map((field) => ({ name: field.name, type: field.type }));
  }
  return out;
}

/** The viem-shaped typed data for a payload (for signing or for recovery). */
export function toViemTypedData(typedData: Eip712TypedData): {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
} {
  return {
    domain: toViemDomain(typedData.domain),
    types: withoutDomainType(typedData.types),
    primaryType: typedData.primaryType,
    message: typedData.message,
  };
}
