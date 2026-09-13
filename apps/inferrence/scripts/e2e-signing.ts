#!/usr/bin/env node
/**
 * e2e-signing — the complete signing path, against a real custodian.
 *
 * Proves, in one run:
 *   1. the agent produces an intent through custody (`CUSTODY_SIGNER=privy`), so
 *      it carries a real `safeTxHash` and real `execTransaction` calldata;
 *   2. that custodian produces a signature over the intent's own EIP-712 payload;
 *   3. the signature **recovers to the configured owner**, which is the only
 *      assertion that turns "it did not throw" into a proof;
 *   4. a signature from a *different* key is rejected — the negative case, without
 *      which `verify` could be returning true unconditionally.
 *
 *   CUSTODY_SIGNER=privy pnpm --filter @ethonline2026/inferrence exec tsx scripts/e2e-signing.ts
 *
 * Needs a reachable RPC (protocol-kit reads the chain id at init) but no
 * deployment, no gas and no broadcast: the Safe is counterfactual.
 */
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { toViemTypedData } from "@ethonline2026/custody";
import { loadInferenceEnv } from "../src/env.js";
import { createRuntime } from "../src/runtime.js";
import { verifySigningIntent } from "@ethonline2026/custody";
import type { InferenceEvent } from "../src/events/contract.js";

class CheckFailure extends Error {}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new CheckFailure(message);
}

async function main(): Promise<void> {
  const env = loadInferenceEnv({
    ...process.env,
    INFERENCE_MODE: "dry",
    INFERENCE_PERSISTENCE: "memory",
    AGENT_IMPL: "mock",
    SANDBOX_PROVIDER: "local",
    LOG_LEVEL: "silent",
    LANGSMITH_TRACING: "false",
  });

  console.log(`custody signer   ${env.CUSTODY_SIGNER}`);
  console.log(`chain            ${env.CUSTODY_SAFE_CHAIN}`);
  console.log(`safe             ${env.CUSTODY_SAFE_ADDRESS ?? "(counterfactual)"}`);
  console.log(`owners           ${env.CUSTODY_SAFE_OWNERS ?? "(derived from the signer)"}\n`);

  if (env.CUSTODY_SIGNER === "dry") {
    console.log("SKIP: CUSTODY_SIGNER=dry proposes nothing and cannot sign.");
    console.log("Set CUSTODY_SIGNER=privy (with PRIVY_* credentials) or local-key.");
    process.exitCode = 2;
    return;
  }

  const runtime = createRuntime({ env });
  const owner = await runtime.custody.ownerAddress();
  console.log(`owner address    ${owner ?? "(none)"}`);

  // ── 1. the agent produces an intent through custody ─────────────────────────
  const session = await runtime.sessions.open({ userId: "e2e-signing", agent: "v01" });
  const handle = await runtime.orchestrator.beginTurn({
    userId: "e2e-signing",
    sessionId: session.sessionId,
    query: "rebalance my USDC into the best 30d yield",
    mode: "v01",
    pools: ["morpho-usdc-base"],
    protocols: ["morpho"],
    horizonDays: 30,
    dry: true,
  });

  const events = await waitForCompletion(handle.emitter);
  const requested = events.find((event) => event.type === "approval.requested");
  check(requested?.type === "approval.requested", "the run produced no signing intent");
  const intent = requested.intent;

  console.log(`\nintent           ${intent.intentId}`);
  console.log(`digest           ${intent.digest}`);
  console.log(`legs             ${intent.authorized.legs.length}`);
  console.log(`safeTxHash       ${intent.signing.scheme === "safe-typed-data" ? intent.signing.safeTxHash : "n/a"}`);
  console.log(`calldata         ${intent.authorized.calldata === null ? "(none)" : `${intent.authorized.calldata.slice(0, 26)}… (${intent.authorized.calldata.length} chars)`}`);

  check(verifySigningIntent(intent), "the intent's digest does not match its own body");
  check(intent.authorized.calldata !== null, "a live proposal must carry execTransaction calldata");
  check(
    intent.authorized.calldata.startsWith("0x6a761202"),
    "expected execTransaction calldata (selector 0x6a761202)",
  );

  // ── 2+3. the custodian signs it, and the signature recovers to the owner ────
  const signed = await runtime.custody.sign(intent);
  console.log(`\nsignature        ${signed.signature.slice(0, 26)}… (${signed.signature.length} chars)`);

  const verified = await runtime.custody.verify(intent, signed.signature);
  check(verified, "the signature did not recover to the configured owner");
  console.log(`verify           ${verified ? "OK — recovers to the owner" : "FAILED"}`);

  // Independent check, straight from the payload, so `verify` cannot be a rubber stamp.
  if (intent.signing.scheme === "safe-typed-data") {
    const recovered = await recoverTypedDataAddress({
      ...toViemTypedData(intent.signing.typedData),
      signature: signed.signature as `0x${string}`,
    } as Parameters<typeof recoverTypedDataAddress>[0]);
    console.log(`recovered        ${recovered}`);
    check(
      recovered.toLowerCase() === (owner ?? "").toLowerCase(),
      `recovered ${recovered} but the configured owner is ${owner}`,
    );
  }

  // ── 4. a different key must NOT verify ──────────────────────────────────────
  const stranger = privateKeyToAccount(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  );
  if (intent.signing.scheme === "safe-typed-data") {
    const forged = await stranger.signTypedData(
      toViemTypedData(intent.signing.typedData) as Parameters<typeof stranger.signTypedData>[0],
    );
    const forgedAccepted = await runtime.custody.verify(intent, forged);
    check(!forgedAccepted, "a signature from a different key was wrongly accepted");
    console.log(`negative case    OK — a stranger's signature is rejected`);
  }

  // ── approval path: the run advances only with a valid signature ─────────────
  const approval = await runtime.approvals.resolve({
    intentId: intent.intentId,
    outcome: "approved",
    signature: signed.signature,
  });
  check(approval.outcome === "approved", "the approval was not recorded");
  await runtime.custody.record(intent, "approved");

  console.log("\nOK — real proposal → real signature → recovers to the owner → forgeries rejected.");
}

async function waitForCompletion(emitter: {
  since(seq: number): InferenceEvent[];
}): Promise<InferenceEvent[]> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const events = emitter.since(0);
    if (events.some((event) => event.type === "run.completed" || event.type === "error")) {
      return events;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return emitter.since(0);
}

main().catch((error: unknown) => {
  if (error instanceof CheckFailure) {
    console.error(`\nE2E FAILED: ${error.message}`);
  } else {
    console.error("\nE2E FAILED:");
    console.error(error);
  }
  process.exitCode = 1;
});
