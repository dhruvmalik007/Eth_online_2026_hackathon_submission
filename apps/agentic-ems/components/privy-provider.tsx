"use client";

import * as React from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { PRIVY_APP_ID, PRIVY_CONFIG, PRIVY_CONFIGURED } from "@/lib/privy/config";
import { PortfolioProvider } from "@/lib/portfolio/context";

/**
 * Reads the Privy access token for the current session.
 *
 * Callers that talk to a service which verifies a Privy token — execution, for one — need this, and
 * they also need to work in a deployment with no App ID, where the provider is not mounted at all
 * and `usePrivy` throws. Hooks cannot be called conditionally, so the two facts are reconciled here
 * instead: the default is an inert reader, and it is replaced by a real one wherever Privy is
 * actually mounted.
 */
const AccessTokenContext = React.createContext<() => Promise<string | null>>(async () => null);

/** A getter for the current Privy access token, or one that returns `null` when there is no Privy. */
export function usePrivyAccessToken(): () => Promise<string | null> {
  return React.useContext(AccessTokenContext);
}

/** Mounted only inside `PrivyProvider`, which is the only place `usePrivy` is legal. */
function AccessTokenBridge({ children }: { children: React.ReactNode }) {
  const { getAccessToken } = usePrivy();
  const read = React.useCallback(async () => {
    try {
      return await getAccessToken();
    } catch {
      // Called before the SDK is ready, or after sign-out. Both are "no token", not an error.
      return null;
    }
  }, [getAccessToken]);
  return <AccessTokenContext.Provider value={read}>{children}</AccessTokenContext.Provider>;
}

/**
 * Mounts Privy only when the app has an App ID configured.
 *
 * Every surface that touches Privy checks {@link usePrivyConfigured} first, and
 * this provider is the single place the SDK is mounted — so a deployment without
 * `NEXT_PUBLIC_PRIVY_APP_ID` still renders the demo (with a setup notice) rather
 * than crashing on a missing provider.
 *
 * The portfolio provider sits inside Privy because the wallet address it reads is the Privy
 * wallet's; mounted outside, it would have no session to read from.
 */
export function PrivyAppProvider({ children }: { children: React.ReactNode }) {
  if (!PRIVY_CONFIGURED) return <PortfolioProvider>{children}</PortfolioProvider>;

  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={PRIVY_CONFIG}>
      <AccessTokenBridge>
        <PortfolioProvider>{children}</PortfolioProvider>
      </AccessTokenBridge>
    </PrivyProvider>
  );
}

/** True when `NEXT_PUBLIC_PRIVY_APP_ID` is present, so callers can branch early. */
export function usePrivyConfigured(): boolean {
  return PRIVY_CONFIGURED;
}
