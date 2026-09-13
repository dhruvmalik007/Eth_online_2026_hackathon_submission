/**
 * `flight` — the headline scenario: ship a strategy, fly it, deposit the proceeds.
 *
 * ## Why this orchestrates rather than re-implements
 *
 * The on-chain work lives in `test/fork/Flight.fork.t.sol`, and this file runs it. That is not a
 * shortcut — it is the correct boundary. The taker side of a swap is `takerTraitsAndData`: a
 * 176-bit header plus up to ten variable slices, encoding **direction and slippage bound**.
 * Re-encoding that here would create a second implementation that can disagree with the contract
 * silently, so the scenario uses upstream's Solidity encoder and this file does what a harness
 * should: run the thing, read the results, and write them down.
 *
 * ## Why forge's own fork rather than a managed Anvil
 *
 * `forge test --fork-url` already forks and pins. Booting a separate Anvil only to point forge at
 * it would add a process and a port for no benefit. `smoke` manages Anvil because *it* is the
 * client; here forge is, so forge forks.
 *
 * ## Two sources of truth, deliberately
 *
 * `forge test --json` says whether each test passed. The contract's own `out/evidence/*.json`
 * says what it observed. Both are read, and the claims that matter are re-derived here from the
 * raw numbers — so a test that passed for the wrong reason still shows up, because the numbers
 * would not add up.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import { rpcHost, type ChainRuntime } from "../env.js";
import { check, summarise, writeEvidence, type Check, type Evidence } from "../evidence.js";

const run = promisify(execFile);

/** Where the Foundry project lives, overridable for an out-of-tree checkout. */
function contractsDir(): string {
  return (
    process.env["FORK_CONTRACTS_DIR"] ??
    new URL("../../../../packages/oneInch/contracts", import.meta.url).pathname
  );
}

/**
 * A decimal integer carried as a string.
 *
 * Amounts arrive as strings because `vaultShares` is ~3.3e21 — past the 2^53 a JSON number holds.
 * Parsing them as `number` would round silently and the comparisons below would then be between
 * numbers nobody observed. This is the same rule the capability port enforces for
 * `UnsignedTransaction.value`.
 */
const decimalString = z.string().regex(/^\d+$/, "expected a decimal integer string");

/**
 * The facts the Solidity scenario writes.
 *
 * Parsed strictly: a missing field means the scenario did not run the path it claims to, which is
 * exactly the failure a lenient read would hide behind `undefined`.
 */
const FactsSchema = z.object({
  // Small enough to be genuine JSON numbers: a chain id, a block, a log count.
  chainId: z.number().int().positive(),
  forkBlock: z.number().int().positive(),
  routerLogCount: z.number().int().nonnegative(),
  // Addresses, as written.
  router: z.string(),
  signalSource: z.string(),
  strategyHash: z.string(),
  usdc: z.string(),
  weth: z.string(),
  vault: z.string(),
  taker: z.string(),
  maker: z.string(),
  // Amounts, as decimal strings.
  band: decimalString,
  swapAmount: decimalString,
  quotedIn: decimalString,
  quotedOut: decimalString,
  actualIn: decimalString,
  actualOut: decimalString,
  depositedUsdc: decimalString,
  vaultShares: decimalString,
});
type RawFacts = z.infer<typeof FactsSchema>;

/** The facts with the amounts as `bigint`, which is the only type safe to compare them in. */
export interface FlightFacts {
  readonly chainId: number;
  readonly forkBlock: number;
  readonly routerLogCount: number;
  readonly router: string;
  readonly signalSource: string;
  readonly strategyHash: string;
  readonly usdc: string;
  readonly weth: string;
  readonly vault: string;
  readonly taker: string;
  readonly maker: string;
  readonly band: bigint;
  readonly swapAmount: bigint;
  readonly quotedIn: bigint;
  readonly quotedOut: bigint;
  readonly actualIn: bigint;
  readonly actualOut: bigint;
  readonly depositedUsdc: bigint;
  readonly vaultShares: bigint;
}

function toFacts(raw: RawFacts): FlightFacts {
  return {
    ...raw,
    band: BigInt(raw.band),
    swapAmount: BigInt(raw.swapAmount),
    quotedIn: BigInt(raw.quotedIn),
    quotedOut: BigInt(raw.quotedOut),
    actualIn: BigInt(raw.actualIn),
    actualOut: BigInt(raw.actualOut),
    depositedUsdc: BigInt(raw.depositedUsdc),
    vaultShares: BigInt(raw.vaultShares),
  };
}

/** The slice of `forge test --json` this reads. Permissive, because forge owns the shape. */
const ForgeJsonSchema = z.record(
  z.string(),
  z.object({
    test_results: z.record(
      z.string(),
      z.object({
        status: z.string(),
        reason: z.string().nullable().optional(),
      }),
    ),
  }),
);

