#!/usr/bin/env node
/**
 * e2e-local-signer — the whole custody chain, end to end, with no custodian.
 *
 * Proves, in order:
 *   1. a real Safe proposal is built for a counterfactual Safe;
 *   2. it becomes a **signing intent** whose digest verifies;
 *   3. an owner signs the intent's own EIP-712 payload;
 *   4. the signature **recovers to that owner** — the assertion that makes this
 *      a test rather than "it did not throw";
 *   5. the packed signature attaches to the Safe transaction;
 *   6. the audit log records one `intentHash` across the whole sequence.
 *
 * Deterministic in outcome: no funds, no device, no broadcast. It does need a
 * reachable RPC, because protocol-kit reads the chain id when it initialises —
 * that was measured, not assumed (see the package README).
 *
 *   pnpm --filter @ethonline2026/custody e2e:local-signer
 *
 * Env: ETHEREUM_SEPOLIA_RPC_URL (falls back to viem's public Sepolia endpoint)
 *      CUSTODY_E2E_PRIVATE_KEY   (falls back to a public Hardhat test key)
 */
import "dotenv/config";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, http, recoverTypedDataAddress } from "viem";
import { sepolia } from "viem/chains";
import { CustodyLog } from "../src/log/CustodyLog.js";
import { toViemTypedData } from "../src/safe/viemEip712.js";
import { LocalKeySigner } from "../src/safe/LocalKeySigner.js";
import { SafeClient } from "../src/safe/SafeClient.js";
import { verifySigningIntent } from "../src/intent/IntentBuilder.js";
import { buildV01Legs } from "./lib/fixture-legs.js";

/** A public, worthless test key (Hardhat account #1). Never fund this. */
const FALLBACK_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

class CheckFailure extends Error {}

/**
 * An assertion function, not just a thrower: declaring `asserts condition` lets
 * TypeScript narrow afterwards, so a null check also satisfies the compiler.
 */
function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new CheckFailure(message);
}

