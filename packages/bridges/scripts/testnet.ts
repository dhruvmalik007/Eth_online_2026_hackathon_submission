/**
 * Verbose testnet harness for the three bridge adapters.
 *
 * Reads `test-scenarios.json` — the source of truth for chains, wallets and
 * endpoints — and drives each adapter, narrating what happens.
 *
 * ## Two modes, and why
 *
 * - `--quote` (default): quote only. **Never sends.** This is the mode that runs
 *   today, without any funded key, and it exercises every adapter's read path.
 * - `--send`: actually send, then poll to completion. Requires a funded key.
 *
 * The split matters because a quote is where the fee mapping is proven, and it
 * needs no funds — so the interesting failure (a mis-mapped `included` flag, a
 * wrong domain) is caught before anyone spends anything.
 *
 * ## Why the logs are this loud
 *
 * A bridge is asynchronous by nature: between "sent" and "delivered" nothing is
 * happening locally, and without narration a hang is indistinguishable from
 * progress. So every stage, every poll attempt and every elapsed interval is
 * printed — including the waits.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import {
  CircleCctpBridge,
  CircleQuoteApiReader,
  DefiLlamaPriceSource,
  ENDPOINT_V2_ADDRESS,
  EndpointFeeReader,
  LayerZeroBridge,
  LiFiBridge,
} from "../src/index.js";
import type { CctpChain, CctpSpeed } from "../src/circleCctp.js";

const here = dirname(fileURLToPath(import.meta.url));

/** A 32-byte hex key, narrowed without a cast. */
function isPrivateKey(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * The demonstrator's address, derived from `PRIVATE_KEY`.
 *
 * Derived rather than configured, because a key and an address can disagree — and
 * a quote built for an address that will not sign is a simulation of the wrong
 * transaction. Only the *address* leaves this function; the key is never logged,
 * never written to the results file, and never sent to a quote call.
 */
function senderAddress(env: Readonly<Record<string, string | undefined>>): `0x${string}` | undefined {
  const key = env["PRIVATE_KEY"];
  if (key === undefined || !isPrivateKey(key)) return undefined;
  return privateKeyToAccount(key).address;
}
const root = join(here, "..");
const started = Date.now();

// ─── Logging ────────────────────────────────────────────────────────────────

const LEVEL_TAGS: Record<string, string> = {
  step: "▶",
  chain: "⛓",
  poll: "…",
  ok: "✔",
  warn: "!",
  fail: "✘",
  info: " ",
};

/** Timestamped, tagged, and always flushed — a buffered log hides a hang. */
function log(level: keyof typeof LEVEL_TAGS, message: string, fields?: Record<string, unknown>): void {
  const at = ((Date.now() - started) / 1000).toFixed(1).padStart(6);
  const suffix =
    fields === undefined || Object.keys(fields).length === 0
      ? ""
      : `  ${Object.entries(fields)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(" ")}`;
  console.log(`[${at}s] ${LEVEL_TAGS[level]} ${message}${suffix}`);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll until `attempt` yields something, narrating each try.
 *
 * The narration is the feature: a silent retry loop that eventually succeeds and
 * a silent retry loop that eventually gives up look identical in a log.
 */
async function pollUntil<T>(options: {
  what: string;
  attempts: number;
  intervalMs: number;
  attempt: (n: number) => Promise<T | undefined>;
}): Promise<T | undefined> {
  log("poll", `waiting for ${options.what}`, {
    maxAttempts: options.attempts,
    every: `${options.intervalMs / 1000}s`,
  });
  for (let n = 1; n <= options.attempts; n++) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const result = await options.attempt(n);
    if (result !== undefined) {
      log("ok", `${options.what} resolved`, { attempt: n, elapsed });
      return result;
    }
    log("poll", `${options.what} not yet`, { attempt: n, elapsed });
    if (n < options.attempts) await sleep(options.intervalMs);
  }
  log("warn", `${options.what} did not resolve in ${options.attempts} attempts`);
  return undefined;
}

// ─── Config ─────────────────────────────────────────────────────────────────

interface ScenarioFile {
  chains: Record<
    string,
    {
      label: string;
      chainId: number;
      cctpDomain: number;
      lzEid: number;
      rpcEnv: string;
      /** The SDK's own `BridgeChain` key — PascalCase, unlike our readable key. */
      bridgeChain?: string;
      /** Absent means testnet. Mainnet uses Circle's production host, not the sandbox. */
      network?: string;
    }
  >;
  wallets: Record<string, { name: string; envKey: string }>;
  /** Token addresses by key, so a scenario names tokens rather than hex. */
  tokens?: Record<string, string>;
  apis: Record<string, Record<string, string>>;
  amounts: { usdc: string; usdcLabel: string };
  scenarios: Array<Record<string, string | number>>;
  missingConfig: Array<{ for: string; value: string; why: string; youProvide: string }>;
  results: Record<string, unknown>;
}

/** Load `.env` without a dependency — this is a script, not the library. */
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  try {
    for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match?.[1] !== undefined && env[match[1]] === undefined) env[match[1]] = match[2] ?? "";
    }
  } catch {
    log("warn", "no .env found — relying on the ambient environment");
  }
  return env;
}

