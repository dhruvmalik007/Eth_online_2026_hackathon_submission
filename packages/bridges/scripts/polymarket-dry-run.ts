/**
 * Polymarket CLOB V2 — authenticated dry run.
 *
 * ## What this does, and what it deliberately does not
 *
 * It authenticates against the **live production CLOB**, resolves a real market,
 * builds and signs a real order, prints the exact `POST /order` body — and then
 * **stops**. Nothing is submitted, so no collateral is committed and no order can
 * fill.
 *
 * That boundary is not caution for its own sake. There is no simulated host:
 * `clob-v2.polymarket.com` (the pre-cutover testing endpoint) is gone, and no
 * testnet CLOB exists. Every order posted anywhere is a real order on a live
 * venue.
 *
 * ## Verbose by design
 *
 * Each stage logs what it resolved and why, because the failures here are quiet:
 * a wrong HMAC produces a 401 that looks like bad credentials, and a wrong field
 * order produces a signature that verifies against the wrong address.
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { clobOrderTypedData, clobOrderWireBody } from "../src/polymarket.js";

const here = dirname(fileURLToPath(import.meta.url));
const CLOB = "https://clob.polymarket.com";
const GAMMA = "https://gamma-api.polymarket.com";

let step = 0;
function log(label: string, message: string, fields?: Record<string, unknown>): void {
  const stamp = new Date().toISOString().slice(11, 23);
  const extra = fields === undefined ? "" : `  ${JSON.stringify(fields)}`;
  console.log(`${stamp}  ${String(++step).padStart(2, "0")}  ${label.padEnd(5)}  ${message}${extra}`);
}

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const line of readFileSync(join(here, "..", ".env"), "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;

    // Quotes of either kind are stripped, because `.env` values are read
    // literally and a quoted secret sends the quote characters as part of it —
    // which is exactly how the Alchemy key broke earlier in this project.
    let value = match[2].trim().replace(/^["']|["']$/g, "");

    // A private key is normalised to the 0x-prefixed form viem requires. Both
    // conventions are common in `.env` files, and a bare 64-character hex key is
    // rejected as "invalid private key, expected hex or 32 bytes, got string" —
    // which reads like a wrong key rather than a formatting difference.
    if (match[1].endsWith("PRIVATE_KEY") && !value.startsWith("0x")) value = `0x${value}`;

    out[match[1]] = value;
  }
  return out;
}

const env = loadEnv();
const account = privateKeyToAccount(env['PRIVATE_KEY'] as `0x${string}`);

log("init", "demo account derived from PRIVATE_KEY", { address: account.address });
log("init", "CLOB host", { host: CLOB, note: "production — no simulated host exists" });

// ── L1: obtain the API credential for THIS address ───────────────────────────
// A Polymarket API key is bound to the address that created it. The key in `.env`
// carries a valid-looking prefix and the secret decodes correctly, yet L2 auth
// returns 401 — which is what a key belonging to a *different* address looks like.
// A Gmail-created Polymarket account gets a proxy wallet, so its keys belong to
// that proxy, not to this EOA.
//
// Deriving rather than using the env key makes the credential correct by
// construction: `/auth/derive-api-key` returns the existing creds for the address
// that signs the L1 message, so key and signer cannot disagree.
const L1_ATTESTATION = "This message attests that I control the given wallet";

async function l1Headers(): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await account.signTypedData({
    domain: { name: "ClobAuthDomain", version: "1", chainId: 137 },
    types: {
      ClobAuth: [
        { name: "address", type: "address" },
        { name: "timestamp", type: "string" },
        { name: "nonce", type: "uint256" },
        { name: "message", type: "string" },
      ],
    },
    primaryType: "ClobAuth",
    message: { address: account.address, timestamp, nonce: 0n, message: L1_ATTESTATION },
  });
  return {
    POLY_ADDRESS: account.address,
    POLY_SIGNATURE: signature,
    POLY_TIMESTAMP: timestamp,
    POLY_NONCE: "0",
  };
}

const deriveResponse = await fetch(`${CLOB}/auth/derive-api-key`, { headers: await l1Headers() });
log("auth", "L1 derive-api-key for the signing address", {
  address: account.address,
  status: deriveResponse.status,
});

let creds: { key: string; secret: string; passphrase: string };
if (deriveResponse.ok) {
  const derived = (await deriveResponse.json()) as { apiKey: string; secret: string; passphrase: string };
  creds = { key: derived.apiKey, secret: derived.secret, passphrase: derived.passphrase };
  log("ok", "existing credential derived for this address", {
    apiKeyPrefix: `${derived.apiKey.slice(0, 8)}…`,
  });
} else {
  const created = await fetch(`${CLOB}/auth/api-key`, { method: "POST", headers: await l1Headers() });
  log("auth", "no existing credential — creating one", { status: created.status });
  if (!created.ok) {
    log("fail", "could not obtain a credential for this address", {
      body: (await created.text()).slice(0, 200),
    });
    process.exit(1);
  }
  const fresh = (await created.json()) as { apiKey: string; secret: string; passphrase: string };
  creds = { key: fresh.apiKey, secret: fresh.secret, passphrase: fresh.passphrase };
  log("ok", "credential created", { apiKeyPrefix: `${fresh.apiKey.slice(0, 8)}…` });
}

// ── L2: sign each request with that credential ───────────────────────────────
// The secret is base64url-encoded, so it must be decoded before it is used as an
// HMAC key. Using the encoded form produces a well-formed signature that never
// matches — a 401 that reads like a permissions problem.
function l2Headers(method: string, path: string, body = ""): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const secret = Buffer.from(creds.secret, "base64url");
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}${method}${path}${body}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return {
    POLY_ADDRESS: account.address,
    POLY_SIGNATURE: signature,
    POLY_TIMESTAMP: timestamp,
    POLY_API_KEY: creds.key,
    POLY_PASSPHRASE: creds.passphrase,
  };
}

log("auth", "L2 headers built", {
  address: account.address,
  // The *derived* key, not the one in `.env`. Logging the env value here claimed
  // one credential while the request carried another.
  apiKeyPrefix: `${creds.key.slice(0, 8)}…`,
  secretBytes: Buffer.from(creds.secret, "base64url").length,
});

// ── Read: does the credential actually work? ─────────────────────────────────
const ordersPath = "/data/orders";
const authStarted = Date.now();
const ordersResponse = await fetch(`${CLOB}${ordersPath}`, { headers: l2Headers("GET", ordersPath) });
log("auth", "authenticated read", {
  path: ordersPath,
  status: ordersResponse.status,
  ms: Date.now() - authStarted,
});

if (!ordersResponse.ok) {
  const body = await ordersResponse.text();
  // Not fatal. The credential is bound to the address that created it, so a
  // mismatched POLY_ADDRESS produces exactly this 401 — and the market read and
  // signing path below need no credential at all. Continuing proves those
  // independently of whatever is wrong with the key.
  log("warn", "L2 authentication rejected — continuing without it", { body: body.slice(0, 200) });
} else {
  const openOrders = (await ordersResponse.json()) as unknown;
  log("ok", "L2 authentication accepted", {
    openOrders: Array.isArray(openOrders) ? openOrders.length : "n/a",
  });
}

// ── Resolve a live market ────────────────────────────────────────────────────
// The migration guide's test markets are retained for reference; a current market
// is fetched instead so the tokenId is one the exchange still accepts.
const conditionId = "0xaf5e903876ad42de97e1cf02c2ef8484df69bcfc5541b96a400116557d1e504e";
const marketUrl = `${GAMMA}/markets?condition_ids=${conditionId}`;
const marketResponse = await fetch(marketUrl);
log("gamma", "resolving a market", { conditionId: `${conditionId.slice(0, 18)}…`, status: marketResponse.status });

const markets = (await marketResponse.json()) as Array<{
  question?: string;
  clobTokenIds?: string;
  negRisk?: boolean;
  orderPriceMinTickSize?: number;
  active?: boolean;
  closed?: boolean;
}>;
const market = markets[0];
const tokenIds = (JSON.parse(market?.clobTokenIds ?? "[]") as string[]);
log("gamma", "market resolved", {
  question: market?.question?.slice(0, 60) ?? "(none)",
  tokens: tokenIds.length,
  negRisk: market?.negRisk ?? false,
  tickSize: market?.orderPriceMinTickSize ?? "(none)",
  tradable: market?.active === true && market?.closed !== true,
});

const tokenId = tokenIds[0];
if (tokenId === undefined) {
  log("fail", "market carried no token ids — nothing to build an order against");
  process.exit(1);
}

// ── Build and sign — the part that is genuinely testable today ───────────────
const orderInput = {
  maker: account.address,
  signer: account.address,
  tokenId,
  // A deliberately tiny order: the point is the payload, not the position.
  makerAmount: "1000000",
  takerAmount: "2000000",
  side: "BUY" as const,
  signatureType: 0 as const,
  timestampMs: Date.now(),
  negRisk: market?.negRisk ?? false,
};

const typedData = clobOrderTypedData(orderInput, 137);
log("build", "typed data assembled", {
  domain: typedData.domain.name,
  version: typedData.domain.version,
  verifyingContract: typedData.domain.verifyingContract,
  fields: typedData.types.Order.length,
});

const signature = await account.signTypedData({
  domain: typedData.domain,
  types: typedData.types,
  primaryType: typedData.primaryType,
  message: typedData.message,
});
log("sign", "order signed", { bytes: (signature.length - 2) / 2 });

// Recovering is the check that matters: a wrong field order yields a signature
// that recovers to a different address rather than throwing.
const recovered = await recoverTypedDataAddress({
  domain: typedData.domain,
  types: typedData.types,
  primaryType: typedData.primaryType,
  message: typedData.message,
  signature,
});
log(recovered === account.address ? "ok" : "fail", "signer recovered from the digest", {
  recovered,
  expected: account.address,
});

const wireBody = clobOrderWireBody(orderInput, signature);
// The signed order and its request envelope are separate things. `owner` names the
// API key making the request and `orderType` its lifetime — neither is signed, and
// neither belongs in the protocol's payload builder. Omitting them is what produced
// "Invalid order payload" against a correctly signed order.
const body = JSON.stringify({ ...wireBody, owner: creds.key, orderType: "GTC" });
log("build", "POST /order body assembled", { bytes: body.length });
console.log("\n" + JSON.stringify(wireBody, null, 2) + "\n");

if (!process.argv.includes("--submit")) {
  log("stop", "dry run complete — nothing was submitted", {
    reason: "pass --submit to place this order live",
  });
  process.exit(0);
}

// ── Submit ───────────────────────────────────────────────────────────────────
// The body is part of the signed message, so it has to reach the header builder.
// Signing only the path produces a well-formed signature the server rejects —
// which reads as an auth problem rather than a missing argument.
const submitStarted = Date.now();
const submitResponse = await fetch(`${CLOB}/order`, {
  method: "POST",
  headers: { "content-type": "application/json", ...l2Headers("POST", "/order", body) },
  body,
});
const submitText = await submitResponse.text();
log(submitResponse.ok ? "ok" : "fail", `POST /order ${submitResponse.ok ? "accepted" : "rejected"}`, {
  status: submitResponse.status,
  ms: Date.now() - submitStarted,
  body: submitText.slice(0, 300),
});
