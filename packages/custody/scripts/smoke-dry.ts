/**
 * Dry-mode smoke test — the proof that `SafeClient` is integrable.
 *
 * Builds a complete, unsigned Safe proposal for a counterfactual (not yet
 * deployed) Safe on Sepolia, with **no Ledger attached and no nonce read from
 * the chain**: the owners, threshold, version and nonce all come from
 * configuration.
 *
 * This is the path an integrating app takes before a device is ever involved —
 * it can show the user exactly what would be authorised, and what the Safe
 * address will be, without hardware.
 *
 * Run: `pnpm --filter @ethonline2026/custody smoke:dry`
 * RPC: honours `ETHEREUM_SEPOLIA_RPC_URL`, else viem's public Sepolia endpoint.
 */
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { SafeClient } from "../src/safe/SafeClient.js";

/** Demo owner — replaced by a real owner set via `CUSTODY_SAFE_OWNERS` in use. */
const DEMO_OWNER = "0x1111111111111111111111111111111111111111" as const;
const DEMO_RECIPIENT = "0x2222222222222222222222222222222222222222" as const;

function main(): Promise<void> {
  const rpcUrl = process.env.ETHEREUM_SEPOLIA_RPC_URL ?? sepolia.rpcUrls.default.http[0];
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  // No `ledger` — this is dry mode. No device, and an explicit nonce so nothing
  // has to be read from a Safe that does not exist yet.
  const client = new SafeClient({
    publicClient,
    ownerAddress: DEMO_OWNER,
    predictedSafe: { owners: [DEMO_OWNER], threshold: 1, safeVersion: "1.3.0" },
    nonce: 0,
  });

  return client
    .address()
    .then(async (address) => {
      const proposal = await client.buildProposal([
        { to: DEMO_RECIPIENT, value: "0", data: "0x" },
      ]);
      const deployment = await client.deploymentRequest().catch((error: unknown) => {
        // Expected when the predicted address happens to hold code; report it
        // rather than pretending the deployment request succeeded.
        return { unavailable: error instanceof Error ? error.message : String(error) };
      });

      console.log("mode          :", client.mode);
      console.log("safe address  :", address);
      console.log("owner         :", await client.ownerAddress());
      console.log("safe tx hash  :", proposal.safeTxHash);
      console.log("safe nonce    :", proposal.nonce);
      console.log("calldata      :", `${proposal.calldata.slice(0, 74)}…`);
      console.log("calldata len  :", proposal.calldata.length);
      console.log("legs          :", JSON.stringify(proposal.legs));
      console.log(
        "deployment tx :",
        "unavailable" in deployment
          ? deployment.unavailable
          : `${deployment.to} (predicted ${deployment.predictedAddress})`,
      );

      if (!/^0x[0-9a-f]{64}$/.test(proposal.safeTxHash)) {
        throw new Error(`unexpected safe tx hash: ${proposal.safeTxHash}`);
      }
      if (!proposal.calldata.startsWith("0x") || proposal.calldata.length < 10) {
        throw new Error("expected execTransaction calldata");
      }
      console.log("\nOK — dry proposal built with no device and no nonce read.");
    })
    .catch((error: unknown) => {
      console.error("DRY SMOKE FAILED:", error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

void main();
