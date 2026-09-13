/**
 * Every address a chain needs, flattened with its provenance.
 *
 * ## Why this is in the package rather than in the harness
 *
 * Both the registry's own tests and the fork scenarios need the same thing: a complete list
 * of the pinned addresses for a chain, each with the source it came from and what should be
 * true of it on-chain. Two copies of that walk would drift, and the copy that drifted would
 * be the one not checking a newly added address.
 *
 * The shape is deliberately flat and ordered, so a scenario can iterate it and produce one
 * check per address. A missing check should be visible as a *gap in the output*, which is
 * only possible if the list is enumerable rather than nested.
 */

import type { Address, AddressExpectation } from "./address.js";
import { CHAINS, CHAIN_KEYS, type ChainKey } from "./chainRegistry.js";
import { isPinned } from "./address.js";

export interface PinnedAddress {
  /** Dotted path to the pinned object, e.g. `morpho.blue` — stable enough to assert on. */
  readonly path: string;
  readonly address: Address;
  readonly source: string;
  /** What the fork suite should assert about it. */
  readonly expect?: AddressExpectation;
}

/**
 * Walk a structure and collect every value carrying an address and a source.
 *
 * The recorded path names the pinned object rather than its `.address` field, because the
 * walk stops at the object — so a path reads `morpho.blue`, not `morpho.blue.address`.
 */
function collect(value: unknown, path: string, found: PinnedAddress[]): PinnedAddress[] {
  if (value === null || typeof value !== "object") return found;

  if (isPinned(value as never)) {
    const pinned = value as { address: Address; source: string; expect?: AddressExpectation };
    found.push(
      pinned.expect === undefined
        ? { path, address: pinned.address, source: pinned.source }
        : { path, address: pinned.address, source: pinned.source, expect: pinned.expect },
    );
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collect(item, `${path}[${index}]`, found));
    return found;
  }
  for (const [key, nested] of Object.entries(value)) {
    collect(nested, path === "" ? key : `${path}.${key}`, found);
  }
  return found;
}

/** Everything pinned for one chain, with the chain prefix stripped from each path. */
export function chainInventory(chainKey: ChainKey): readonly PinnedAddress[] {
  return collect(CHAINS[chainKey], "", []);
}

/** Everything pinned, for every chain in the matrix. */
export function allChainInventories(): Readonly<Record<ChainKey, readonly PinnedAddress[]>> {
  const out: Partial<Record<ChainKey, readonly PinnedAddress[]>> = {};
  for (const key of CHAIN_KEYS) out[key] = chainInventory(key);
  return out as Readonly<Record<ChainKey, readonly PinnedAddress[]>>;
}
