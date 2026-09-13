/**
 * The ERC-20 reads the registry verification needs.
 *
 * Kept separate from `ERC4626_ABI` on purpose: a vault is not a token, and merging the two
 * would let a caller read `symbol()` off a vault and get a revert instead of a type error.
 * This is the minimum needed to confirm that an address the registry calls USDC is one.
 */

import { parseAbi } from "viem";

/**
 * `symbol()` and `decimals()`.
 *
 * Both are in the ERC-20 standard but neither is guaranteed to be well-behaved — some tokens
 * return `bytes32` where the spec says `string`, and some omit the metadata entirely. A
 * revert is therefore an expected outcome, which is why callers must handle it and why this
 * ABI stays deliberately tiny: a wider ABI would promise more than the harness checks.
 */
export const ERC20_READ_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
