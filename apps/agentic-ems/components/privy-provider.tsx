"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { PRIVY_APP_ID, PRIVY_CONFIG, PRIVY_CONFIGURED } from "@/lib/privy/config";

/**
 * Mounts Privy only when the app has an App ID configured.
 *
 * Every surface that touches Privy checks {@link usePrivyConfigured} first, and
 * this provider is the single place the SDK is mounted — so a deployment without
 * `NEXT_PUBLIC_PRIVY_APP_ID` still renders the demo (with a setup notice) rather
 * than crashing on a missing provider.
 */
export function PrivyAppProvider({ children }: { children: React.ReactNode }) {
  if (!PRIVY_CONFIGURED) return <>{children}</>;

  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={PRIVY_CONFIG}>
      {children}
    </PrivyProvider>
  );
}

/** True when `NEXT_PUBLIC_PRIVY_APP_ID` is present, so callers can branch early. */
export function usePrivyConfigured(): boolean {
  return PRIVY_CONFIGURED;
}
