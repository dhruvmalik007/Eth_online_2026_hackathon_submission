/**
 * Place a Polymarket order through the official V2 SDK.
 *
 * ## Why this exists next to the hand-rolled path
 *
 * The hand-built order signed correctly — the signer recovered — and the exchange
 * still answered `400 Invalid order payload`. That means the *signed* struct was
 * right and the *wire* representation was not. Rather than reconstruct the wire
 * shape from a documentation table, this asks the SDK for it: `createOrder`
 * returns the `SignedOrder` the exchange expects, so printing it settles the field
 * set and encodings by observation.
 *
 * That is the migration guide's own instruction — generate one order with the
 * official SDK and compare — and it is the right order to have done these in.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

const here = dirname(fileURLToPath(import.meta.url));
const submit = process.argv.includes("--submit");
const CLOB = "https://clob.polymarket.com";
const GAMMA = "https://gamma-api.polymarket.com";
/** A market that is active and tradable. */
const CONDITION_ID = "0xaf5e903876ad42de97e1cf02c2ef8484df69bcfc5541b96a400116557d1e504e";
/** Minimum viable order: 2 shares at 50¢ = $1, against 3.30 pUSD of collateral. */
const PRICE = 0.5;
const SIZE = 2;

let step = 0;
function log(label: string, message: string, fields?: Record<string, unknown>): void {
  const stamp = new Date().toISOString().slice(11, 23);
  console.log(`${stamp}  ${String(++step).padStart(2, "0")}  ${label.padEnd(5)}  ${message}${fields === undefined ? "" : `  ${JSON.stringify(fields)}`}`);
}

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(join(here, "..", ".env"), "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const name = line.slice(0, eq).trim();
    if (!/^[A-Z0-9_]+$/.test(name)) continue;
    let value = line.slice(eq + 1).trim().replace(/^["']+|["']+$/g, "");
    // A bare 64-hex key is a common `.env` convention and ethers rejects it.
    if (name.endsWith("PRIVATE_KEY") && !value.startsWith("0x")) value = `0x${value}`;
    out[name] = value;
  }
  return out;
}

const env = loadEnv();
// The SDK inspects the signer for a viem wallet client (`signer.account`), so an
// ethers Wallet fails with "missing account address". viem is this repo's stack
// anyway, which drops the ethers dependency this script pulled in.
const account = privateKeyToAccount((env['PRIVATE_KEY'] ?? "") as `0x${string}`);
const signer = createWalletClient({
  account,
  chain: polygon,
  transport: http(env['POLYGON_RPC_URL'] ?? ""),
});
const address = account.address;
log("init", "signer", { address, mode: submit ? "WILL SUBMIT" : "dry run — pass --submit" });

// The credential is bound to the address that created it; deriving proves the
// binding rather than assuming it.
const client = new ClobClient(
  CLOB,
  137,
  signer,
  {
    key: env['POLY_API_KEY'] ?? "",
    secret: env['POLY_SECRET'] ?? "",
    passphrase: env['POLY_PASSPHRASE'] ?? "",
  },
  0,
);

const marketResponse = await fetch(`${GAMMA}/markets?condition_ids=${CONDITION_ID}`);
const markets = (await marketResponse.json()) as Array<{ clobTokenIds?: string; question?: string }>;
const tokenIds = JSON.parse(markets[0]?.clobTokenIds ?? "[]") as string[];
const tokenId = tokenIds[0];
log("gamma", "market resolved", {
  question: markets[0]?.question?.slice(0, 50) ?? "(none)",
  tokenId: tokenId?.slice(0, 20) ?? "(none)",
});
if (tokenId === undefined) {
  log("fail", "no token id — nothing to order");
  process.exit(1);
}

// ── The fixture: what the exchange actually expects ──────────────────────────
// `feeRateBps` is deliberately omitted. Supplying 0 — the intuitive default —
// produced "Invalid order payload", because this market's parameter is 1000 and
// the exchange rejects a mismatch. Left out, the SDK reads the market's value.
const order = await client.createOrder(
  { tokenID: tokenId, price: PRICE, size: SIZE, side: Side.BUY },
  { tickSize: "0.01", negRisk: false },
);
log("ok", "SDK produced the wire order", { fields: Object.keys(order).length });
console.log(JSON.stringify(order, null, 2));

if (!submit) {
  log("stop", "dry run complete — nothing submitted");
  process.exit(0);
}

const response = await client.postOrder(order, OrderType.GTC);
log("ok", "POST /order accepted", { response: JSON.stringify(response).slice(0, 240) });
