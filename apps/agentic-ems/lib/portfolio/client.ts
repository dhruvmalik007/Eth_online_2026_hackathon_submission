"use client";

/**
 * The portfolio as the browser sees it.
 *
 * The address is the user's Privy wallet — the smart account when Privy provisioned one, since that
 * is where the desk's executions land, and the embedded EOA otherwise. There is no address input:
 * if the user wants to look at another wallet, that is a different feature with different
 * consequences, not a text field here.
 */
import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { PortfolioView } from "./server";

export type PortfolioState =
  | { readonly status: "signed-out" }
  | { readonly status: "loading"; readonly address: string }
  | { readonly status: "ready"; readonly address: string; readonly portfolio: PortfolioView }
  | { readonly status: "error"; readonly address: string; readonly message: string };

/** The wallet whose liquidity this desk reports on. */
export function walletAddressOf(
  user: { smartWallet?: { address?: string } | null; wallet?: { address?: string } | null } | null | undefined,
): string | null {
  return user?.smartWallet?.address ?? user?.wallet?.address ?? null;
}

export function usePortfolio(): { readonly state: PortfolioState; readonly refresh: () => void } {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<PortfolioState>({ status: "signed-out" });
  const address = walletAddressOf(user);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated || address === null) {
      setState({ status: "signed-out" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading", address });

    void (async () => {
      try {
        // Sent so the route can move to verified provenance without a client change.
        const token = await getAccessToken();
        const response = await fetch(`/api/portfolio?address=${encodeURIComponent(address)}`, {
          cache: "no-store",
          headers: token === null ? {} : { authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          setState({ status: "error", address, message: body.error ?? `Portfolio read failed (${response.status}).` });
          return;
        }
        const portfolio = (await response.json()) as PortfolioView;
        if (!cancelled) setState({ status: "ready", address, portfolio });
      } catch (cause) {
        if (!cancelled) {
          setState({ status: "error", address, message: cause instanceof Error ? cause.message : "Portfolio read failed." });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, authenticated, getAccessToken, nonce, ready]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  return { state, refresh };
}
