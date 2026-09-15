import { handlers } from "@/lib/auth/options";

/**
 * NextAuth's own endpoints: the sign-in callback, sign-out, session and CSRF token.
 *
 * They are the only routes in this app that accept a Privy token, and the only ones that carry
 * NextAuth's CSRF protection — which is why the session exchange goes through them rather than
 * through a bespoke route.
 */
export const { GET, POST } = handlers;
