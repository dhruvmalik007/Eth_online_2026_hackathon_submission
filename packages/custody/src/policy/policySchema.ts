/**
 * Policy schema for the custody layer — the shared source of truth for what an
 * agent is allowed to do. Ports the cap/allowlist shape from arc's AgentWallet
 * into a versioned zod schema so policies can be issued to agents as scoped
 * capabilities (Key Ring) and enforced deterministically by PolicyGate.
 */
import { z } from "zod";
import type { Address } from "viem";

/** Per-chain spending caps in whole USDC units (6dp base units are resolved by callers). */
export const walletPolicySchema = z.object({
  /** Maximum single transaction value in USDC. */
  perTxCapUsdc: z.number().nonnegative().default(10_000),
  /** Maximum cumulative value per UTC day, in USDC. */
  dailyCapUsdc: z.number().nonnegative().default(50_000),
  /** Empty array = no restriction; otherwise only these recipients may be paid. */
  recipientAllowlist: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).default([]),
  /** Chains this policy applies to (empty = all configured). */
  chainAllowlist: z.array(z.string()).default([]),
  /** Expiry (epoch seconds) after which the capability no longer applies. */
  expiresAt: z.number().int().optional(),
});

export type WalletPolicy = z.infer<typeof walletPolicySchema>;

/** Body carried inside a ScopedCapability. */
export const capabilitySchema = z.object({
  agentId: z.string().min(1),
  safeAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** proposer — can propose Safe txs; executor — can execute approved txs only. */
  role: z.enum(["proposer", "executor"]).default("proposer"),
  policy: walletPolicySchema,
});

export type AgentCapability = z.infer<typeof capabilitySchema>;

export function assertAddress(value: string): asserts value is `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Invalid address: ${value}`);
  }
}

export type { Address } from "viem";