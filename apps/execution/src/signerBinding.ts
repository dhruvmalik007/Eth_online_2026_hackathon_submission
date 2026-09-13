/**
 * Binding the signing key, from configuration.
 *
 * ## Why this exists at all
 *
 * `createRuntime` deliberately has no default signer: "a signer that appears without being asked for
 * is a key nobody chose to load." This module is how it is asked for — explicitly, by setting a key
 * — so the deployment's ability to move funds is a decision on the record rather than a side effect
 * of some other variable being present.
 *
 * ## Why the key comes from the environment, not from this file
 *
 * The key is read from `EXECUTION_SIGNER_PRIVATE_KEY`, never written here as a literal. The effect
 * is identical — set the variable and signing is available — but a literal in a committed file is a
 * leaked key: this repository is a public hackathon submission, and a drainable key in it is a
 * permanent liability regardless of intent. The value already lives in the workspace `.env` files;
 * it belongs in the deployment's environment alongside them.
 *
 * ## Two keys, one role each
 *
 * `EXECUTION_SIGNER_PRIVATE_KEY` is the primary. `EXECUTION_FALLBACK_SIGNER_PRIVATE_KEY` is used
 * only when the primary is absent, which is the "backup payer" arrangement: a second key that
 * exists so a demonstration can proceed when the first has no testnet funds. The fallback is
 * deliberately *not* tried when the primary is set-but-broken — a malformed primary is a
 * configuration error to fix, and silently swapping keys would hide it.
 *
 * ## Failing loudly
 *
 * A key that is present but not a 32-byte hex string throws at bind time. The alternative — treating
 * it as absent — produces a deployment that reports "no signer configured" while a variable that
 * looks configured sits in the project, which is the undiagnosable shape of this mistake.
 */
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia,
  type Chain,
} from "viem/chains";
import { privateKeyEvmSigner, type EvmSigner } from "./evmSigner.js";

/**
 * Chains the signer can bind to, by name.
 *
 * The default is **Base Sepolia** because that is where the demonstration wallet is funded, and a
 * signer configured for a chain it has no gas on fails at the first transaction rather than at
 * bind time — a worse place to find out.
 */
const SIGNER_CHAINS: Record<string, Chain> = {
  "base-sepolia": baseSepolia,
  "optimism-sepolia": optimismSepolia,
  "arbitrum-sepolia": arbitrumSepolia,
  sepolia,
  "polygon-amoy": polygonAmoy,
  base,
  optimism,
  arbitrum,
  polygon,
  ethereum: mainnet,
};

export const DEFAULT_SIGNER_CHAIN = "base-sepolia";

export function signerChainByName(name: string): Chain {
  const trimmed = name.trim().toLowerCase();
  const chain = SIGNER_CHAINS[trimmed];
  if (chain === undefined) {
    throw new Error(
      `Unknown EXECUTION_SIGNER_CHAIN "${name}". Known chains: ${Object.keys(SIGNER_CHAINS).join(", ")}.`,
    );
  }
  return chain;
}

export interface SignerEnv {
  readonly EXECUTION_SIGNER_PRIVATE_KEY?: string | undefined;
  readonly EXECUTION_FALLBACK_SIGNER_PRIVATE_KEY?: string | undefined;
  readonly EXECUTION_SIGNER_CHAIN?: string | undefined;
  readonly EXECUTION_SIGNER_RPC_URL?: string | undefined;
}

const HEX_KEY = /^(?:0x)?[0-9a-fA-F]{64}$/;

function normaliseKey(raw: string, variable: string): `0x${string}` {
  const value = raw.trim();
  if (!HEX_KEY.test(value)) {
    throw new Error(
      `${variable} is set but is not a 32-byte hex private key ` +
        `(expected 64 hex characters, optionally 0x-prefixed; got ${value.length} characters).`,
    );
  }
  return (value.startsWith("0x") ? value : `0x${value}`) as `0x${string}`;
}

export interface BoundSigner {
  readonly signer: EvmSigner;
  /** Which variable supplied the key — surfaced so a deployment can report what it is using. */
  readonly source: "primary" | "fallback";
  readonly chain: Chain;
}

/**
 * The signer this deployment should use, or `undefined` when no key is configured.
 *
 * `undefined` keeps the service's existing behaviour: the two routes that need a signer answer 503
 * with "no signer is configured on this deployment", which is a deployment statement rather than a
 * failed operation.
 */
export function bindSigner(env: SignerEnv): BoundSigner | undefined {
  const primary = env.EXECUTION_SIGNER_PRIVATE_KEY?.trim();
  const fallback = env.EXECUTION_FALLBACK_SIGNER_PRIVATE_KEY?.trim();

  const chosen =
    primary !== undefined && primary.length > 0
      ? ({ raw: primary, source: "primary" } as const)
      : fallback !== undefined && fallback.length > 0
        ? ({ raw: fallback, source: "fallback" } as const)
        : undefined;

  if (chosen === undefined) return undefined;

  const variable =
    chosen.source === "primary"
      ? "EXECUTION_SIGNER_PRIVATE_KEY"
      : "EXECUTION_FALLBACK_SIGNER_PRIVATE_KEY";

  // Validated before the chain, so a malformed key reports itself rather than a chain error.
  const privateKey = normaliseKey(chosen.raw, variable);
  const chain = signerChainByName(env.EXECUTION_SIGNER_CHAIN ?? DEFAULT_SIGNER_CHAIN);
  const rpcUrl = env.EXECUTION_SIGNER_RPC_URL?.trim();

  return {
    signer: privateKeyEvmSigner({
      privateKey,
      chain,
      ...(rpcUrl === undefined || rpcUrl.length === 0 ? {} : { rpcUrl }),
    }),
    source: chosen.source,
    chain,
  };
}
