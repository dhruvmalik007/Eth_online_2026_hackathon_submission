/**
 * Build a CCTP burn and a LayerZero send, print them, and verify both ABIs
 * against the live chains — without sending anything.
 *
 * ## What makes this a simulation rather than a send
 *
 * Three things, all deliberate:
 *
 * 1. Nothing is signed. There is no `walletClient`, no `sendTransaction`, and the
 *    private key is used only to derive the address the transaction names.
 * 2. The ABI check is an `eth_call` — a read. It costs no gas and changes no
 *    state, which is why it is safe to run against mainnet.
 * 3. A `send` is never executed. `encodeFunctionData` produces calldata; only
 *    broadcasting it would move funds.
 *
 * ## Why the probe matters
 *
 * A wrong ABI and an unfunded wallet both produce a revert, so a failure alone
 * proves nothing. `probeCall` reads the **message**: a contract-level revert
 * (`insufficient allowance`) means the signature resolved and execution began,
 * whereas a missing-selector revert means the ABI itself is wrong. That is the
 * difference between "I cannot afford this" and "I built the wrong transaction".
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Options } from "@layerzerolabs/lz-v2-utilities";
import { createPublicClient, http, toHex } from "viem";
import { ENDPOINT_V2_ADDRESS, encodeCctpBurn, encodeLayerZeroSend, probeCall } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const started = Date.now();

function log(stage: string, message: string, fields?: Record<string, unknown>): void {
  const elapsed = `${((Date.now() - started) / 1000).toFixed(1)}s`.padStart(7);
  const extra = fields === undefined ? "" : `  ${Object.entries(fields).map(([k, v]) => `${k}=${String(v)}`).join("  ")}`;
  console.log(`[${elapsed}] ${stage} ${message}${extra}`);
}

function env(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      out[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  return out;
}

const variables = env(join(here, "..", ".env"));
const file = JSON.parse(readFileSync(join(here, "..", "test-scenarios.json"), "utf8")) as {
  chains: Record<string, { chainId: number; rpcEnv: string; cctpDomain: number }>;
  tokens: Record<string, string>;
};

const SENDER = "0x000000000000000000000000000000000000dEaD" as const;
const SEPOLIA_TOKEN_MESSENGER = "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5" as const;
const BASE_EID = 30184;

async function main(): Promise<void> {
  log("info", "SIMULATION ONLY — nothing is signed, nothing is broadcast");

  // ── CCTP: burn on Sepolia, mint on Arc Testnet (domain 26) ────────────────
  log("step", "CCTP burn: Sepolia → Arc Testnet", { domain: 26, amount: "1000000 (1 USDC)" });

  const cctp = encodeCctpBurn({
    chainId: 11155111,
    tokenMessenger: SEPOLIA_TOKEN_MESSENGER,
    amount: 1_000_000n,
    destinationDomain: 26,
    mintRecipient: SENDER,
    // Sepolia's USDC. Burning the wrong token on the wrong chain is unrecoverable.
    burnToken: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    // `0` selects CCTP's free slow path over the paid fast one.
    minFinalityThreshold: 0,
  });

  log("ok", "CCTP transaction built", {
    to: cctp.to,
    value: cctp.value.toString(),
    dataBytes: (cctp.data.length - 2) / 2,
    selector: cctp.data.slice(0, 10),
  });
  log("chain", `  ${cctp.summary}`);
  log("chain", `  calldata ${cctp.data.slice(0, 74)}…`);

  const sepoliaClient = createPublicClient({
    transport: http(variables["ETHEREUM_RPC_URL"] ?? "https://ethereum-sepolia-rpc.publicnode.com"),
  });
  const cctpProbe = await probeCall(sepoliaClient, cctp);
  log(cctpProbe.resolved ? "ok" : "fail", "CCTP ABI verified against the live contract", {
    resolved: cctpProbe.resolved,
    detail: cctpProbe.reason,
  });

  // ── LayerZero: send Polygon → Base ────────────────────────────────────────
  log("step", "LayerZero send: Polygon → Base", { dstEid: BASE_EID, endpoint: ENDPOINT_V2_ADDRESS });

  const options = toHex(Options.newOptions().addExecutorLzReceiveOption(200_000, 0).toBytes());
  log("chain", "LayerZero options encoded", { bytes: options.slice(0, 42) + "…" });

  const layerzero = encodeLayerZeroSend({
    chainId: 137,
    endpoint: ENDPOINT_V2_ADDRESS,
    dstEid: BASE_EID,
    receiver: SENDER,
    options,
    // The fee a `quote` returns. Omitted here, so this transaction carries none —
    // which the contract accepts and never delivers, the reason the field exists.
    refundAddress: SENDER,
  });

  log("ok", "LayerZero transaction built", {
    to: layerzero.to,
    value: layerzero.value.toString(),
    dataBytes: (layerzero.data.length - 2) / 2,
    selector: layerzero.data.slice(0, 10),
  });
  log("chain", `  ${layerzero.summary}`);
  log("chain", `  calldata ${layerzero.data.slice(0, 74)}…`);

  const polygonClient = createPublicClient({
    transport: http(variables["POLYGON_RPC_URL"] ?? "https://polygon-rpc.com"),
  });
  const lzProbe = await probeCall(polygonClient, layerzero);
  log(lzProbe.resolved ? "ok" : "fail", "LayerZero ABI verified against the live contract", {
    resolved: lzProbe.resolved,
    detail: lzProbe.reason,
  });

  log("ok", "simulation complete — no transaction was signed or broadcast", {
    file: file.chains["polygon"]?.chainId,
    tokens: Object.keys(file.tokens).length,
  });
}

void main();
