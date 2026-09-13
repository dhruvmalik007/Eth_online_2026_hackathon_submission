#!/usr/bin/env node
/**
 * privy-resolve — which wallet does the Privy authorization key open?
 *
 * The single most common misconfiguration in the server-wallet path is a wallet
 * id that does not belong to the app, or an authorization key that was rotated.
 * Both are invisible until a signing call fails, so this resolves them up front
 * and prints the one value the rest of the setup needs: the wallet's **address**
 * (which must be a Safe owner).
 *
 *   pnpm --filter @ethonline2026/custody privy:resolve
 *
 * Prints only public identifiers — never the app secret or the authorization key.
 * Credentials are read from:
 *   packages/custody/.env      PRIVY_KEY_ID, PRIVY_PRIVATE_KEY
 *   packages/ux-workflow/.env  PRIVY_APP_ID, PRIVY_SECRET
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PrivyClient } from "@privy-io/node";

const here = dirname(fileURLToPath(import.meta.url));

/** Parse a `.env` file without mutating `process.env`. */
function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;
    let value = (match[2] ?? "").trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1] as string] = value;
  }
  return out;
}

async function main(): Promise<void> {
  const custodyEnv = readEnvFile(resolve(here, "../.env"));
  const uxEnv = readEnvFile(resolve(here, "../../ux-workflow/.env"));

  const appId = process.env["PRIVY_APP_ID"] ?? uxEnv["PRIVY_APP_ID"];
  const appSecret = process.env["PRIVY_SECRET"] ?? uxEnv["PRIVY_SECRET"];
  const authKey = process.env["PRIVY_PRIVATE_KEY"] ?? custodyEnv["PRIVY_PRIVATE_KEY"];
  const keyId = process.env["PRIVY_KEY_ID"] ?? custodyEnv["PRIVY_KEY_ID"];

  const missing: string[] = [];
  if (appId === undefined || appId.length === 0) missing.push("PRIVY_APP_ID (packages/ux-workflow/.env)");
  if (appSecret === undefined || appSecret.length === 0) missing.push("PRIVY_SECRET (packages/ux-workflow/.env)");
  if (authKey === undefined || authKey.length === 0) missing.push("PRIVY_PRIVATE_KEY (packages/custody/.env)");
  if (missing.length > 0) {
    console.log("SKIP: Privy credentials are incomplete.");
    for (const key of missing) console.log(`  missing: ${key}`);
    process.exitCode = 2;
    return;
  }

  console.log(`app id            ${appId}`);
  console.log(`authorization key ${authKey?.startsWith("wallet-auth:") === true ? "P-256, wallet-auth: prefixed" : "present (unexpected format)"}`);
  console.log(`configured key id ${keyId ?? "(not set)"}\n`);

  const privy = new PrivyClient({ appId: appId as string, appSecret: appSecret as string });
  const wallets = privy.wallets();

  console.log("wallets visible to this app:");
  let listed: Array<{ id?: string; address?: string; chain_type?: string }> = [];
  try {
    const page = (await wallets.list({ limit: 20 })) as unknown as {
      data?: Array<{ id?: string; address?: string; chain_type?: string }>;
    };
    listed = page.data ?? [];
    if (listed.length === 0) console.log("  (none)");
    for (const wallet of listed) {
      console.log(`  ${wallet.id ?? "?"}  ${wallet.address ?? "?"}  ${wallet.chain_type ?? "?"}`);
    }
  } catch (error) {
    console.log(`  list failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // The configured id is what the signer will use; resolve it explicitly so a
  // typo is reported here rather than during a signature.
  console.log(`\nresolving configured id ${keyId ?? "(unset)"}…`);
  if (keyId === undefined || keyId.length === 0) {
    console.log("  no PRIVY_KEY_ID set — use one of the ids above.");
    process.exitCode = 2;
    return;
  }
  try {
    const wallet = (await wallets.get(keyId)) as unknown as {
      id?: string;
      address?: string;
      chain_type?: string;
    };
    console.log(`  id         ${wallet.id ?? "?"}`);
    console.log(`  address    ${wallet.address ?? "?"}`);
    console.log(`  chain_type ${wallet.chain_type ?? "?"}`);
    console.log(`\nSet these once the Safe is deployed:`);
    console.log(`  PRIVY_WALLET_ID=${wallet.id ?? ""}`);
    console.log(`  CUSTODY_SAFE_OWNERS=${wallet.address ?? ""}`);
  } catch (error) {
    console.log(`  get failed: ${error instanceof Error ? error.message : String(error)}`);
    console.log("  An id that does not resolve here will fail at signing time.");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("privy-resolve failed:");
  console.error(error);
  process.exitCode = 1;
});
