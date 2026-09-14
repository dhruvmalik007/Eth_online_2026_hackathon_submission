"use client";

/**
 * One portfolio read per page, shared by every surface that needs it.
 *
 * The NAV appears in the balance chip, the dashboard header, the allocation pie and each proposal
 * stage. Reading it in each of those would fire the same five-chain scan once per component, so the
 * read lives here and the components subscribe to the result.
 *
 * When Privy is not configured the provider still exists and reports `signed-out`: the demo renders
 * with a setup notice instead of the tree disappearing behind a provider that was never mounted.
 */
import * as React from "react";
import { PRIVY_CONFIGURED } from "@/lib/privy/config";
import { usePortfolio, type PortfolioState } from "./client";
import { navFrom, type NavSummary } from "./nav";
import type { PortfolioView } from "./server";

export interface NavContextValue {
  readonly nav: NavSummary;
  readonly state: PortfolioState;
  readonly portfolio: PortfolioView | null;
  readonly refresh: () => void;
}

const IDLE: NavContextValue = {
  nav: { pricedUsd: 0, unpriced: 0, empty: true },
  state: { status: "signed-out" },
  portfolio: null,
  refresh: () => undefined,
};

const NavContext = React.createContext<NavContextValue>(IDLE);

function LivePortfolio({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { state, refresh } = usePortfolio();

  const value = React.useMemo<NavContextValue>(() => {
    const portfolio = state.status === "ready" ? state.portfolio : null;
    return { nav: navFrom(portfolio), state, portfolio, refresh };
  }, [state, refresh]);

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function PortfolioProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  if (!PRIVY_CONFIGURED) return <NavContext.Provider value={IDLE}>{children}</NavContext.Provider>;
  return <LivePortfolio>{children}</LivePortfolio>;
}

export function useNav(): NavContextValue {
  return React.useContext(NavContext);
}
