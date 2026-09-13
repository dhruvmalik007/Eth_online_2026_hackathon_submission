/**
 * A realistic v0.1 readjustment batch, shared by the e2e scripts.
 *
 * Three legs rather than one on purpose: a single-leg batch would not exercise
 * the `operation` flag, the multi-call encoding, or the "A and B and C" batch
 * sentence that the readjustment engine produces.
 *
 * The addresses are Base Sepolia / Base mainnet contracts, but nothing here is
 * resolved or broadcast — the batch is only ever encoded.
 */
import type { SafeLeg } from "../../src/safe/SafeClient.js";

/** Base Sepolia USDC. */
export const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
/** Morpho Blue. */
export const MORPHO = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as const;
/** Uniswap v4 PoolManager. */
export const V4_POOL_MANAGER = "0x498581fF718922c3f8e6A244956aF099B2652b2b" as const;

/**
 * `approve` → `supply` → `provide liquidity`.
 *
 * The third leg is `operation: 1` (DELEGATECALL), as v4's position manager flow
 * requires, so the encoder is exercised on both call types.
 */
export function buildV01Legs(): SafeLeg[] {
  return [
    { to: USDC, value: "0", data: "0x095ea7b3", operation: 0 },
    { to: MORPHO, value: "0", data: "0x6e553f65", operation: 0 },
    { to: V4_POOL_MANAGER, value: "0", data: "0xdd46508f", operation: 1 },
  ];
}
