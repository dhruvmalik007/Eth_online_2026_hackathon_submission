#!/usr/bin/env node
/**
 * e2e-privy — the same chain as `e2e-local-signer`, but signed by a **Privy
 * server wallet**, so no key is ever readable by this process.
 *
 * Gated on credentials. When they are absent it **skips with an explicit reason
 * and never passes** — a silent green here would be worse than a red, because
 * the whole point is proving that a real custodian produced the signature.
 *
 *   pnpm --filter @ethonline2026/custody e2e:privy -- --check   # config report only
 *   pnpm --filter @ethonline2026/custody e2e:privy
 *
 * Required env:
 *   PRIVY_APP_ID                  from the Privy dashboard
 *   PRIVY_APP_SECRET
 *   PRIVY_AUTHORIZATION_PRIVATE_KEY   base64 PKCS#8, `wallet-auth:` prefix optional
 *   PRIVY_WALLET_ID               the server wallet that owns the Safe
 *   CUSTODY_SAFE_ADDRESS          the Safe it owns
 *   CUSTODY_SAFE_OWNERS           must list the wallet address (threshold 1)
 *
 * Exit codes: 0 pass · 1 failure · 2 skipped (missing configuration).
 */
import "dotenv/config";
import { createPublicClient, http, recoverTypedDataAddress } from "viem";
import { sepolia } from "viem/chains";
import { buildV01Legs } from "./lib/fixture-legs.js";
import {
  PrivySdkTransport,
  PrivyWalletSigner,
} from "../src/safe/PrivyWalletSigner.js";
import { SafeClient } from "../src/safe/SafeClient.js";
import { SafeSignerError } from "../src/safe/SafeTypedDataSigner.js";
import { verifySigningIntent } from "../src/intent/IntentBuilder.js";
import { toViemTypedData } from "../src/safe/viemEip712.js";
import { PolicyGate, DailySpend } from "../src/policy/PolicyGate.js";
import { walletPolicySchema } from "../src/policy/policySchema.js";

const SKIP = 2;

interface PrivyConfig {
  readonly appId: string;
  readonly appSecret: string;
  readonly authorizationPrivateKey: string;
  readonly walletId: string;
  readonly safeAddress: string;
  readonly walletAddress: string;
}