async function main(): Promise<void> {
  const rpcUrl = process.env.ETHEREUM_SEPOLIA_RPC_URL ?? sepolia.rpcUrls.default.http[0];
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  const signer = new LocalKeySigner(
    (process.env.CUSTODY_E2E_PRIVATE_KEY ?? FALLBACK_KEY) as `0x${string}`,
    { acknowledgeInsecureKey: true },
  );
  const owner = await signer.address();
  console.log(`owner        ${owner}`);
  console.log(`signer kind  ${signer.kind}  (dev/test instrument — never for funds)`);

  const client = new SafeClient({
    publicClient,
    signer,
    predictedSafe: { owners: [owner], threshold: 1, safeVersion: "1.3.0" },
    // The Safe does not exist yet, so its nonce comes from configuration rather
    // than a chain read.
    nonce: 0,
  });
  console.log(`mode         ${client.mode}`);
  console.log(`safe         ${await client.address()}`);

  const legs = buildV01Legs();

  // ── 1+2. the intent ────────────────────────────────────────────────────────
  const intent = await client.proposeIntent(legs, {
    intentId: "intent-e2e-1",
    requestId: "req-e2e-1",
    agentId: "v01",
    kind: "v01-readjustment",
    display: {
      title: "Deploy 100,000 USDC",
      sentence:
        "Supply 65,000 USDC to Morpho at ≥4.2% APY and provide 35,000 USDC of USDC/ETH v4 liquidity.",
      fields: [
        { label: "Notional", value: "$100,000" },
        { label: "Wallet cost", value: "$0.75" },
        { label: "Chain", value: "Base Sepolia" },
      ],
      warnings: ["leg-3 is illustrative: the v4 pool was not resolved on-chain."],
    },
    policy: { perTxCapUsdc: 250_000, dailyCapUsdc: 500_000, allowlistOk: true },
    provenance: {
      agentId: "v01",
      agentRunId: "run-e2e-1",
      langsmithTraceId: null,
      model: null,
      decisionIds: ["d1", "d2"],
    },
  });

  console.log(`intent       ${intent.intentId}`);
  console.log(`digest       ${intent.digest}`);
  check(verifySigningIntent(intent), "the intent's digest does not match its own body");
  check(
    /^0x[0-9a-f]{64}$/.test(intent.signing.scheme === "safe-typed-data" ? intent.signing.safeTxHash : ""),
    "expected a 32-byte safeTxHash",
  );
  const calldata = intent.authorized.calldata;
  check(calldata !== null, "expected execTransaction calldata to be attached to the intent");
  check(
    calldata.startsWith("0x6a761202"),
    "expected execTransaction calldata (selector 0x6a761202)",
  );
  check(intent.authorized.legs.length === 3, "expected 3 authorised legs");
  console.log(`safeTxHash   ${intent.signing.scheme === "safe-typed-data" ? intent.signing.safeTxHash : "n/a"}`);
  console.log(`calldata     ${calldata.slice(0, 74)}… (${calldata.length} chars)`);

  // ── 3+4. the signature, and the recovery that proves it ────────────────────
  const tx = await client.createTransaction(legs);
  const signed = await client.signWithSigner(tx);
  check(signed.signature.length === 132, "expected a 65-byte signature");
  check(signed.signature.endsWith("00") || signed.signature.endsWith("01"), "expected a 0/1 recovery id");

  const recovered = await recoverTypedDataAddress({
    ...toViemTypedData(signed.typedData),
    signature: signed.signature,
  } as Parameters<typeof recoverTypedDataAddress>[0]);
  console.log(`signature    ${signed.signature.slice(0, 26)}…`);
  console.log(`recovered    ${recovered}`);
  check(
    recovered.toLowerCase() === owner.toLowerCase(),
    `recovered ${recovered} but the owner is ${owner} — the signature does not authorise this intent`,
  );

  // The intent's payload and the signed payload must be the same object, or the
  // digest the audit log pins describes something other than what was signed.
  if (intent.signing.scheme === "safe-typed-data") {
    const recoveredFromIntent = await recoverTypedDataAddress({
      ...toViemTypedData(intent.signing.typedData),
      signature: signed.signature,
    } as Parameters<typeof recoverTypedDataAddress>[0]);
    check(
      recoveredFromIntent.toLowerCase() === owner.toLowerCase(),
      "the intent's typed data does not match the payload that was signed",
    );
  }

  // ── 5. attach ──────────────────────────────────────────────────────────────
  const packed = await client.attachSignature(signed);
  check(packed.startsWith("0x") && packed.length > 130, "expected packed owner signatures");
  console.log(`packed       ${packed.slice(0, 26)}… (${packed.length} chars)`);

  // ── 6. the audit trail ─────────────────────────────────────────────────────
  const dir = await mkdtemp(join(tmpdir(), "custody-e2e-"));
  const log = new CustodyLog(join(dir, "custody-audit.jsonl"));
  const base = {
    requestId: intent.requestId,
    intentHash: intent.digest,
    agentId: intent.agentId,
    safeAddress: intent.account,
    chain: intent.chain,
  };
  await log.append({ ts: Date.now(), type: "intent_submitted", ...base });
  await log.append({ ts: Date.now(), type: "proposal_created", ...base, detail: { nonce: intent.authorized.nonce } });
  await log.append({ ts: Date.now(), type: "device_requested", ...base });
  await log.append({ ts: Date.now(), type: "device_approved", ...base, detail: { signer: signer.kind } });

  const { readFile } = await import("node:fs/promises");
  const events = (await readFile(log.filePath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; intentHash?: string });
  check(events.length === 4, `expected 4 audit events, got ${events.length}`);
  check(
    events.every((event) => event.intentHash === intent.digest),
    "not every audit event carries the intent digest",
  );
  console.log(`audit        ${events.map((event) => event.type).join(" → ")}`);

  console.log("\nOK — proposal → intent → signature → recovery → attach → audit, no custodian involved.");
}

main().catch((error: unknown) => {
  if (error instanceof CheckFailure) {
    console.error(`\nE2E FAILED: ${error.message}`);
  } else {
    // Full error: the "undefined.message" class hides auth/region/RPC causes.
    console.error("\nE2E FAILED:");
    console.error(error);
  }
  process.exitCode = 1;
});