const env = loadEnv();
const scenarioPath = join(root, "test-scenarios.json");
const file = JSON.parse(readFileSync(scenarioPath, "utf8")) as ScenarioFile;

const mode = process.argv.includes("--send") ? "send" : "quote";

// ─── Adapters ───────────────────────────────────────────────────────────────

function buildCctp(network: "mainnet" | "testnet"): CircleCctpBridge {
  // Keyed by BOTH the readable key and the SDK's chain name, because the domain
  // map is looked up by whatever the caller passes — and the scenario passes the
  // SDK name. Keying only by the readable name made every CCTP quote throw.
  const domainByChain = Object.fromEntries(
    Object.entries(file.chains).flatMap(([name, chain]) => [
      [chain.bridgeChain ?? name, chain.cctpDomain],
      [name, chain.cctpDomain],
    ]),
  ) as Record<CctpChain, number>;

  // Testnet domains live on Circle's sandbox host; mainnet domains on production.
  // Pointing a mainnet domain at the sandbox fails, and vice versa.
  const baseUrl =
    network === "mainnet"
      ? (file.apis['circleQuote']?.['production'] ?? "https://iris-api.circle.com")
      : (file.apis['circleQuote']?.['sandbox'] ?? "https://iris-api-sandbox.circle.com");

  return new CircleCctpBridge({
    quoteReader: new CircleQuoteApiReader({
      baseUrl,
      domainByChain,
      ...(env['CIRCLE_TEST_API_KEY'] === undefined ? {} : { apiKey: env['CIRCLE_TEST_API_KEY'] }),
    }),
    ...(env['CIRCLE_API_KEY'] === undefined ? {} : { apiKey: env['CIRCLE_API_KEY'] }),
  });
}

function buildLiFi(): LiFiBridge {
  const rpcUrls = Object.fromEntries(
    Object.values(file.chains).map((chain) => [chain.chainId, env[chain.rpcEnv] ?? ""]),
  ) as Record<number, string>;

  // The key is a **fallback**, not the default.
  //
  // LI.FI enforces its limit per key (100 RPM here) and the observed 401 came
  // from attaching it at all — while a keyless request resolved a route fine. So
  // requests go keyless, and the key is attached only when a caller opts in with
  // `--with-key`, which is what a rate-limit retry should do.
  const useKey = process.argv.includes("--with-key");
  const apiKey = env['LIFI_API_KEY'];
  if (useKey && apiKey !== undefined) log("info", "LI.FI API key attached (fallback path)");
  else log("info", "LI.FI request without an API key", { fallbackAvailable: apiKey !== undefined });

  return new LiFiBridge({
    integrator: env['LIFI_INTEGRATOR'] ?? "agentic-ems",
    ...(useKey && apiKey !== undefined ? { apiKey } : {}),
    rpcUrls,
  });
}

function buildLayerZero(): LayerZeroBridge | undefined {
  const rpcUrls = Object.fromEntries(
    Object.values(file.chains).map((chain) => [chain.chainId, env[chain.rpcEnv] ?? ""]),
  ) as Record<number, string>;

  // The V2 **endpoint** is the protocol's own contract at the same address on
  // every chain, and it exposes the same quote in `MessagingParams` form. Using
  // it means no OApp address is needed — which is what made LayerZero the one
  // adapter nobody could quote with out of the box.
  const endpointByChainId = Object.fromEntries(
    Object.values(file.chains)
      .filter((chain) => chain.chainId > 0)
      .map((chain) => [chain.chainId, ENDPOINT_V2_ADDRESS]),
  ) as Record<number, `0x${string}`>;

  // An explicit OApp still wins where one is configured, because that is what
  // actually sends and the fee is its.
  for (const chain of Object.values(file.chains)) {
    const address = env[`LAYERZERO_OAPP_${chain.chainId}`];
    if (address !== undefined && address.length > 0) {
      endpointByChainId[chain.chainId] = address as `0x${string}`;
      log("info", "LayerZero OApp override in use", { chainId: chain.chainId, address });
    }
  }

  log("info", "LayerZero fee reader: endpoint form", { endpoint: ENDPOINT_V2_ADDRESS });

  return new LayerZeroBridge({
    scanBaseUrl: file.apis['layerzeroScan']?.['testnet'] ?? "https://scan-testnet.layerzero-api.com/v1",
    feeReader: new EndpointFeeReader({ rpcUrls, endpointByChainId }),
    endpointByChainId,
    // The endpoint returns wei; this is what turns it into a dollar figure.
    nativePrice: new DefiLlamaPriceSource(),
  });
}