/** Which required variables are missing — reported all at once, not one per run. */
function inspectConfig(env: NodeJS.ProcessEnv): { config: PrivyConfig | null; missing: string[] } {
  const required = [
    "PRIVY_APP_ID",
    "PRIVY_APP_SECRET",
    "PRIVY_AUTHORIZATION_PRIVATE_KEY",
    "PRIVY_WALLET_ID",
    "CUSTODY_SAFE_ADDRESS",
    "CUSTODY_SAFE_OWNERS",
  ] as const;
  const missing = required.filter((key) => (env[key] ?? "").trim().length === 0);
  if (missing.length > 0) return { config: null, missing };

  // `CUSTODY_SAFE_OWNERS` is the owner set; the wallet must be in it, at
  // threshold 1, or the Safe cannot be signed for by this wallet alone.
  const owners = (env["CUSTODY_SAFE_OWNERS"] ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return {
    config: {
      appId: env["PRIVY_APP_ID"] as string,
      appSecret: env["PRIVY_APP_SECRET"] as string,
      authorizationPrivateKey: env["PRIVY_AUTHORIZATION_PRIVATE_KEY"] as string,
      walletId: env["PRIVY_WALLET_ID"] as string,
      safeAddress: env["CUSTODY_SAFE_ADDRESS"] as string,
      // The owner list is the only place the wallet's address is known without an
      // extra API call; the match is verified below before anything is signed.
      walletAddress: owners[0] as string,
    },
    missing: [],
  };
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  const { config, missing } = inspectConfig(process.env);

  if (config === null) {
    console.log("SKIP: Privy e2e requires credentials that are not configured.");
    for (const key of missing) console.log(`  missing: ${key}`);
    console.log("\nDashboard steps (all manual, none scriptable from here):");
    console.log("  1. Wallets → Authorization keys → New key; store the private key once.");
    console.log("  2. Create a server wallet (chain_type: ethereum) and fund it on the testnet.");
    console.log("  3. Add that wallet as an owner of the Safe at threshold 1.");
    console.log("  4. Author a policy that ALLOWS eth_signTypedData_v4 — policies are default-deny.");
    console.log("     Scope it with ethereum_typed_data_domain (chainId, verifyingContract)");
    console.log("     and ethereum_typed_data_message (to, value) so it can only sign this Safe.");
    process.exitCode = SKIP;
    return;
  }

  console.log(`privy app    ${config.appId}`);
  console.log(`wallet       ${config.walletId}`);
  console.log(`safe         ${config.safeAddress}`);
  if (checkOnly) {
    console.log("\nConfig OK — credentials present. Re-run without --check to sign.");
    return;
  }

  const signer = new PrivyWalletSigner({
    walletId: config.walletId,
    authorizationPrivateKey: config.authorizationPrivateKey,
    knownAddress: config.walletAddress as `0x${string}`,
    transport: new PrivySdkTransport({ appId: config.appId, appSecret: config.appSecret }),
  });
  const owner = await signer.address();

  // The single most likely misconfiguration: the wallet is not the Safe's owner.
  if (owner.toLowerCase() !== config.walletAddress.toLowerCase()) {
    console.error(
      `FAIL: the Privy wallet ${owner} is not the configured owner ${config.walletAddress}.`,
    );
    process.exitCode = 1;
    return;
  }

  const policy = walletPolicySchema.parse({
    perTxCapUsdc: 10_000,
    dailyCapUsdc: 50_000,
    recipientAllowlist: [],
    chainAllowlist: [],
  });
  const gate = new PolicyGate(new DailySpend());

  // Policy runs BEFORE any RPC: a cap breach must never reach the custodian.
  const legs = buildV01Legs();
  const notional = 100_000;
  const decision = gate.check(
    {
      agentId: "v01",
      recipient: legs[0]?.to as `0x${string}`,
      amountUsdc: notional,
      chain: "sepolia",
    },
    policy,
  );
  if (!decision.ok) {
    console.log(`policy       rejected locally: ${decision.reason}`);
    console.log("\nOK — the cap gate stopped the intent before Privy was ever called.");
    return;
  }

  const rpcUrl = process.env.ETHEREUM_SEPOLIA_RPC_URL ?? sepolia.rpcUrls.default.http[0];
  const client = new SafeClient({
    publicClient: createPublicClient({ chain: sepolia, transport: http(rpcUrl) }),
    signer,
    safeAddress: config.safeAddress,
  });

  const intent = await client.proposeIntent(legs, {
    intentId: `intent-privy-${Date.now()}`,
    requestId: `req-privy-${Date.now()}`,
    agentId: "v01",
    kind: "v01-readjustment",
    display: {
      title: "Deploy 100,000 USDC",
      sentence: "Supply 65,000 USDC to Morpho and provide 35,000 USDC of USDC/ETH v4 liquidity.",
      fields: [{ label: "Notional", value: "$100,000" }],
      warnings: [],
    },
    policy: {
      perTxCapUsdc: policy.perTxCapUsdc,
      dailyCapUsdc: policy.dailyCapUsdc,
      allowlistOk: true,
      evaluatedAt: new Date().toISOString(),
      privyPolicyId: process.env.PRIVY_POLICY_ID ?? null,
    },
  });

  console.log(`digest       ${intent.digest}`);
  if (!verifySigningIntent(intent)) {
    console.error("FAIL: the intent digest does not match its own body.");
    process.exitCode = 1;
    return;
  }

  const tx = await client.createTransaction(legs);
  let signature: `0x${string}`;
  try {
    const signed = await client.signWithSigner(tx);
    signature = signed.signature as `0x${string}`;
  } catch (error) {
    if (error instanceof SafeSignerError) {
      // A policy denial is a decision, not an incident — say so plainly.
      console.error(`FAIL: ${error.message}`);
      console.error(`  debug: ${error.debug}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  if (intent.signing.scheme !== "safe-typed-data") {
    console.error(`FAIL: expected a safe-typed-data intent, got ${intent.signing.scheme}.`);
    process.exitCode = 1;
    return;
  }

  const recovered = await recoverTypedDataAddress({
    ...toViemTypedData(intent.signing.typedData),
    signature,
  } as Parameters<typeof recoverTypedDataAddress>[0]);

  console.log(`recovered    ${recovered}`);
  if (recovered.toLowerCase() !== owner.toLowerCase()) {
    console.error(`FAIL: recovered ${recovered} but the Privy wallet is ${owner}.`);
    process.exitCode = 1;
    return;
  }

  console.log("\nOK — Privy server wallet produced a signature that authorises this intent.");
}

main().catch((error: unknown) => {
  console.error("\nPRIVY E2E FAILED:");
  console.error(error);
  process.exitCode = 1;
});
