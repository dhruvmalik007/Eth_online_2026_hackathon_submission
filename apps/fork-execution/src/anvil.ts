/**
 * Anvil lifecycle for a pinned fork.
 *
 * ## Why the local node is a child process rather than a library call
 *
 * Foundry's `anvil` is the reference implementation of a fork, and the harness runs the same
 * binary a developer would run by hand. Wrapping it in a JS library would add a layer that
 * can differ from the documented flags — and the flags are the part that matters, because a
 * mis-set `--fork-block-number` is exactly the kind of thing that makes evidence
 * irreproducible.
 *
 * ## Why readiness means "the right chain answered" and not "the port is open"
 *
 * An Anvil that has bound its port but not finished forking will accept a connection and
 * answer `eth_chainId` from a partially-initialised state; worse, an `anvil` pointed at the
 * wrong RPC will come up happily on the wrong chain. Polling for the *expected* chain id is
 * one extra comparison and it turns both of those into a loud failure at startup instead of
 * confusing results three steps later.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createPublicClient, http } from "viem";

export class AnvilError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnvilError";
  }
}

export interface AnvilInstance {
  /** `http://127.0.0.1:<port>` */
  readonly url: string;
  readonly port: number;
  readonly pid: number | undefined;
  /** Terminate the node, escalating if it does not exit. Safe to call twice. */
  stop(): Promise<void>;
}

export interface StartAnvilOptions {
  /** The upstream RPC to fork from. */
  readonly rpcUrl: string;
  /** The chain id the local node must report — checked, not assumed. */
  readonly chainId: number;
  /** Pin the fork. Omitted forks the chain head, which is not reproducible. */
  readonly forkBlock?: number;
  readonly port: number;
  /** Where Anvil's own output goes, for diagnosing a failed boot. */
  readonly logPath?: string;
  /** How long to wait for the node to answer on the right chain. */
  readonly timeoutMs?: number;
}

/**
 * Boot Anvil and wait until it reports the expected chain.
 *
 * @throws {AnvilError} when the binary is missing, the node exits during startup, or it comes
 *   up on the wrong chain. The message includes the port and the chain because those are the
 *   two facts that distinguish the failure modes.
 */
export async function startAnvil(options: StartAnvilOptions): Promise<AnvilInstance> {
  const args = [
    "--fork-url",
    options.rpcUrl,
    "--chain-id",
    String(options.chainId),
    "--port",
    String(options.port),
    "--host",
    "127.0.0.1",
    // Auto-impersonation is what lets a scenario act as a token whale without a private key.
    // It is scoped to this local node by construction — the flag has no effect on a real
    // chain — which is why it is safe to enable by default here.
    "--auto-impersonate",
    "--silent",
  ];
  if (options.forkBlock !== undefined) {
    args.push("--fork-block-number", String(options.forkBlock));
  }

  let child: ChildProcess;
  try {
    child = spawn("anvil", args, { stdio: options.logPath === undefined ? "ignore" : ["ignore", "pipe", "pipe"] });
  } catch (error) {
    throw new AnvilError(
      `Could not start anvil: ${(error as Error).message}. Is Foundry installed? \`curl -L https://foundry.paradigm.xyz | bash && foundryup\``,
    );
  }

  let exited: string | undefined;
  child.on("error", (error) => {
    exited = `spawn failed: ${error.message}`;
  });
  child.on("exit", (code, signal) => {
    exited = `exited with code ${String(code)} signal ${String(signal)}`;
  });

  const url = `http://127.0.0.1:${options.port}`;

  try {
    await waitForChain({ url, chainId: options.chainId, timeoutMs: options.timeoutMs ?? 60_000, exited: () => exited });
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }

  let stopped = false;
  return {
    url,
    port: options.port,
    pid: child.pid,
    async stop() {
      // Idempotent: a scenario that fails after `stop()` and unwinds through a `finally` would
      // otherwise try to kill an already-dead process and mask the real error.
      if (stopped) return;
      stopped = true;

      if (child.exitCode !== null || child.signalCode !== null) return;

      const terminated = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGTERM");

      // Anvil normally exits promptly on SIGTERM. If it does not, waiting forever would hang
      // the harness, so escalate after a bounded grace period — leaving a stray process
      // holding a port would break the next run.
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      try {
        await terminated;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Poll until the node answers with the expected chain id.
 *
 * @throws {AnvilError} on timeout, or immediately when Anvil has already exited — retrying a
 *   dead process for sixty seconds would turn a fast failure into a slow one.
 */
async function waitForChain(input: {
  readonly url: string;
  readonly chainId: number;
  readonly timeoutMs: number;
  readonly exited: () => string | undefined;
}): Promise<void> {
  const client = createPublicClient({ transport: http(input.url, { retryCount: 0, timeout: 5_000 }) });
  const deadline = Date.now() + input.timeoutMs;

  let lastError = "no attempt made";
  while (Date.now() < deadline) {
    const exitReason = input.exited();
    if (exitReason !== undefined) {
      throw new AnvilError(`anvil ${exitReason} before it served chain ${input.chainId} on ${input.url}.`);
    }

    try {
      const reported = await client.getChainId();
      if (reported === input.chainId) return;
      throw new AnvilError(
        `anvil is serving chain ${reported} but this run expects chain ${input.chainId}. ` +
          `Check that the RPC in the environment points at the right network — a fork of the wrong chain produces ` +
          `evidence that looks plausible and describes nothing.`,
      );
    } catch (error) {
      if (error instanceof AnvilError) throw error;
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new AnvilError(
    `anvil did not serve chain ${input.chainId} at ${input.url} within ${input.timeoutMs}ms (last error: ${lastError}).`,
  );
}
