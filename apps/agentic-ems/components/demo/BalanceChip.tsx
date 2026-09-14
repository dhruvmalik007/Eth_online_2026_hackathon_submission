"use client";

import { useDemo } from "@/lib/demo/state";
import { useNav } from "@/lib/portfolio/context";
import { formatUsd } from "@/lib/portfolio/nav";

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Portfolio NAV, read from the chains rather than asserted.
 *
 * The number is a floor whenever something could not be priced, and the chip says so with a `+n`
 * marker instead of presenting a partial total as the whole story. A zero would be worse than
 * useless here: it reads as "you have nothing", which is the one conclusion the data does not
 * support when a read failed.
 */
export function BalanceChip() {
  const { state } = useDemo();
  const { nav, state: portfolio } = useNav();

  if (!state.wallet) return null;

  const chainsRead = portfolio.status === "ready" ? portfolio.portfolio?.chains.filter((c) => c.status !== "unavailable").length ?? 0 : 0;

  const value =
    portfolio.status === "ready"
      ? nav.empty
        ? "no liquidity"
        : formatUsd(nav.pricedUsd)
      : portfolio.status === "loading"
        ? "reading…"
        : portfolio.status === "error"
          ? "unavailable"
          : "—";

  return (
    <div
      className="group relative flex items-center gap-3 border border-up/40 bg-up/5 px-3 py-1.5 shadow-[0_0_24px_-8px] shadow-up/40"
      title={
        portfolio.status === "ready"
          ? `${chainsRead} chain(s) read · ${nav.unpriced} holding(s) could not be priced\nSafe ${short(state.wallet.safeAddress)}`
          : `Safe ${short(state.wallet.safeAddress)}`
      }
    >
      <span className="size-1.5 animate-pulse rounded-full bg-up" aria-hidden />
      <div className="leading-tight">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-fg-faint">Portfolio NAV</p>
        <p className="font-mono text-sm font-semibold tabular-nums text-up">
          {value}
          {nav.unpriced > 0 && portfolio.status === "ready" && (
            <span className="ml-1 text-[10px] font-normal text-fg-faint">+{nav.unpriced} unpriced</span>
          )}
        </p>
      </div>
      <span className="hidden font-mono text-[10px] text-fg-dim md:inline">{short(state.wallet.safeAddress)}</span>
    </div>
  );
}