export interface FlightOptions {
  readonly runtime: ChainRuntime;
  readonly evidenceDir: string;
  /** Passed straight through to forge, for a slow RPC. */
  readonly timeoutMs?: number;
}

export interface FlightResult {
  readonly evidence: Evidence;
  readonly path: string;
  readonly failed: number;
  /** The contract's raw observations, for a caller that wants to assert further. */
  readonly facts: FlightFacts;
}

export async function flightScenario(options: FlightOptions): Promise<FlightResult> {
  const { runtime, evidenceDir } = options;
  const cwd = contractsDir();

  const args = [
    "test",
    "--match-path",
    "test/fork/Flight.fork.t.sol",
    "--fork-url",
    runtime.rpcUrl,
    "--json",
    // `-vv` so a failure carries its logs; `--json` keeps the result machine-readable.
    "-vv",
  ];
  if (runtime.forkBlock !== undefined) {
    args.push("--fork-block-number", String(runtime.forkBlock));
  }

  // A nonzero exit means a test failed or compilation broke — both legitimate outcomes this
  // records rather than throws on, so `stdout` is parsed either way.
  const { stdout } = await run("forge", args, {
    cwd,
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeoutMs ?? 15 * 60_000,
  }).catch((error: unknown) => {
    const failure = error as { stdout?: string; stderr?: string };
    if (typeof failure.stdout === "string" && failure.stdout.trim().length > 0) {
      return { stdout: failure.stdout, stderr: failure.stderr ?? "" };
    }
    throw new Error(`forge test produced no output: ${String(failure.stderr ?? error).slice(0, 600)}`);
  });

  const parsed = ForgeJsonSchema.safeParse(JSON.parse(stdout) as unknown);
  if (!parsed.success) {
    throw new Error(
      `could not read \`forge test --json\` output: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }

  const checks: Check[] = [];
  for (const [suite, result] of Object.entries(parsed.data)) {
    for (const [name, test] of Object.entries(result.test_results)) {
      const ok = test.status === "Success";
      checks.push(
        check(`forge:${suite.split(":")[1] ?? suite}.${name}`, ok, ok ? "passed" : (test.reason ?? "failed")),
      );
    }
  }

  // Read the contract's observations and re-derive the claims from the raw numbers.
  const factsPath = join(cwd, "out", "evidence", `flight-${runtime.chainId}.json`);
  const facts = toFacts(FactsSchema.parse(JSON.parse(await readFile(factsPath, "utf8")) as unknown));

  checks.push(
    check(
      "quoteEqualsSwap",
      facts.quotedIn === facts.actualIn && facts.quotedOut === facts.actualOut,
      `quote ${facts.quotedIn}/${facts.quotedOut} vs swap ${facts.actualIn}/${facts.actualOut} — ` +
        "SwapVM's core invariant, and the strongest single signal the instruction is correct",
    ),
    check(
      "clampedToTheBand",
      facts.actualOut === facts.band,
      `output ${facts.actualOut} vs band ${facts.band} — a band that did not bind would prove nothing`,
    ),
    check(
      "inputUnchanged",
      facts.actualIn === facts.swapAmount,
      "the taker's input must not be touched by an exactIn clamp",
    ),
    check(
      "vaultSharesMinted",
      facts.vaultShares > 0n,
      `${facts.depositedUsdc} USDC of proceeds deposited for ${facts.vaultShares} shares in ` +
        `${facts.vault} — a real position, not a hardcoded address`,
    ),
    check(
      "proceedsFullyDeployed",
      facts.depositedUsdc === facts.actualOut,
      "the whole flight output was deployed, so nothing is left stranded between the two legs",
    ),
    check(
      "routerEmitted",
      facts.routerLogCount > 0,
      `${facts.routerLogCount} log(s) from ${facts.router}, so the redeployed router did the work`,
    ),
  );

  const evidence: Evidence = {
    schema: "fork-evidence/1",
    scenario: "flight",
    chain: runtime.chainKey,
    chainId: runtime.chainId,
    rpcHost: rpcHost(runtime.rpcUrl),
    forkBlock: runtime.forkBlock ?? null,
    // The block forge actually served, which is the number every figure above depends on.
    observedBlockNumber: facts.forkBlock,
    generatedAt: new Date().toISOString(),
    checks,
    // A fork sends no real transaction, so there are no hashes to record. Stated explicitly
    // rather than omitted, so a reader can tell "no hashes" from "not reported".
    txs: [],
  };

  const path = await writeEvidence(evidenceDir, evidence);
  return { evidence, path, failed: summarise(checks).failed, facts };
}
