/**
 * GET /api/portfolio?address=0x…
 *
 * The address comes from the user's Privy session on the client. It is *not* proven here: this
 * handler reads public on-chain balances, so the address is a selector, not a credential — anyone
 * could ask for the same numbers from a block explorer. Proving provenance becomes load-bearing only
 * when a read is scoped to something private, and at that point the verification belongs on the
 * Privy access token the client already holds.
 *
 * The response says which it is (`provenance`) rather than leaving a reader to assume.
 */
import { isAddress } from "viem";
import { readWalletPortfolio } from "@/lib/portfolio/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const address = new URL(request.url).searchParams.get("address");
  if (address === null || !isAddress(address)) {
    return Response.json({ error: "Pass ?address= with a valid EVM address." }, { status: 400 });
  }

  try {
    return Response.json(await readWalletPortfolio(address));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Portfolio read failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
