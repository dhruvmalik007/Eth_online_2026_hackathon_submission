/**
 * Custody package environment loading — zod-validated CUSTODY_* variables.
 *
 * Chain definitions come from viem (`viem/chains`) — the workspace's standard
 * EVM chain vocabulary. We intentionally do NOT depend on other EMS packages
 * here so custody stays a standalone middleware that any app can integrate.
 * NO secrets pass through env — agent keys and API keys live in the Ledger
 * Key Ring (see `KeyRingClient`).
 */
import { z } from "zod";
import {
  sepolia,
  arbitrumSepolia,
  baseSepolia,
  optimismSepolia,
  polygonAmoy,
} from "viem/chains";
import type { Chain } from "viem";
import { isAddress } from "../utils/address.js";

/** Supported testnets — subset of viem's chain prebuilds. */
export const CUSTODY_CHAINS = [
  "sepolia",
  "arbitrum-sepolia",
  "base-sepolia",
  "optimism-sepolia",
  "polygon-amoy",
] as const;

export type CustodyChain = (typeof CUSTODY_CHAINS)[number];

/** viem chain registry — single source of truth for ids, RPC, native currency. */
export const CHAIN_INFO: Record<CustodyChain, Chain> = {
  sepolia,
  "arbitrum-sepolia": arbitrumSepolia,
  "base-sepolia": baseSepolia,
  "optimism-sepolia": optimismSepolia,
  "polygon-amoy": polygonAmoy,
};

const envSchema = z.object({
  /**
   * `dry` (default): build proposals and calldata, never touch the device.
   * `live`: additionally sign on the device.
   *
   * Note that dry mode still needs a *reachable* RPC — protocol-kit reads the
   * chain id when it initialises, so "no device" is not "no network". Verified
   * against an unreachable endpoint: initialisation fails on `eth_chainId`.
   */
  CUSTODY_MODE: z.enum(["dry", "live"]).default("dry"),
  CUSTODY_SAFE_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  /**
   * Comma-separated Safe owner addresses.
   *
   * Unset means "the resolved owner alone" — the device address in live mode.
   * Listing owners is how one Safe is shared, for example between a
   * Privy-derived EOA and a Ledger EOA, without this package knowing which is
   * which.
   */
  CUSTODY_SAFE_OWNERS: z.string().optional(),
  /** How many owners must sign. Defaults to 1. */
  CUSTODY_SAFE_THRESHOLD: z.coerce.number().int().positive().default(1),
  CUSTODY_SAFE_CHAIN: z.enum(CUSTODY_CHAINS).default("sepolia"),
  CUSTODY_AGENT_KEY_REF: z.string().default("agent-scoped-0"),
  CUSTODY_LOG_PATH: z.string().default("./custody-audit.jsonl"),
  CUSTODY_SAFE_TX_SERVICE_URL: z.string().url().optional(),
  ETHEREUM_SEPOLIA_RPC_URL: z.string().url().optional(),
  /** Ring password injected via OS keychain substitution; never a literal. */
  WALLET_PASS: z.string().optional(),
});

export type CustodyEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): CustodyEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Custody env validation failed: ${issues}`);
  }
  return parsed.data;
}

/** Resolve the viem Chain for a custody chain id. */
export function chainInfo(chain: CustodyChain): Chain {
  return CHAIN_INFO[chain];
}

export function requireSafeAddress(env: CustodyEnv): `0x${string}` {
  if (!env.CUSTODY_SAFE_ADDRESS) {
    throw new Error(
      "CUSTODY_SAFE_ADDRESS is not set. Run `pnpm --filter @ethonline2026/custody cli safe deploy` first.",
    );
  }
  return env.CUSTODY_SAFE_ADDRESS as `0x${string}`;
}

/**
 * Parse the configured Safe owner set.
 *
 * Returns `null` when `CUSTODY_SAFE_OWNERS` is unset or empty, which lets the
 * caller fall back to the resolved owner. Addresses are validated here so a
 * typo fails at startup rather than producing a Safe nobody can sign for.
 *
 * @throws if any entry is not a well-formed address.
 */
export function safeOwners(env: CustodyEnv): `0x${string}`[] | null {
  const raw = env.CUSTODY_SAFE_OWNERS;
  if (raw === undefined) return null;

  const owners: `0x${string}`[] = [];
  for (const part of raw.split(",")) {
    const candidate = part.trim();
    if (candidate.length === 0) continue;
    if (!isAddress(candidate)) {
      throw new Error(`CUSTODY_SAFE_OWNERS contains an invalid address: ${candidate}`);
    }
    owners.push(candidate);
  }
  return owners.length > 0 ? owners : null;
}