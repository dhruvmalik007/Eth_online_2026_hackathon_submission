/**
 * Address provenance.
 *
 * ## Why an address is never a bare string here
 *
 * Every value in the chain registry decides where funds go. A bare `0x…`
 * constant is indistinguishable from a plausible-looking typo, and the failure
 * mode is silent: the transaction succeeds and settles somewhere nobody
 * controls. So each address carries the source it came from, and the fork suite
 * asserts it against real chain state before anything is signed.
 *
 * That gives three states, and the middle one is the important one:
 *
 * - **pinned** — an address with a citation, verifiable in one click.
 * - **unresolved** — we need a value and have no verified one. This is *not* an
 *   error to be papered over with a placeholder; it is a leg that cannot execute
 *   yet, and {@link requireAddress} refuses to hand out a guess.
 * - absent (`undefined`) — the venue genuinely does not exist on this chain,
 *   which is a fact to be modelled rather than a gap to be filled.
 *
 * The distinction between "unresolved" and "absent" is what stops a missing
 * Aave address from reading as "Aave is not on Arbitrum". They are different
 * facts with different consequences, and conflating them is how a strategy
 * quietly routes somewhere it should not.
 */

/** A 0x-prefixed 20-byte hex address. */
export type Address = `0x${string}`;

/** An address plus where it came from, so a reader can re-verify it. */
export interface Pinned {
  readonly address: Address;
  /** A URL or file that states this address, ideally the issuer's own. */
  readonly source: string;
  /** What the fork suite should assert about it before it is used. */
  readonly expect?: AddressExpectation;
}

/**
 * What to check on-chain before trusting a pinned address.
 *
 * Deliberately narrow. `codeExists` alone catches a wrong address; the extra
 * hints catch the subtler mistake of a *right-format* address for the wrong
 * thing — a USDC vault that is actually a USDT vault, a pool that is not a pool.
 */
export interface AddressExpectation {
  /** Assert `EXTCODESIZE > 0`. Always true in practice; stated for emphasis. */
  readonly codeExists?: boolean;
  /** For an ERC-20: assert `symbol()` equals this. */
  readonly erc20Symbol?: string;
  /** For an ERC-20: assert `decimals()` equals this. */
  readonly erc20Decimals?: number;
  /** For an ERC-4626 vault: assert `asset()` equals this address. */
  readonly vaultAsset?: Address;
  /** A human note about what this contract is, for a failure message. */
  readonly note?: string;
}

/** An address we need and have not verified. Carries how to obtain it. */
export interface Unresolved {
  /** Where the value must come from, specific enough to act on. */
  readonly unresolved: string;
}

export type MaybePinned = Pinned | Unresolved;

/** Narrow to a pinned address. */
export function isPinned(value: MaybePinned): value is Pinned {
  return "address" in value;
}

/**
 * Get the address, or refuse loudly.
 *
 * A guess here would be worse than a crash: it would produce a valid-looking
 * transaction that moves real value to an address we never verified. So this
 * throws with the citation we are missing, which is the actionable information.
 */
export function requireAddress(value: MaybePinned, what: string): Address {
  if (isPinned(value)) return value.address;
  throw new Error(
    `${what} is unresolved: ${value.unresolved}. ` +
      `Fill it from that source before this leg can execute — a placeholder here would sign a transaction to an unverified address.`,
  );
}

/** Build a pinned address. Sugar so the registry stays readable. */
export function pinned(
  address: Address,
  source: string,
  expect?: AddressExpectation,
): Pinned {
  return expect === undefined ? { address, source } : { address, source, expect };
}

/** Mark a value as required but not yet verified. */
export function unresolved(source: string): Unresolved {
  return { unresolved: source };
}

/**
 * Assert an address is well-formed.
 *
 * Used by the registry's own tests, not at runtime — a malformed literal is a
 * build error, and paying for the check on every call would be buying nothing.
 */
export function isAddress(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}
