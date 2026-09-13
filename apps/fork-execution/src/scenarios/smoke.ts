/**
 * `smoke` — verify the registry against a real chain, at a pinned block.
 *
 * ## What this is for
 *
 * Every address in the registry is a claim: "Aqua is at 0x1111…", "this vault holds USDC",
 * "the PoolManager exists on Optimism". Those claims are what the flight rule reasons over,
 * and a wrong one produces a plan that looks fine and cannot settle. This scenario is the
 * cheapest way to check all of them — it boots a fork, reads each address, and writes the
 * result.
 *
 * It deliberately sends **no transactions**. That makes it safe to run against a fork of
 * mainnet, quick enough to run on every change, and useful as the first thing to try when
 * something later fails: if the smoke run is green, the registry is not the problem.
 *
 * ## Why it reuses the package's vault logic
 *
 * `onchainVaultReader` and `validateVault` are the same functions the runtime path uses. A
 * scenario that reimplemented those checks would be able to pass while the real path failed,
 * which is the one thing a verification harness must not do.
 */

import {
  CHAINS,
  ERC20_READ_ABI,
  chainInventory,
  onchainVaultReader,
  validateVault,
} from "@ethonline2026/oneinch-aqua";
import { createPublicClient, http } from "viem";

import { startAnvil } from "../anvil.js";
import { rpcHost, type ChainRuntime } from "../env.js";
import { check, summarise, writeEvidence, type Check, type Evidence } from "../evidence.js";

export interface SmokeOptions {
  readonly runtime: ChainRuntime;
  readonly port: number;
  readonly evidenceDir: string;
  /** Override the block timeout, for a slow RPC. */
  readonly timeoutMs?: number;
}

export interface SmokeResult {
  readonly evidence: Evidence;
  readonly path: string;
  readonly failed: number;
}

/** Read a token's `symbol()` and `decimals()`, or `undefined` when either reverts. */
async function readToken(
  client: ReturnType<typeof createPublicClient>,
  address: `0x${string}`,
): Promise<{ symbol: string; decimals: number } | undefined> {
  try {
    const [symbol, decimals] = await Promise.all([
      client.readContract({ address, abi: ERC20_READ_ABI, functionName: "symbol" }),
      client.readContract({ address, abi: ERC20_READ_ABI, functionName: "decimals" }),
    ]);
    return { symbol: String(symbol), decimals: Number(decimals) };
  } catch {
    return undefined;
  }
}

export async function smokeScenario(options: SmokeOptions): Promise<SmokeResult> {
  const { runtime, evidenceDir } = options;
  const deployment = CHAINS[runtime.chainKey];

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

    // The node already refused to serve the wrong chain id — StartAnvil checks that — so this
    // is recorded rather than asserted, and its value is that the evidence states what was
    // actually observed.
    const reportedChainId = await client.getChainId();
    observedBlockNumber = Number(await client.getBlockNumber());
    checks.push(
      check(
        "chainId",
        reportedChainId === runtime.chainId,
        `local node reports ${reportedChainId}, registry expects ${runtime.chainId}`,
      ),
    );

    // ── Every pinned address has code ────────────────────────────────────────
    for (const entry of chainInventory(runtime.chainKey)) {
      const code = await client.getCode({ address: entry.address });
      const deployed = code !== undefined && code !== "0x";
      checks.push(
        check(
          `code:${entry.path}`,
          deployed,
          deployed
            ? `${entry.address} has ${(code.length - 2) / 2} bytes of code`
            : `no code at ${entry.address} — the registry entry is wrong for this chain. Source: ${entry.source}`,
        ),
      );
    }

    // ── The ERC-20s are what the registry says they are ──────────────────────
    for (const [role, token] of [
      ["usdc", deployment.tokens.usdc],
      ["weth", deployment.tokens.weth],
    ] as const) {
      const expected = token.expect;
      if (expected === undefined) continue;

      const read = await readToken(client, token.address);
      if (read === undefined) {
        checks.push(check(`token:${role}`, false, `${token.address} did not answer symbol()/decimals()`));
        continue;
      }

      const symbolOk = expected.erc20Symbol === undefined || read.symbol === expected.erc20Symbol;
      const decimalsOk = expected.erc20Decimals === undefined || read.decimals === expected.erc20Decimals;
      checks.push(
        check(
          `token:${role}`,
          symbolOk && decimalsOk,
          `${token.address} reports symbol="${read.symbol}" decimals=${read.decimals}; ` +
            `registry expects symbol="${expected.erc20Symbol ?? "anything"}" decimals=${expected.erc20Decimals ?? "anything"}`,
        ),
      );
    }

    // ── Each curated vault is live and holds the right stablecoin ────────────
    const reader = onchainVaultReader(client);
    for (const [index, vault] of deployment.morpho.vaults.entries()) {
      // 18 is the share decimals the fixture was curated with; `validateVault` treats a
      // mismatch as a rejection, which is the check we want, so the expectation is passed
      // through rather than assumed here.
      const readings = await reader.read(vault.address, 18);
      const verdict = validateVault(readings, { address: vault.address, asset: vault.asset });

      checks.push(
        check(
          `vault:${index}:${vault.name}`,
          verdict.ok,
          verdict.ok
            ? `${vault.address} holds ${readings?.totalAssets ?? 0n} of ${vault.asset}; ` +
              `one share = ${readings?.oneShareToAssets ?? 0n}`
            : `rejected (${verdict.reason}): ${verdict.detail}. Source: ${vault.source}`,
        ),
      );
    }

    // ── The deterministic deployments really are shared ──────────────────────
    const canonicalAqua = CHAINS.optimism.aqua.address.toLowerCase();
    const thisAqua = deployment.aqua.address.toLowerCase();
    checks.push(
      check(
        "aqua:deterministic",
        canonicalAqua === thisAqua,
        `Aqua is ${deployment.aqua.address} on ${deployment.name}, ${canonicalAqua === thisAqua ? "matching" : "differing from"} the value on the other chain`,
      ),
    );

    const evidence: Evidence = {
      schema: "fork-evidence/1",
      scenario: "smoke",
      chain: runtime.chainKey,
      chainId: runtime.chainId,
      rpcHost: rpcHost(runtime.rpcUrl),
      forkBlock: runtime.forkBlock ?? null,
      observedBlockNumber,
      generatedAt: new Date().toISOString(),
      checks,
      // Nothing is sent, which is the point — see the header.
      txs: [],
    };

    const path = await writeEvidence(evidenceDir, evidence);
    return { evidence, path, failed: summarise(checks).failed };
  } finally {
    // In a `finally` so a failed check still releases the port. A harness that leaves Anvil
    // running on a failure makes the *next* run fail for an unrelated reason.
    await anvil.stop();
  }
}
