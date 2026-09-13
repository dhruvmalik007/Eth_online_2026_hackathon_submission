"use client";

import { useDemo } from "@/lib/demo/state";
import { TOTAL_BALANCE } from "@/lib/demo/data";

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function BalanceChip() {
  const { state } = useDemo();
  if (!state.wallet) return null;
  return (
    <div
      className="group relative flex items-center gap-3 border border-up/40 bg-up/5 px-3 py-1.5 shadow-[0_0_24px_-8px] shadow-up/40"
      title={`Safe ${short(state.wallet.safeAddress)} · 2/2 (you + Ledger) · USDC\nPer-agent spend caps provisioned via PolicyGate`}
    >
      <span className="size-1.5 animate-pulse rounded-full bg-up" aria-hidden />
      <div className="leading-tight">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-fg-faint">Portfolio NAV</p>
        <p className="font-mono text-sm font-semibold tabular-nums text-up">
          ${TOTAL_BALANCE.toLocaleString("en-US")}
          <span className="ml-1 text-[10px] font-normal text-fg-faint">USDC</span>
        </p>
      </div>
      <span className="hidden font-mono text-[10px] text-fg-dim md:inline">{short(state.wallet.safeAddress)}</span>
    </div>
  );
}
