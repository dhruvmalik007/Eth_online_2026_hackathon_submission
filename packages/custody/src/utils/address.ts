/** Address utilities for the custody package. */
import type { Address } from "viem";

/** Normalize an address to lowercase for allowlist comparison. */
export function toLowerAddress(value: Address | string): string {
  return value.toLowerCase();
}

/**
 * Narrow an arbitrary string to an EVM address.
 *
 * Used to validate owner lists before they reach the Safe SDK, so a typo fails
 * at startup rather than producing a Safe nobody can sign for.
 *
 * Predicates to `` `0x${string}` `` rather than viem's `Address`: in this
 * resolution context `Address` widens to plain `string`, so a guard typed
 * against it narrows to nothing and callers get no type safety.
 */
export function isAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Re-exported as a *type*: `Address` is a type-only export of viem, so a plain
 * `export { Address }` emits a runtime re-export that esbuild/tsx cannot elide,
 * failing with "does not provide an export named 'Address'".
 */
export type { Address } from "viem";