#!/usr/bin/env tsx
/**
 * `@ethonline2026/fork-execution` — the local fork harness.
 *
 * ## Commands
 *
 * | Command | Needs an RPC? | What it does |
 * |---|---|---|
 * | `doctor` | no | Checks the toolchain and reports which chains are configured and which registry values are still unresolved. Safe on a fresh clone. |
 * | `smoke` | yes | Boots a pinned fork per configured chain and verifies the whole registry against real chain state. Sends nothing. |
 * | `flight` | yes | Runs the end-to-end scenario: ship a SwapVM strategy, arm the guard, fill it, and deposit the proceeds into a real Morpho vault. |
 * | `deploy` | yes | Runs the Foundry deploy script against a managed fork and records the addresses it produced. |
 *
 * ## Why `doctor` exists and does not need an RPC
 *
 * The first thing that goes wrong on a fresh checkout is a missing tool or an unset variable, and
 * both produce confusing failures three steps into a scenario. Doctor answers the environment
 * question alone, in one command, with no network.
 *
 * ## Exit codes
 *
 * `0` when everything asked for succeeded, `1` when a check failed or configuration is missing.
 * The nonzero exit is the point: these are meant to be runnable from CI, and a failing check that
 * still exits `0` is a check nobody notices.
 */

import { execFileSync } from "node:child_process";

import { CHAINS, CHAIN_KEYS, requireAddress, unresolvedAddresses, type ChainKey } from "@ethonline2026/oneinch-aqua";

import { anvilPort, evidenceDir, optionalChainRuntime, type ChainRuntime } from "./env.js";
import { deployScenario } from "./scenarios/deploy.js";
import { flightScenario } from "./scenarios/flight.js";
import { smokeScenario } from "./scenarios/smoke.js";

const USAGE = `
fork-execution — local fork harness for the Aqua/SwapVM layer

  doctor     Check the toolchain, and report which chains are configured.
             Needs no RPC, so it is safe on a fresh clone.

  smoke      Boot a pinned fork per configured chain and verify every registered
             address against real chain state. Sends no transactions.
               --chain <key>   only this chain (default: every configured one)\n               --block <n>     pin the fork to this block (default: the chain head)

  flight     Ship a SwapVM strategy, arm the flight guard, fill it, and deposit the
             proceeds into a real Morpho vault. Asserts quote == swap and that the
             USDC and WETH really moved.
               --chain <key>   only this chain (default: every configured one)\n               --block <n>     pin the fork to this block (default: the chain head)

  deploy     Run the Foundry deploy script against a managed fork and record the
             deployed addresses.
               --chain <key>   only this chain (default: every configured one)\n               --block <n>     pin the fork to this block (default: the chain head)

Environment:
  ${CHAIN_KEYS.map((key) => `${CHAINS[key].rpcEnvKey.padEnd(22)} RPC to fork ${CHAINS[key].name} from`).join("\n  ")}
  ${CHAIN_KEYS.map((key) => CHAINS[key].forkBlockEnvKey.padEnd(22)).join(" ")}
                         Pin the fork. Evidence records this block: the same
                         scenario at a different block gives different numbers.
  FORK_ANVIL_PORT        Local port for the scenarios that manage their own node
                         (default 8545)
  FORK_EVIDENCE_DIR      Where evidence is written (default ./evidence)
  FORK_AGENT_ADDRESS     The only address allowed to write a flight verdict
  FORK_ROUTER_OWNER      The address able to rescue tokens sent to the router
`.trim();

/**
 * A problem with how the harness was invoked, rather than with the harness.
 *
 * Kept distinct from every other error because the two want opposite treatment: a usage error needs
 * one line saying what to change, and a stack trace buries that line under frames the caller cannot
 * act on.
 */
class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** Read a `--flag value` pair from argv, or undefined. */
function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

