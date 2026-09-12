/**
 * PolicyGate — the deterministic, offline gate EVERY custody operation passes
 * before any device prompt or on-chain submission. Pure logic, fully unit
 * testable. Ports the spirit of arc's AgentWallet cap/allowlist enforcement but
 * as a self-contained module the custody middleware owns.
 *
 * Security invariant: a policy breach must be rejected here, before the agent
 * could ever prompt hardware or craft a proposal — cap breaches never reach the
 * Ledger device.
 */
import type { Address } from "viem";
import type { WalletPolicy } from "./policySchema.js";
import { toLowerAddress } from "../utils/address.js";

export interface TransferRequest {
  agentId: string;
  recipient: Address;
  /** Amount in whole USDC (callers resolve 6dp base units). */
  amountUsdc: number;
  chain: string;
  /** Overridable clock for deterministic tests. */
  nowSec?: number;
}

export type PolicyDecision = { ok: true } | { ok: false; reason: string };

/** In-flight daily spend accumulator keyed by agentId + UTC day. */
export class DailySpend {
  private readonly dayFor = new Map<string, { day: string; totalUsdc: number }>();

  record(agentId: string, amountUsdc: number, nowSec = Math.floor(Date.now() / 1000)): number {
    const day = new Date(nowSec * 1000).toISOString().slice(0, 10);
    const cur = this.dayFor.get(agentId);
    if (!cur || cur.day !== day) {
      this.dayFor.set(agentId, { day, totalUsdc: amountUsdc });
      return amountUsdc;
    }
    cur.totalUsdc += amountUsdc;
    return cur.totalUsdc;
  }

  dailyTotal(agentId: string, nowSec = Math.floor(Date.now() / 1000)): number {
    const day = new Date(nowSec * 1000).toISOString().slice(0, 10);
    const cur = this.dayFor.get(agentId);
    return cur && cur.day === day ? cur.totalUsdc : 0;
  }
}

export class PolicyGate {
  private readonly spend: DailySpend;

  constructor(spend: DailySpend = new DailySpend()) {
    this.spend = spend;
  }

  /**
   * Evaluate a transfer against the policy and, on ok, accumulate spent amounts.
   * Throws never — returns a decision so callers can log and surface cleanly.
   */
  check(request: TransferRequest, policy: WalletPolicy): PolicyDecision {
    const nowSec = request.nowSec ?? Math.floor(Date.now() / 1000);

    // Capability expiry.
    if (policy.expiresAt !== undefined && policy.expiresAt < nowSec) {
      return { ok: false, reason: `Capability expired at ${policy.expiresAt}` };
    }

    // Per-transaction cap.
    if (request.amountUsdc > policy.perTxCapUsdc) {
      return {
        ok: false,
        reason: `Per-tx cap exceeded: ${request.amountUsdc} > ${policy.perTxCapUsdc} USDC`,
      };
    }

    // Recipient allowlist (case-insensitive address comparison).
    if (policy.recipientAllowlist.length > 0) {
      const isAllowed = policy.recipientAllowlist.some(
        (a) => toLowerAddress(a) === toLowerAddress(request.recipient),
      );
      if (!isAllowed) {
        return { ok: false, reason: `Recipient ${request.recipient} not in allowlist` };
      }
    }

    // Chain allowlist.
    if (policy.chainAllowlist.length > 0 && !policy.chainAllowlist.includes(request.chain)) {
      return { ok: false, reason: `Chain ${request.chain} not allowed for agent ${request.agentId}` };
    }

    // Daily aggregate cap (resolved at UTC boundary).
    const today = this.spend.dailyTotal(request.agentId, nowSec);
    if (today + request.amountUsdc > policy.dailyCapUsdc) {
      return {
        ok: false,
        reason: `Daily cap exceeded: ${today} + ${request.amountUsdc} > ${policy.dailyCapUsdc} USDC`,
      };
    }

    // Only record after every check passes — a rejected attempt must not consume cap.
    this.spend.record(request.agentId, request.amountUsdc, nowSec);
    return { ok: true };
  }

  get dailySpend(): DailySpend {
    return this.spend;
  }
}