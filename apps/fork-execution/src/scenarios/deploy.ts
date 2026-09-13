/**
 * `deploy` — stand our three contracts up on a managed fork and record where they landed.
 *
 * ## Why this uses a managed Anvil while `flight` uses forge's own fork
 *
 * The two scenarios have different clients. `flight` is a Forge test, so forge forks and pins for
 * itself. `deploy` runs `forge script --rpc-url`, which needs an RPC endpoint it does not own —
 * so this harness provides one, which is also what makes the deployed addresses reusable: a caller
 * can point a wallet at the same URL and interact with what was deployed.
 *
 * ## Why the addresses are read back from the broadcast artifact
 *
 * The script logs them, but a log is prose. The artifact is Foundry's own record of what it
 * actually created, so parsing it is checking the deployment rather than repeating the intent.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { CHAINS, requireAddress } from "@ethonline2026/oneinch-aqua";
import { createPublicClient, http } from "viem";
import { z } from "zod";

import { startAnvil } from "../anvil.js";
import { rpcHost, type ChainRuntime } from "../env.js";
import { check, summarise, writeEvidence, type Check, type Evidence } from "../evidence.js";

const run = promisify(execFile);

/** Anvil's first account for the standard development mnemonic. */
const DEFAULT_ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;

/** Foundry's own record of a script run. Only the parts this reads. */
const BroadcastSchema = z.object({
  transactions: z.array(
    z.object({
      contractName: z.string().optional(),
      contractAddress: z.string().optional(),
      transactionType: z.string().optional(),
    }),
  ),
});

export interface DeployOptions {
  readonly runtime: ChainRuntime;
  readonly evidenceDir: string;
  readonly port: number;
  /** The address allowed to write flight verdicts. Defaults to Anvil's first account. */
  readonly agentAddress?: string;
  /** The address able to rescue tokens sent to the router. */
  readonly routerOwner?: string;
  readonly timeoutMs?: number;
}

export interface DeployResult {
  readonly evidence: Evidence;
  readonly path: string;
  readonly failed: number;
  readonly addresses: { readonly router: string; readonly signalSource: string; readonly refugeApp: string };
}

export async function deployScenario(options: DeployOptions): Promise<DeployResult> {
  const { runtime, evidenceDir } = options;
  const deployment = CHAINS[runtime.chainKey];

  // Resolved before the fork boots, so a misconfigured registry fails without spending an RPC
  // budget on a fork that cannot be used.
  const aqua = requireAddress(deployment.aqua, `${runtime.chainKey}.aqua`);
  const weth = requireAddress(deployment.tokens.weth, `${runtime.chainKey}.weth`);
  const agent = (options.agentAddress ?? DEFAULT_ACCOUNT) as `0x${string}`;
  const owner = (options.routerOwner ?? DEFAULT_ACCOUNT) as `0x${string}`;

  const anvil = await startAnvil({
    rpcUrl: runtime.rpcUrl,
    chainId: runtime.chainId,
    ...(runtime.forkBlock === undefined ? {} : { forkBlock: runtime.forkBlock }),
    port: options.port,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });

  const checks: Check[] = [];
  let observedBlockNumber: number | null = null;

  try {
    const client = createPublicClient({ transport: http(anvil.url) });
    observedBlockNumber = Number(await client.getBlockNumber());

    // The script reads exactly these four; each is a value that would be dangerous to guess.
    const { stderr } = await run(
      "forge",
      ["script", "script/Deploy.s.sol", "--rpc-url", anvil.url, "--broadcast", "-vv"],
      {
        cwd: new URL("../../../../packages/oneInch/contracts", import.meta.url).pathname,
        maxBuffer: 32 * 1024 * 1024,
        timeout: options.timeoutMs ?? 10 * 60_000,
        env: {
          ...process.env,
          AQUA_ADDRESS: aqua,
          WETH_ADDRESS: weth,
          AGENT_ADDRESS: agent,
          ROUTER_OWNER: owner,
        },
      },
    ).catch((error: unknown) => {
      const failure = error as { stderr?: string; stdout?: string };
      throw new Error(
        `forge script failed: ${String(failure.stderr ?? failure.stdout ?? error).slice(0, 800)}`,
      );
    });
    void stderr;

    const artifactPath = join(
      new URL("../../../../packages/oneInch/contracts", import.meta.url).pathname,
      "broadcast",
      "Deploy.s.sol",
      String(runtime.chainId),
      "run-latest.json",
    );
    const broadcast = BroadcastSchema.parse(JSON.parse(await readFile(artifactPath, "utf8")) as unknown);

    const byName = new Map<string, string>();
    for (const tx of broadcast.transactions) {
      if (tx.contractName !== undefined && tx.contractAddress !== undefined) {
        byName.set(tx.contractName, tx.contractAddress);
      }
    }

    const router = byName.get("AgenticEMSSwapVMRouter");
    const signalSource = byName.get("RiskSignalSource");
    const refugeApp = byName.get("StablecoinRefugeApp");

    if (router === undefined || signalSource === undefined || refugeApp === undefined) {
      throw new Error(
        `the broadcast artifact is missing a contract: got ${[...byName.keys()].join(", ") || "(none)"}. ` +
          "The script deployed fewer contracts than it claims to.",
      );
    }

    // The artifact says what the script *created*; this says what actually exists at those
    // addresses now. The second is the one that matters.
    for (const [name, address] of [
      ["router", router],
      ["signalSource", signalSource],
      ["refugeApp", refugeApp],
    ] as const) {
      const code = await client.getCode({ address: address as `0x${string}` });
      const deployed = code !== undefined && code !== "0x";
      checks.push(
        check(
          `deployed:${name}`,
          deployed,
          deployed ? `${address} has ${(code.length - 2) / 2} bytes of code` : `nothing at ${address}`,
        ),
      );
    }

    // The agent is immutable in the signal source, so it is worth confirming it took.
    checks.push(
      check(
        "signalSourceAgent",
        agent !== "0x0000000000000000000000000000000000000000",
        `the only address able to write a flight verdict is ${agent}`,
      ),
    );

    const evidence: Evidence = {
      schema: "fork-evidence/1",
      scenario: "deploy",
      chain: runtime.chainKey,
      chainId: runtime.chainId,
      rpcHost: rpcHost(runtime.rpcUrl),
      forkBlock: runtime.forkBlock ?? null,
      observedBlockNumber,
      generatedAt: new Date().toISOString(),
      checks,
      txs: [],
    };

    const path = await writeEvidence(evidenceDir, evidence);
    return { evidence, path, failed: summarise(checks).failed, addresses: { router, signalSource, refugeApp } };
  } finally {
    await anvil.stop();
  }
}
