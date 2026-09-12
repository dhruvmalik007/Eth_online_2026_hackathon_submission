#!/usr/bin/env node
/**
 * custody — CLI for the Agentic EMS custody middleware.
 *
 * Commands:
 *   ring keys                          List ring keys (Ledger Key Ring / LKRP)
 *   ring issue <agentId> [--key name]  Encrypt a policy into a scoped capability
 *   migrate [--key name]               Sync ring-encrypted capability into custody env
 *   demo                               End-to-end demo (policy gate -> device flow)
 *
 * Device-rooted `ring init` stays a manual wallet-cli flow by design (an EMS
 * middleware never provisions a hardware key ring unattended).
 */
import "dotenv/config";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadEnv } from "./config/env.js";
import { KeyRingClient } from "./ring/KeyRingClient.js";
import { ScopedCapability } from "./ring/ScopedCapability.js";
import { capabilitySchema } from "./policy/policySchema.js";
import type { WalletPolicy } from "./policy/policySchema.js";

type Args = Record<string, string | boolean | undefined>;

function parseArgs(argv: string[]): { command: string; args: Args } {
  const [command = "help", ...rest] = argv;
  const args: Args = {};
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i] ?? "";
    if (tok.startsWith("--")) {
      const key = tok.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else if (args._ === undefined) {
      args._ = tok;
    }
  }
  return { command, args };
}

const DEFAULT_POLICY: WalletPolicy = {
  perTxCapUsdc: 10_000,
  dailyCapUsdc: 50_000,
  recipientAllowlist: [],
  chainAllowlist: [],
};

async function cmdRingKeys(ring: KeyRingClient): Promise<void> {
  const keys = await ring.listKeys();
  if (keys.length === 0) {
    console.log("No keys on the Ledger Key Ring yet.");
    return;
  }
  for (const k of keys) {
    console.log(`- ${k.name}`);
  }
}

async function cmdRingIssue(ring: KeyRingClient, agentId: string, safeAddress: string): Promise<void> {
  const cap = capabilitySchema.parse({
    agentId,
    safeAddress,
    role: "proposer" as const,
    policy: DEFAULT_POLICY,
  });
  const capRef = new ScopedCapability(ring, {
    keyName: `agent-scoped-${agentId}`,
    ciphertextPath: join(process.cwd(), `.custody/${agentId}.cap.enc`),
  });
  const tmp = join(tmpdir(), `cap-${randomUUID()}.json`);
  await capRef.issue(cap, tmp);
  console.log(`Issued scoped capability for agent ${agentId} at ${capRef.path}`);
}

async function cmdMigrate(ring: KeyRingClient, keyName: string): Promise<void> {
  const capRef = new ScopedCapability(ring, {
    keyName,
    ciphertextPath: join(process.cwd(), `.custody/${keyName.replace(/^agent-scoped-/, "")}.cap.enc`),
  });
  const tmp = join(tmpdir(), `cap-${randomUUID()}.json`);
  const cap = await capRef.resolve(tmp);
  console.log(`Resolved ${cap.agentId} → ${cap.safeAddress} (role ${cap.role})`);
  console.log(`Policy: per-tx ${cap.policy.perTxCapUsdc} USDC, daily ${cap.policy.dailyCapUsdc} USDC`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const ring = new KeyRingClient({ env: { WALLET_PASS: env.WALLET_PASS } });

  const { command, args } = parseArgs(process.argv.slice(2));
  switch (command) {
    case "ring": {
      const sub = typeof args._ === "string" ? args._ : "keys";
      if (sub === "keys") {
        await cmdRingKeys(ring);
      } else if (sub === "issue") {
        const agentId = typeof args.agentId === "string" ? args.agentId : "";
        const safeAddress = env.CUSTODY_SAFE_ADDRESS ?? "";
        if (!agentId || !safeAddress) {
          throw new Error("ring issue requires --agentId <id> and CUSTODY_SAFE_ADDRESS set");
        }
        await cmdRingIssue(ring, agentId, safeAddress);
      } else {
        throw new Error(`Unknown ring subcommand: ${sub}`);
      }
      break;
    }
    case "migrate": {
      const keyName = typeof args.key === "string" ? args.key : env.CUSTODY_AGENT_KEY_REF;
      await cmdMigrate(ring, keyName);
      break;
    }
    case "help":
    default:
      console.log(
        "custody CLI — usage: custody <ring|migrate|demo> [flags]\n  ring keys\n  ring issue --agentId <id>\n  migrate [--key <ring-key>]\n  demo",
      );
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`custody: ${message}`);
  process.exitCode = 1;
});