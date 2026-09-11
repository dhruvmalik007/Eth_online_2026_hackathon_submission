/**
 * AgentWallet — the DeepGraphAgent's scoped Arc wallet.
 *
 * Backed by an EOA from env (hackathon/testnet path). Production path: Circle
 * Agent Stack Agent Wallets with spending policies (per-tx cap, daily cap,
 * recipient allowlist) — the interface below is intentionally policy-shaped so
 * the backend can swap without touching the LangChain tools.
 */
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";

export interface WalletPolicies {
  perTxCapUsdc: number; // USD
  dailyCapUsdc: number;
  recipientAllowlist: Address[];
}

export interface AgentWalletSession {
  address: Address;
  policies: WalletPolicies;
}

export class AgentWallet {
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  readonly policies: WalletPolicies;
  private spentTodayUsdc = 0;
  private dayKey = new Date().toISOString().slice(0, 10);

  constructor(opts: { privateKey: `0x${string}`; policies?: Partial<WalletPolicies> }) {
    this.account = privateKeyToAccount(opts.privateKey);
    this.policies = {
      perTxCapUsdc: opts.policies?.perTxCapUsdc ?? 10_000,
      dailyCapUsdc: opts.policies?.dailyCapUsdc ?? 50_000,
      recipientAllowlist: opts.policies?.recipientAllowlist ?? [],
    };
  }

  get address(): Address {
    return this.account.address;
  }

  /**
   * Policy gate — every settlement call routes through this before signing.
   * Throws when a policy would be violated; the LangChain tool surfaces the reason.
   */
  assertTransferUsdc(recipient: Address, amountUsdc: number): void {
    this.rollDayIfNeeded();
    if (amountUsdc > this.policies.perTxCapUsdc) {
      throw new Error(
        `AgentWallet policy: per-tx cap exceeded (${amountUsdc} > ${this.policies.perTxCapUsdc} USDC)`,
      );
    }
    if (this.spentTodayUsdc + amountUsdc > this.policies.dailyCapUsdc) {
      throw new Error(
        `AgentWallet policy: daily cap exceeded (${this.spentTodayUsdc} + ${amountUsdc} > ${this.policies.dailyCapUsdc} USDC)`,
      );
    }
    if (this.policies.recipientAllowlist.length > 0 && !this.policies.recipientAllowlist.includes(recipient)) {
      throw new Error(`AgentWallet policy: recipient ${recipient} not in allowlist`);
    }
    this.spentTodayUsdc += amountUsdc;
  }

  signMessage(message: `0x${string}`): Promise<`0x${string}`> {
    return this.account.signMessage({ message });
  }

  private rollDayIfNeeded(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.dayKey) {
      this.dayKey = today;
      this.spentTodayUsdc = 0;
    }
  }
}
