#!/usr/bin/env node
/**
 * privy-create-wallet — provision the server wallet that owns the Safe.
 *
 * This is a **setup step, not part of a run**. It creates a new Ethereum server
 * wallet in the Privy app; that wallet's address becomes a Safe owner. Creating a
 * wallet is additive and reversible (`wallets.archive(id)`), but it is a real
 * resource in a shared app, so it refuses to run without an explicit flag.
 *
 *   pnpm --filter @ethonline2026/custody privy:create-wallet -- --confirm
 *
 * Prints the values the deployment needs:
 *   PRIVY_WALLET_ID      the new wallet's id
 *   CUSTODY_SAFE_OWNERS  the new wallet's address (the Safe owner)
 *
 * Credentials are read from `packages/ux-workflow/.env` (app id + secret) and
 * `packages/custody/.env` (authorization key). Nothing secret is printed.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PrivyClient } from "@privy-io/node";

const here = dirname(fileURLToPath(import.meta.url));

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1] as string] = value;
  }
  return out;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--confirm")) {
    console.log("Refusing to create a wallet without --confirm.");
    console.log("Re-run as: pnpm --filter @ethonline2026/custody privy:create-wallet -- --confirm");
    process.exitCode = 2;
    return;
  }

  const custodyEnv = readEnvFile(resolve(here, "../.env"));
  const uxEnv = readEnvFile(resolve(here, "../../ux-workflow/.env"));
  const appId = process.env["PRIVY_APP_ID"] ?? uxEnv["PRIVY_APP_ID"];
  const appSecret = process.env["PRIVY_SECRET"] ?? uxEnv["PRIVY_SECRET"];
  if (appId === undefined || appSecret === undefined) {
    console.error("Missing PRIVY_APP_ID / PRIVY_SECRET (packages/ux-workflow/.env).");
    process.exitCode = 2;
    return;
  }

  const privy = new PrivyClient({ appId, appSecret });
  console.log(`app id ${appId}\ncreating an Ethereum server wallet…`);

  const wallet = (await privy.wallets().create({
    chain_type: "ethereum",
    // Stable, so a retry after a network failure cannot create a second wallet.
    idempotency_key: "inferrence-safe-owner-v1",
  })) as unknown as { id?: string; address?: string; chain_type?: string };

  console.log(`\n  id         ${wallet.id ?? "?"}`);
  console.log(`  address    ${wallet.address ?? "?"}`);
  console.log(`  chain_type ${wallet.chain_type ?? "?"}`);

  console.log("\nSet these for the signing path:");
  console.log(`  PRIVY_WALLET_ID=${wallet.id ?? ""}`);
  console.log(`  CUSTODY_SAFE_OWNERS=${wallet.address ?? ""}`);
  console.log("\nThat address must be an owner of the Safe. Deploy the Safe with");
  console.log("`custody cli safe deploy` (or add it as an owner to an existing one).");
}

main().catch((error: unknown) => {
  console.error("privy-create-wallet failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
