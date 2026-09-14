import "server-only";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { serverEnv } from "@/lib/env";
import { verifyPrivyToken } from "@/lib/privy/server";

/**
 * The desk's session: NextAuth owns the cookie, Privy owns the identity.
 *
 * ## The split
 *
 * Privy remains the only thing that decides *who* a caller is — the wallet is the identity, and a
 * smart account is owned by a Privy signer, so nothing else can express it. What Privy does not give
 * the server is a session it can read on each request without the browser handing it a bearer token
 * every time. NextAuth supplies exactly that and nothing more.
 *
 * So the exchange is one-way and happens once, at sign-in: the browser proves itself to Privy as it
 * already does, then hands the resulting access token here, and this file — via
 * `verifyPrivyToken` — turns it into a session. Every later request carries the session cookie and
 * no Privy token at all.
 *
 * ## What is deliberately not in the session
 *
 * The Privy access token is not stored in the JWT. A session cookie containing a bearer credential
 * is the thing this layer exists to remove: it would be replayed against Privy, and it would put a
 * credential somewhere `HttpOnly` cannot protect it from a server-side leak. Only the DID crosses.
 *
 * `apps/execution/src/privyAuth.ts` makes the same point from the other direction — it refuses to
 * read the `privy-token` cookie, so that no second, less obvious credential path can appear. This is
 * that discipline kept: the Credentials callback below is the *only* place a Privy token is accepted.
 */

/** The session's `user.id` is the verified Privy DID. Named here so routes read one field. */
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Absent locally, and NextAuth refuses to start without one in production — which is the correct
  // failure. The catalog marks it required outside local for the same reason.
  secret: serverEnv().AUTH_SECRET,
  // Vercel terminates TLS and forwards the original host; without this NextAuth reads the request
  // as untrusted in a deployment.
  trustHost: true,
  session: {
    strategy: "jwt",
    /**
     * An hour, to match the lifetime of the Privy access token this session was minted from.
     *
     * A longer session would outlive the credential that justified it: Privy could expire or revoke
     * the underlying session and this cookie would keep asserting the DID anyway. Re-authentication
     * is the honest price of not holding a refresh token.
     */
    maxAge: 60 * 60,
  },
  cookies: {
    sessionToken: {
      name: "ems.session",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        // `localhost` is not a secure context for cookies, so this is conditional rather than always
        // true; a deployment always gets it.
        secure: process.env["NODE_ENV"] === "production",
      },
    },
  },
  providers: [
    Credentials({
      name: "privy",
      credentials: { privyToken: { type: "text" } },
      async authorize(credentials) {
        const token = credentials?.["privyToken"];
        if (typeof token !== "string" || token.trim().length === 0) return null;
        try {
          const session = await verifyPrivyToken(token);
          return { id: session.did };
        } catch {
          // `verifyPrivyToken` has already logged why. Returning null is NextAuth's "these
          // credentials are not valid", which is also what an attacker should be told.
          return null;
        }
      },
    }),
  ],
  callbacks: {
    /** Only the DID is carried, and only from the sign-in that produced it. */
    jwt({ token, user }) {
      if (user !== undefined && typeof user.id === "string" && user.id.length > 0) {
        token["did"] = user.id;
      }
      return token;
    },
    session({ session, token }) {
      const did = token["did"];
      if (typeof did === "string") session.user.id = did;
      return session;
    },
  },
});