/** A tool's version line, or undefined when it is not installed. */
function toolVersion(command: string, args: readonly string[]): string | undefined {
  try {
    return execFileSync(command, [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim()
      .split("\n")[0];
  } catch {
    return undefined;
  }
}

/**
 * The chain keys a run should touch.
 *
 * Validated up front rather than per-frame: a typo in `--chain` should fail before a fork is
 * booted, not after — and not by silently running nothing at all.
 */
function selectedChains(): readonly ChainKey[] {
  const only = flag("chain");
  if (only === undefined) return CHAIN_KEYS;

  if (!Object.prototype.hasOwnProperty.call(CHAINS, only)) {
    throw new UsageError(`unknown chain "${only}" — expected one of ${CHAIN_KEYS.join(", ")}`);
  }
  return [only as ChainKey];
}

/**
 * The environment a chain's runtime resolves from, with `--block` taking precedence.
 *
 * The flag wins over the chain's `*_FORK_BLOCK` variable rather than requiring a caller to export it:
 * pinning a block is how a run is made reproducible, and a reproduction that needs a different shell
 * setup is one nobody performs.
 */
function runtimeEnv(chainKey: ChainKey): Readonly<Record<string, string | undefined>> {
  const block = flag("block");
  if (block === undefined) return process.env;
  if (!/^\d+$/.test(block) || Number(block) === 0) {
    throw new UsageError(`--block must be a positive integer, got "${block}"`);
  }
  return { ...process.env, [CHAINS[chainKey].forkBlockEnvKey]: block };
}

/**
 * Run one scenario across the selected chains, skipping the unconfigured ones.
 *
 * Skipping rather than failing: a developer with one RPC should be able to exercise one chain, and
 * a matrix run should report which chains it could not reach rather than refusing to start.
 */
async function forEachChain(
  label: string,
  perChain: (
    runtime: ChainRuntime,
    port: number,
  ) => Promise<{ readonly checks: readonly { ok: boolean; name: string; detail: string }[]; readonly path: string }>,
): Promise<number> {
  const port = anvilPort();
  let failures = 0;
  let ran = 0;

  for (const key of selectedChains()) {
    const runtime = optionalChainRuntime(key, runtimeEnv(key));
    if (runtime === undefined) {
      // Names both options: `ALCHEMY_API_KEY` reaches every chain, so a message mentioning only the
      // chain's own variable sends a reader to set something they may not need.
      console.log(`skip  ${key}: set ${CHAINS[key].rpcEnvKey} or ALCHEMY_API_KEY`);
      continue;
    }

    ran += 1;
    process.stdout.write(`run   ${key} ${label} … `);
    const result = await perChain(runtime, port);
    const bad = result.checks.filter((entry) => !entry.ok);
    console.log(`${result.checks.length - bad.length}/${result.checks.length} checks passed -> ${result.path}`);

    for (const failed of bad) {
      console.log(`        FAIL ${failed.name}: ${failed.detail}`);
    }
    failures += bad.length;
  }

  if (ran === 0) {
    console.log(
      `\nno chain was configured, so nothing ran. Set at least one RPC, for example:\n` +
        `  export ${CHAINS[CHAIN_KEYS[0]].rpcEnvKey}=https://…\n` +
        "then re-run. `pnpm run doctor` lists which chains are ready.",
    );
    return 1;
  }

  return failures === 0 ? 0 : 1;
}

function doctor(): number {
  let failures = 0;

  console.log("toolchain");
  for (const [name, args] of [
    ["forge", ["--version"]],
    ["anvil", ["--version"]],
  ] as const) {
    const version = toolVersion(name, args);
    if (version === undefined) {
      console.log(`  MISSING  ${name} — install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup`);
      failures += 1;
    } else {
      console.log(`  ok       ${name.padEnd(6)} ${version}`);
    }
  }

  console.log("\nchains");
  for (const key of CHAIN_KEYS) {
    const deployment = CHAINS[key];
    const runtime = optionalChainRuntime(key, runtimeEnv(key));
    if (runtime === undefined) {
      console.log(
        `  unset    ${key.padEnd(9)} set ${deployment.rpcEnvKey} or ALCHEMY_API_KEY to include it`,
      );
      continue;
    }
    const block = runtime.forkBlock === undefined ? "chain head (not reproducible)" : `block ${runtime.forkBlock}`;
    // Which setting *won*, not which one exists. With a shared key as fallback, naming the chain's
    // own variable here would claim a configuration that may not be in force — and "am I on the
    // dedicated key or the shared one" is precisely the question doctor is being asked.
    const via = runtime.rpcSource === "alchemy" ? "ALCHEMY_API_KEY" : deployment.rpcEnvKey;
    console.log(`  ok       ${key.padEnd(9)} via ${via}, ${runtime.rpcHost}, ${block}`);
  }

  // Reported, not fixed. An unresolved value is a leg that cannot execute, and the honest thing is
  // to say so up front rather than to discover it as a thrown error mid-scenario. Filling one in is
  // a deliberate act: the registry test asserts this exact set.
  const unresolved = unresolvedAddresses();
  console.log("\nregistry");
  console.log(`  ${unresolved.length === 0 ? "ok" : "unresolved"}     ${unresolved.length} unresolved value(s)`);
  for (const entry of unresolved) {
    console.log(`             ${entry.what}`);
  }
  // A spot-check that a resolved address really resolves, so the report is not only a count.
  console.log(
    `  ok       aqua on ${CHAIN_KEYS[0]} resolves to ${requireAddress(CHAINS[CHAIN_KEYS[0]].aqua, "aqua")}`,
  );

  console.log(
    failures === 0
      ? `\nReady. Next: pnpm run smoke --chain ${CHAIN_KEYS[0]}`
      : `\n${failures} tool(s) missing. The harness cannot run without them.`,
  );
  return failures === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  const command = process.argv[2] ?? "help";
  const dir = evidenceDir();

  switch (command) {
    case "doctor":
      return doctor();

    case "smoke":
      return forEachChain("smoke", async (runtime, port) => {
        const result = await smokeScenario({ runtime, port, evidenceDir: dir });
        return { checks: result.evidence.checks, path: result.path };
      });

    case "flight":
      return forEachChain("flight", async (runtime) => {
        // No port: `forge test --fork-url` forks for itself, so this scenario manages no node.
        const result = await flightScenario({ runtime, evidenceDir: dir });
        return { checks: result.evidence.checks, path: result.path };
      });

    case "deploy": {
      const agent = process.env["FORK_AGENT_ADDRESS"];
      const owner = process.env["FORK_ROUTER_OWNER"];
      return forEachChain("deploy", async (runtime, port) => {
        const result = await deployScenario({
          runtime,
          evidenceDir: dir,
          port,
          ...(agent === undefined ? {} : { agentAddress: agent }),
          ...(owner === undefined ? {} : { routerOwner: owner }),
        });
        console.log(
          `\n      router       ${result.addresses.router}\n` +
            `      signalSource ${result.addresses.signalSource}\n` +
            `      refugeApp    ${result.addresses.refugeApp}`,
        );
        return { checks: result.evidence.checks, path: result.path };
      });
    }

    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return 0;

    default:
      console.error(`unknown command "${command}"\n`);
      console.log(USAGE);
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    if (error instanceof UsageError) {
      // Input, not a bug: show the fix, not the frames between the caller and the throw.
      console.error(`error: ${error.message}\n`);
      console.error(USAGE);
      process.exit(2);
    }
    // A thrown error here is a harness bug or a genuinely unexpected failure, not a failed check —
    // checks return a value. Printing the stack is the right call.
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    if (error instanceof Error && error.stack !== undefined) console.error(error.stack);
    process.exit(1);
  });
