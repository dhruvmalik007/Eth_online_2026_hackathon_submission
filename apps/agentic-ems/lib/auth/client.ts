"use client";

import { signIn } from "next-auth/react";

/**
 * Exchange a Privy access token for a desk session.
 *
 * The one moment a Privy token is handed to this app's server. It goes to NextAuth's own callback —
 * not to a bespoke route — so the exchange gets NextAuth's CSRF protection rather than a
 * hand-rolled equivalent.
 *
 * Returns whether a session now exists. A `false` is not an error to swallow: every protected route
 * will refuse, so the caller should say so rather than let the desk look broken one screen later.
 */
export async function establishSession(privyAccessToken: string): Promise<boolean> {
  try {
    const result = await signIn("credentials", { privyToken: privyAccessToken, redirect: false });
    return result?.error == null && result?.ok !== false;
  } catch {
    return false;
  }
}
