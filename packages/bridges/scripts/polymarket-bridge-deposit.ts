/**
 * Deposit USDC into Polymarket via the Bridge, which auto-wraps it to pUSD.
 *
 * ## Why the Bridge rather than the Collateral Onramp
 *
 * The onramp's `wrap(address _asset, ...)` requires **USDC.e**, and the wallet holds
 * native USDC — so the onramp path needs an extra USDC → USDC.e swap first. The
 * Bridge accepts either form, so it removes that step. `/supported-assets` lists
 * both at a $2 minimum, and the balance clears it.
 *
 * ## The irreversibility that shapes this script
 *
 * A bridge deposit is final. The docs are explicit that sending an unsupported
 * token to a bridge address risks irrecoverable loss, and a deposit below the
 * minimum is simply not processed. So this checks the amount against the published
 * minimum before sending, rather than after.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

const here = dirname(fileURLToPath(import.meta.url));
const send = process.argv.includes("--send");

/** From `POST https://bridge.polymarket.com/deposit` for this wallet. */
const BRIDGE_EVM = "0x82A249544bbB84C77c3b54C53ba4A99713F3C9c9" as const;
/** Native USDC on Polygon — the exact token we hold, and a supported asset. */
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as const;
const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
]);
/** Published minimum for Polygon USDC. Below this the deposit is not processed. */
const MIN_USD = 2;
/** Leave a little behind: below the minimum is wasted, and 0.06 covers nothing. */
const DEPOSIT = "3.30";

let step = 0;
function log(label: string, message: string, fields?: Record<string, unknown>): void {
  const stamp = new Date().toISOString().slice(11, 23);
  console.log(`${stamp}  ${String(++step).padStart(2, "0")}  ${label.padEnd(5)}  ${message}${fields === undefined ? "" : `  ${JSON.stringify(fields)}`}`);
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
log("init", "mode", { send, note: send ? "WILL BROADCAST" : "dry run — pass --send" });

const balance = (await publicClient.readContract({
  address: USDC,
  abi: ERC20,
  functionName: "balanceOf",
  args: [account.address],
})) as bigint;
const amount = parseUnits(DEPOSIT, 6);
log("chain", "USDC balance", { usdc: formatUnits(balance, 6), depositing: DEPOSIT });

if (Number(formatUnits(amount, 6)) < MIN_USD) {
  log("fail", "below the published minimum — the deposit would not be processed", { min: MIN_USD });
  process.exit(1);
}
if (balance < amount) {
  log("fail", "balance does not cover the deposit", {
    have: formatUnits(balance, 6),
    need: DEPOSIT,
  });
  process.exit(1);
}
log("ok", "amount clears the minimum and the balance", { min: MIN_USD });

if (!send) {
  log("stop", "dry run complete — pass --send to deposit");
  process.exit(0);
}

const hash = await walletClient.writeContract({
  address: USDC,
  abi: ERC20,
  functionName: "transfer",
  args: [BRIDGE_EVM, amount],
});
log("send", "deposit broadcast", { hash, explorer: `https://polygonscan.com/tx/${hash}` });

const receipt = await publicClient.waitForTransactionReceipt({ hash });
log(receipt.status === "success" ? "ok" : "fail", "mined", {
  status: receipt.status,
  block: receipt.blockNumber.toString(),
});

// The bridge converts asynchronously, so this is where our part ends and theirs
// begins. Status is published per address rather than per transaction.
log("stop", "deposit sent — bridging to pUSD is asynchronous", {
  trackWith: `GET https://bridge.polymarket.com/status/${account.address}`,
});
