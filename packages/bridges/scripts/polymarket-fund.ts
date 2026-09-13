/**
 * Fund the Polymarket test: swap POL → USDC on Polygon via LI.FI.
 *
 * ## Why LI.FI rather than a hand-picked DEX
 *
 * The adapter already routes and builds this transaction — the same code path the
 * bridge scenarios use — so the swap costs no new integration. LI.FI also splits
 * across sources and returns the calldata, which means the transaction is built by
 * a venue that has simulated it rather than by an ABI assembled here.
 *
 * ## The order is deliberate, and it is the point
 *
 * quote → build → **simulate** → send → wait. The simulation is not optional: a
 * swap that reverts on-chain still costs the gas of the attempt, and a native
 * swap that drains the gas balance leaves a wallet unable to do the approval that
 * follows. `--send` is required to broadcast, so a plain run is a dry run.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { LiFiBridge } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const send = process.argv.includes("--send");
const POL_AMOUNT = 10n * 10n ** 18n; // ~1 USDC at recent prices, leaving gas behind
const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as const;

let step = 0;
function log(label: string, message: string, fields?: Record<string, unknown>): void {
  const stamp = new Date().toISOString().slice(11, 23);
  const extra = fields === undefined ? "" : `  ${JSON.stringify(fields)}`;
  console.log(`${stamp}  ${String(++step).padStart(2, "0")}  ${label.padEnd(5)}  ${message}${extra}`);
}

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const line of readFileSync(join(here, "..", ".env"), "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    let value = match[2].trim().replace(/^["']|["']$/g, "");
    if (match[1].endsWith("PRIVATE_KEY") && !value.startsWith("0x")) value = `0x${value}`;
    out[match[1]] = value;
  }
  return out;
}

const env = loadEnv();
const account = privateKeyToAccount(env['PRIVATE_KEY'] as `0x${string}`);
const rpc = env['POLYGON_RPC_URL'] ?? "";
const publicClient = createPublicClient({ chain: polygon, transport: http(rpc) });
const walletClient = createWalletClient({ account, chain: polygon, transport: http(rpc) });

log("init", "account", { address: account.address });
log("init", "mode", { send, note: send ? "WILL BROADCAST" : "dry run — pass --send to broadcast" });

const nativeBalance = await publicClient.getBalance({ address: account.address });
log("chain", "POL balance", { pol: formatUnits(nativeBalance, 18) });
if (nativeBalance <= POL_AMOUNT) {
  log("fail", "balance does not cover the swap plus gas — stopping");
  process.exit(1);
}

// ── Quote ────────────────────────────────────────────────────────────────────
const lifi = new LiFiBridge({ integrator: "agentic-ems", rpcUrls: { [polygon.id]: rpc } });
const started = Date.now();
const quote = await lifi.quote({
  fromChainId: polygon.id,
  toChainId: polygon.id,
  // The native sentinel: POL is the gas token, so it has no ERC-20 address and
  // the swap carries the amount in `value` rather than as calldata.
  fromTokenAddress: NATIVE,
  toTokenAddress: USDC,
  fromAmount: POL_AMOUNT.toString(),
  fromAddress: account.address,
});
log("lifi", "route search", { ms: Date.now() - started, ok: quote.ok });

if (!quote.ok) {
  log("fail", "no route", { reason: quote.reason, detail: quote.detail ?? "(none)" });
  process.exit(1);
}

const hop = quote.quote.hops[0];
log("ok", "route found", { hops: quote.quote.hops.length, tool: hop?.protocol ?? "(unknown)" });
for (const fee of quote.quote.feeLines) {
  log("chain", `  fee ${fee.id}`, { usd: fee.amountUsd, included: fee.included });
}
log("lifi", "quote", {
  toAmount: quote.quote.hops[0]?.toAmount ?? "(none)",
  expiresAt: quote.quote.expiresAt.toISOString(),
});

// ── Build ────────────────────────────────────────────────────────────────────
const tx = await lifi.build(quote.quote, { sender: account.address, chainId: polygon.id });
log("build", "transaction built", {
  to: tx.to,
  value: formatUnits(BigInt(tx.value), 18) + " POL",
  dataBytes: (tx.data.length - 2) / 2,
});

// ── Simulate ─────────────────────────────────────────────────────────────────
// A revert here costs nothing. The same revert after broadcast costs the gas of a
// failed transaction and tells us nothing new.
const simStarted = Date.now();
try {
  await publicClient.call({
    account: account.address,
    to: tx.to as `0x${string}`,
    data: tx.data as `0x${string}`,
    value: BigInt(tx.value),
  });
  log("ok", "simulation passed", { ms: Date.now() - simStarted });
} catch (error) {
  log("fail", "simulation reverted — NOT broadcasting", {
    detail: (error instanceof Error ? error.message : String(error)).slice(0, 200),
  });
  process.exit(1);
}

if (!send) {
  log("stop", "dry run complete — pass --send to broadcast");
  process.exit(0);
}

// ── Send ─────────────────────────────────────────────────────────────────────
const hash = await walletClient.sendTransaction({
  to: tx.to as `0x${string}`,
  data: tx.data as `0x${string}`,
  value: BigInt(tx.value),
});
log("send", "broadcast", { hash, explorer: `https://polygonscan.com/tx/${hash}` });

const receipt = await publicClient.waitForTransactionReceipt({ hash });
log(receipt.status === "success" ? "ok" : "fail", "mined", {
  status: receipt.status,
  block: receipt.blockNumber.toString(),
  gasUsed: receipt.gasUsed.toString(),
});

const after = await publicClient.readContract({
  address: USDC,
  abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const,
  functionName: "balanceOf",
  args: [account.address],
});
log("ok", "USDC landed", { usdc: formatUnits(after, 6) });
