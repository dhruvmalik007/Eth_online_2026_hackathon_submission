/**
 * Building a transfer the user's own wallet will sign.
 *
 * Pure, and separate from the WalletConnect wiring, so the arithmetic that decides how many base
 * units leave a wallet is tested without a relay — this is the one place in the funding flow where
 * being wrong moves the wrong amount.
 */
import { encodeFunctionData, parseAbi, isAddress, type Address, type Hex } from "viem";

const ERC20 = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

export type AmountResult = { readonly ok: true; readonly base: bigint } | { readonly ok: false; readonly reason: string };

/**
 * Parse a typed amount into base units.
 *
 * Refuses rather than rounds. `Math.round(value * 10 ** decimals)` is the obvious implementation and
 * it is wrong twice over: it loses precision on values a float cannot hold exactly, and it silently
 * turns "1.2345678" into a transfer of a different number than the user typed. A funding screen that
 * quietly sends a rounded amount is worse than one that refuses.
 */
export function parseAmount(value: string, decimals: number): AmountResult {
  const cleaned = value.replace(/[,\s_]/g, "");
  if (cleaned.length === 0) return { ok: false, reason: "Enter an amount." };
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === ".") {
    return { ok: false, reason: "An amount is digits with at most one decimal point." };
  }

  const [whole = "0", fraction = ""] = cleaned.split(".");
  if (fraction.length > decimals) {
    return { ok: false, reason: `${decimals} decimal places is the most this token supports.` };
  }

  const base = BigInt(`${whole.length === 0 ? "0" : whole}${fraction.padEnd(decimals, "0")}`);
  if (base === 0n) return { ok: false, reason: "The amount is zero." };
  return { ok: true, base };
}

/** The exact calldata an ERC-20 transfer produces. */
export function transferData(to: Address, base: bigint): Hex {
  return encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [to, base] });
}

/** The selector every ERC-20 transfer shares, asserted in the tests so the encoding cannot drift. */
export const ERC20_TRANSFER_SELECTOR = "0xa9059cbb";

export function isAddressLike(value: string | undefined): value is Address {
  return value !== undefined && isAddress(value);
}

/** Shorten an address for display without inventing an ellipsis character mid-hex. */
export function shorten(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}