// ─── Runner ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log("step", "testnet bridge harness", { mode, scenarios: file.scenarios.length });

  log("step", "chains under test");
  for (const [name, chain] of Object.entries(file.chains)) {
    const rpc = env[chain.rpcEnv];
    log("chain", chain.label, {
      key: name,
      chainId: chain.chainId,
      cctpDomain: chain.cctpDomain,
      lzEid: chain.lzEid,
      rpc: rpc === undefined ? "MISSING" : `${rpc.slice(0, 24)}…`,
    });
  }

  for (const wallet of Object.values(file.wallets)) {
    const key = env[wallet.envKey];
    log("chain", `wallet "${wallet.name}"`, {
      env: wallet.envKey,
      present: key !== undefined && key.length > 0,
    });
  }

  // One reader per network: a mainnet domain against the sandbox host fails.
  const cctpByNetwork = { mainnet: buildCctp("mainnet"), testnet: buildCctp("testnet") };
  const lifi = buildLiFi();
  const layerzero = buildLayerZero();
  if (layerzero === undefined) {
    log("warn", "LayerZero scenarios will be SKIPPED — no OApp address configured");
    for (const missing of file.missingConfig) {
      log("warn", `needs ${missing.value} for ${missing.for}: ${missing.why}`);
      log("warn", `you provide: ${missing.youProvide}`);
    }
  }

  const results: Record<string, unknown> = { ...file.results };

  for (const scenario of file.scenarios) {
    const id = String(scenario['id']);
    const adapter = String(scenario['adapter']);
    const fromKey = String(scenario['from']);
    const toKey = String(scenario['to']);
    const from = file.chains[fromKey];
    const to = file.chains[toKey];

    log("step", `scenario ${id}`, {
      adapter,
      route: `${from?.label ?? fromKey} → ${to?.label ?? toKey}`,
      amount: file.amounts.usdcLabel,
    });

    const quoteStarted = Date.now();
    try {
      if (adapter === "circle-cctp" && from !== undefined && to !== undefined) {
        const cctp = cctpByNetwork[from.network === "mainnet" ? "mainnet" : "testnet"];
        const quote = await cctp.quote({
          // The SDK's own chain keys, not our readable ones: `BridgeChain` uses
          // PascalCase names and `supports()` checks membership against them.
          from: (from.bridgeChain ?? fromKey) as CctpChain,
          to: (to.bridgeChain ?? toKey) as CctpChain,
          amount: file.amounts.usdc,
          recipient: "0x000000000000000000000000000000000000dEaD",
          speed: String(scenario['speed'] ?? "FAST") as CctpSpeed,
        });
        log("chain", "CCTP quote returned", { ms: Date.now() - quoteStarted });
        if (!quote.ok) {
          log("fail", `CCTP quote failed: ${quote.reason}`, { detail: quote.detail ?? "(none)" });
        } else {
          log("ok", "CCTP quote", {
            hops: quote.quote.hops.length,
            fees: quote.quote.feeLines.length,
            expiresIn: `${Math.round((quote.quote.expiresAt.getTime() - Date.now()) / 1000)}s`,
          });
          for (const fee of quote.quote.feeLines) {
            log("chain", `  fee ${fee.id}`, {
              label: fee.label,
              usd: fee.amountUsd,
              included: fee.included,
            });
          }
        }
        results[id] = { at: new Date().toISOString(), ok: quote.ok, detail: quote.ok ? "quoted" : quote.reason };
      } else if (adapter === "lifi" && from !== undefined && to !== undefined) {
        // Tokens come from the JSON's map, not hardcoded here. The hardcoded
        // testnet addresses were what produced "invalid or in deny list" on
        // mainnet — a Sepolia USDC offered as a Base one.
        const tokens = file.tokens ?? {};
        const simulate = process.argv.includes("--simulate");
        const sender = senderAddress(env) ?? "0x000000000000000000000000000000000000dEaD";
        const quote = await lifi.quote({
          fromChainId: from.chainId,
          toChainId: to.chainId,
          fromTokenAddress: tokens[String(scenario['fromToken'])] ?? "",
          toTokenAddress: tokens[String(scenario['toToken'])] ?? "",
          fromAmount: file.amounts.usdc,
          // The address that would actually sign — derived from the key rather than
          // a placeholder, so the simulation describes the transaction it names.
          fromAddress: sender,
        });
        log("chain", "LI.FI route search returned", { ms: Date.now() - quoteStarted });
        if (!quote.ok) {
          log("fail", `LI.FI quote failed: ${quote.reason}`, { detail: quote.detail ?? "(none)" });
        } else {
          log("ok", "LI.FI quote", { hops: quote.quote.hops.length, fees: quote.quote.feeLines.length });
          if (simulate) {
            try {
              // Built, never broadcast. `build` asks LI.FI for the transaction data
              // and stops — nothing signs, nothing sends, no nonce is consumed.
              const tx = await lifi.build(quote.quote, { sender, chainId: from.chainId });
              log("ok", "SIMULATED transaction — built, NOT broadcast", {
                chainId: tx.chainId,
                to: tx.to,
                value: tx.value,
                dataBytes: (tx.data.length - 2) / 2,
                calldata: `${tx.data.slice(0, 42)}…`,
              });
            } catch (error) {
              log("fail", "LI.FI build failed", {
                detail: error instanceof Error ? error.message : String(error),
              });
            }
          }
          for (const fee of quote.quote.feeLines) {
            log("chain", `  fee ${fee.id}`, {
              label: fee.label,
              usd: fee.amountUsd,
              included: fee.included,
            });
          }
          const included = quote.quote.feeLines.filter((f) => f.included === true).length;
          log("chain", "included-flag check", {
            total: quote.quote.feeLines.length,
            included,
            note: "included lines are already netted out and must not be summed",
          });
        }
        results[id] = { at: new Date().toISOString(), ok: quote.ok, detail: quote.ok ? "quoted" : quote.reason };
      } else if (adapter === "layerzero" && layerzero !== undefined && from !== undefined) {
        const receiveGas = Number(scenario['receiveGas'] ?? 200000);
        const options = layerzero.buildOptions({ receiveGas } as never);
        log("chain", "LayerZero options encoded", { receiveGas, bytes: `${options.slice(0, 42)}…` });

        const guid = layerzero.guidFor({
          nonce: 1n,
          srcEid: from.lzEid,
          sender: "0x000000000000000000000000000000000000dEaD",
          dstEid: to?.lzEid ?? 0,
          receiver: "0x000000000000000000000000000000000000dEaD",
        });
        log("chain", "LayerZero GUID computed locally (no indexer needed)", { guid });

        // The actual quote: this is the read that was previously never reached,
        // which is why LayerZero looked blocked when only its address was.
        const quote = await layerzero.quote({
          fromChainId: from.chainId,
          toEid: to?.lzEid ?? 0,
          sender: "0x000000000000000000000000000000000000dEaD",
          receiver: "0x000000000000000000000000000000000000dEaD",
          amount: file.amounts.usdc,
          receiveGas,
        });
        log("chain", "LayerZero endpoint quote returned", { ms: Date.now() - quoteStarted });

        if (!quote.ok) {
          log("fail", `LayerZero quote failed: ${quote.reason}`, { detail: quote.detail ?? "(none)" });
        } else {
          log("ok", "LayerZero quote", { hops: quote.quote.hops.length, fees: quote.quote.feeLines.length });
          const raw = quote.quote.raw as { nativeFee?: string; options?: string } | undefined;
          log("chain", "endpoint fee (wei)", { nativeFee: raw?.nativeFee ?? "(none)" });
          for (const fee of quote.quote.feeLines) {
            log("chain", `  fee ${fee.id}`, { label: fee.label, usd: fee.amountUsd, included: fee.included });
          }
        }
        results[id] = {
          at: new Date().toISOString(),
          ok: quote.ok,
          detail: quote.ok ? "quoted" : quote.reason,
          guid,
        };
      } else {
        log("warn", `scenario ${id} skipped — adapter not configured`);
        results[id] = { at: new Date().toISOString(), ok: false, detail: "skipped" };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("fail", `scenario ${id} threw`, { message });
      results[id] = { at: new Date().toISOString(), ok: false, detail: message };
    }

    if (mode === "send") {
      log("info", "send mode is not implemented yet — no transaction was broadcast");
    }
  }

  log("step", "writing results back to the source of truth");
  writeFileSync(scenarioPath, `${JSON.stringify({ ...file, results }, null, 2)}\n`);
  log("ok", "results written", { path: scenarioPath, scenarios: Object.keys(results).length });
  log("step", "done", { elapsed: `${((Date.now() - started) / 1000).toFixed(1)}s` });
}

await main();
