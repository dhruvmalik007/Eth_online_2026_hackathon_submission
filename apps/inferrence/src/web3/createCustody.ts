/**
 * Composition for the custody signing path.
 *
 * Kept out of `runtime.ts` so the runtime stays a wiring list rather than a place
 * where credential handling hides. This is the only module that reads the Privy
 * credentials, and it never logs one.
 *
 * The owner is a **role**, not a device: `CUSTODY_SIGNER` picks the
 * implementation and everything downstream is signer-agnostic.
 */
import {
  LocalKeySigner,
  PrivySdkTransport,
  PrivyWalletSigner,
  SafeClient,
  chainInfo,
  type SafeTypedDataSigner,
} from "@ethonline2026/custody";
import { createPublicClient, http } from "viem";
import type { InferenceEnv } from "../env.js";
import { HttpError } from "../http.js";
import {
  DryCustodySigningPort,
  LiveCustodySigningPort,
  LoggingCustodyAudit,
  type CustodySigningPort,
} from "./CustodySigningPort.js";

/** Comma-separated owner addresses, validated so a typo fails at boot. */
function parseOwners(raw: string | undefined): `0x${string}`[] {
  if (raw === undefined) return [];
  const owners: `0x${string}`[] = [];
  for (const part of raw.split(",")) {
    const candidate = part.trim();
    if (candidate.length === 0) continue;
    if (!/^0x[0-9a-fA-F]{40}$/.test(candidate)) {
      throw new HttpError("INTERNAL", `CUSTODY_SAFE_OWNERS contains an invalid address: ${candidate}`);
    }
    owners.push(candidate as `0x${string}`);
  }
  return owners;
}

/**
 * Build the owner signer named by `CUSTODY_SIGNER`.
 *
 * A missing credential is a boot failure, not a fallback: silently degrading to a
 * keyless mode would mean an intent that never gets signed while everything looks
 * healthy.
 */
function createSigner(env: InferenceEnv, owners: readonly `0x${string}`[]): SafeTypedDataSigner {
  if (env.CUSTODY_SIGNER === "privy") {
    const missing = (
      [
        ["PRIVY_APP_ID", env.PRIVY_APP_ID],
        ["PRIVY_APP_SECRET", env.PRIVY_APP_SECRET],
        ["PRIVY_WALLET_ID", env.PRIVY_WALLET_ID],
        ["PRIVY_AUTHORIZATION_PRIVATE_KEY", env.PRIVY_AUTHORIZATION_PRIVATE_KEY],
      ] as const
    )
      .filter(([, value]) => value === undefined || value.length === 0)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new HttpError(
        "INTERNAL",
        `CUSTODY_SIGNER=privy requires: ${missing.join(", ")}`,
      );
    }
    const knownAddress = (env.PRIVY_WALLET_ADDRESS ?? owners[0]) as `0x${string}` | undefined;
    return new PrivyWalletSigner({
      walletId: env.PRIVY_WALLET_ID as string,
      authorizationPrivateKey: env.PRIVY_AUTHORIZATION_PRIVATE_KEY as string,
      ...(knownAddress === undefined ? {} : { knownAddress }),
      transport: new PrivySdkTransport({
        appId: env.PRIVY_APP_ID as string,
        appSecret: env.PRIVY_APP_SECRET as string,
      }),
    });
  }

  if (env.CUSTODY_SIGNER === "local-key") {
    if (env.CUSTODY_E2E_PRIVATE_KEY === undefined) {
      throw new HttpError("INTERNAL", "CUSTODY_SIGNER=local-key requires CUSTODY_E2E_PRIVATE_KEY");
    }
    return new LocalKeySigner(env.CUSTODY_E2E_PRIVATE_KEY as `0x${string}`, {
      acknowledgeInsecureKey: true,
    });
  }

  throw new HttpError("INTERNAL", `Unknown CUSTODY_SIGNER: ${String(env.CUSTODY_SIGNER)}`);
}

export function createCustodyPort(env: InferenceEnv): CustodySigningPort {
  const audit = new LoggingCustodyAudit();
  if (env.CUSTODY_SIGNER === "dry") return new DryCustodySigningPort(audit);

  const owners = parseOwners(env.CUSTODY_SAFE_OWNERS);
  const signer = createSigner(env, owners);
  const chain = chainInfo(env.CUSTODY_SAFE_CHAIN);
  const rpcUrl = env.ETHEREUM_SEPOLIA_RPC_URL ?? chain.rpcUrls.default.http[0];
  if (rpcUrl === undefined) {
    throw new HttpError("INTERNAL", `No RPC endpoint for chain ${env.CUSTODY_SAFE_CHAIN}`);
  }

  const publicClient = createPublicClient({
    chain,
    // A timeout is not optional here. protocol-kit reads the chain id when it
    // initialises, and with no timeout a stalled RPC hangs the run indefinitely —
    // which presented as an SSE stream that emitted 19 events and then nothing but
    // heartbeats, with no error anywhere.
    transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }),
  });

  const safeClient = new SafeClient({
    publicClient,
    signer,
    ...(env.CUSTODY_SAFE_ADDRESS !== undefined
      ? { safeAddress: env.CUSTODY_SAFE_ADDRESS }
      : {
          // Counterfactual Safe: no deployment and no gas needed to produce a
          // real, signable proposal. Owners default to the signer's own address.
          predictedSafe: {
            ...(owners.length === 0 ? {} : { owners }),
            threshold: env.CUSTODY_SAFE_THRESHOLD,
          },
          nonce: 0,
        }),
  });

  console.log(
    JSON.stringify({
      custody: "wired",
      signer: signer.kind,
      chain: env.CUSTODY_SAFE_CHAIN,
      chainId: chain.id,
      rpcHost: new URL(rpcUrl).host,
      safe: env.CUSTODY_SAFE_ADDRESS ?? "counterfactual",
      owners: owners.length,
    }),
  );

  return new LiveCustodySigningPort({
    safeClient,
    signer,
    resolveOwnerAddress: async () => await signer.address(),
    // A real dependency probe. `getBlockNumber` rather than only `getChainId`:
    // chainId can be answered from the chain object, so it does not prove egress.
    probe: async () => {
      const [chainId, block] = await Promise.all([
        publicClient.getChainId(),
        publicClient.getBlockNumber(),
      ]);
      return chainId === chain.id && block > 0n;
    },
    rpcHost: new URL(rpcUrl).host,
    audit,
  });
}
