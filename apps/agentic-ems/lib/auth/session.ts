import { NextResponse } from "next/server";
import { auth } from "./options";

/**
 * What a route asks when it needs to know who is calling.
 *
 * Kept as one narrow function rather than letting `auth()` spread through the route layer, so that
 * "who is the caller" has a single answer and a route cannot accidentally read a different field
 * and get a different one. The only thing any route needs is the DID.
 */
export interface VerifiedSession {
  /** The Privy DID, taken from verified claims at sign-in and carried in the session since. */
  readonly did: string;
}

/** The caller's verified session, or `null` when there is none. */
export async function currentSession(): Promise<VerifiedSession | null> {
  const session = await auth();
  const did = session?.user?.id;
  return typeof did === "string" && did.length > 0 ? { did } : null;
}

/**
 * The refusal, in one place.
 *
 * Uniform on purpose: a route that is called without a session, with a stale one, or with a forged
 * one should be indistinguishable to the caller, so that probing tells them nothing about which it
 * was.
 */
export function unauthenticated(): NextResponse {
  return NextResponse.json({ error: "Sign in to use this endpoint." }, { status: 401 });
}
