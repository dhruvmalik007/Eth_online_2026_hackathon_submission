/**
 * What a WalletConnect session is allowed to ask this service to sign.
 *
 * The bridge in the browser is a convenience: it can *ask* for a signature and can never obtain one
 * that was not granted here. So the rules live on this side, next to the key, and the client's copy
 * of them (apps/agentic-ems/lib/walletconnect/protocol.ts) exists only to explain a refusal before
 * it happens. If the two ever disagree, this file is the one that decides.
 *
 * The gate is an allowlist, not a denylist. A denylist of bad contracts cannot be maintained; a list
 * of the four contracts a position actually uses can be read in one screen.
 */
import type { EvmSigner, EvmTypedDataPayload } from "./evmSigner.js";

/** The only chain a position here lives on. */
export const WALLET_CHAIN_ID = 137;
export const WALLET_CHAIN_REF = `eip155:${WALLET_CHAIN_ID}`;

/**
 * The contracts a request may target.
 *
 * Every one of these is a contract this workspace has already called: the Aave pool and its aToken
 * from the two supplies, USDC because approvals are themselves transactions, and the Morpho vault
 * from the deposit. Adding a protocol means adding its addresses here, deliberately.
 */
export const WALLET_TARGET_ALLOWLIST: readonly string[] = [
  "0x794a61358d6845594f94dc1db02a252b5b4814ad", // Aave V3 Pool
  "0xa4d94019934d8333ef880abffbf2fdd611c762bd", // aPolUSDCn
  "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", // USDC
  "0xf2532428472a4cbdf27f20ca39e81da6deb420b5", // Morpho MEV Capital USDC vault
];

/**
 * A ceiling on the native value a single request may move.
 *
 * Calldata cannot be allowlisted contract-by-contract without reimplementing each ABI, so the target
 * list is what bounds *where* a call goes and this bounds *how much* leaves with it. A transfer of
 * the chain's own coin to an allowlisted contract is still a transfer.
 */
export const WALLET_MAX_VALUE_WEI = 10n ** 16n; // 0.01

export const WALLET_ALLOWED_METHODS = [
  "eth_accounts",
  "eth_requestAccounts",
  "eth_chainId",
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData_v4",
] as const;

export type WalletMethod = (typeof WALLET_ALLOWED_METHODS)[number];

export type WalletDecision = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface WalletRequestBody {
  readonly method: string;
  readonly chainId: string;
  readonly params: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstParam(params: unknown): Record<string, unknown> | undefined {
  return Array.isArray(params) ? asRecord(params[0]) : undefined;
}

/**
 * Decide whether a request may be signed.
 *
 * Every refusal states the reason it was refused. A generic "rejected" leaves the user unable to tell
 * a policy boundary from a bug, and they will retry the same thing.
 */
export function evaluateWalletRequest(body: WalletRequestBody): WalletDecision {
  if (body.method === "eth_sign") {
    return { ok: false, reason: "eth_sign is refused: it signs a pre-hashed blob, so the bytes a user approves cannot be shown as what they do." };
  }
  if (body.method === "eth_signTransaction") {
    return { ok: false, reason: "eth_signTransaction is refused: it returns a signed transaction the dapp can broadcast later, outside the moment of approval." };
  }
  if (body.chainId !== WALLET_CHAIN_REF) {
    return { ok: false, reason: `This session is scoped to ${WALLET_CHAIN_REF}; ${body.chainId} is refused rather than switched to.` };
  }
  if (!(WALLET_ALLOWED_METHODS as readonly string[]).includes(body.method)) {
    return { ok: false, reason: `Unsupported method: ${body.method}.` };
  }

  if (body.method === "eth_sendTransaction") {
    const tx = firstParam(body.params);
    if (tx === undefined) return { ok: false, reason: "eth_sendTransaction needs a transaction object." };
    const to = typeof tx["to"] === "string" ? tx["to"].toLowerCase() : undefined;
    if (to === undefined) return { ok: false, reason: "The transaction has no recipient." };
    if (!WALLET_TARGET_ALLOWLIST.includes(to)) {
      return { ok: false, reason: `${to} is not an allowlisted contract for this session.` };
    }
    const rawValue = tx["value"];
    if (rawValue !== undefined && rawValue !== null) {
      let value: bigint;
      try {
        value = BigInt(typeof rawValue === "string" ? rawValue : String(rawValue));
      } catch {
        return { ok: false, reason: "The transaction value could not be read as a number." };
      }
      if (value > WALLET_MAX_VALUE_WEI) {
        return { ok: false, reason: `The transaction moves ${value} wei, above the ${WALLET_MAX_VALUE_WEI} wei ceiling for a single request.` };
      }
    }
  }

  if (body.method === "eth_signTypedData_v4") {
    const typed = parseTypedData(body.params);
    if (typed === undefined) return { ok: false, reason: "The typed data could not be parsed." };
    const verifying = typed.domain.verifyingContract?.toLowerCase();
    // A permit is a typed-data signature that moves funds. If the payload names a contract that is
    // not allowlisted, the signature is a capability we cannot bound, so it is refused rather than
    // signed on the strength of the message contents.
    if (verifying !== undefined && !WALLET_TARGET_ALLOWLIST.includes(verifying)) {
      return { ok: false, reason: `Typed data targets ${verifying}, which is not allowlisted for this session.` };
    }
  }

  return { ok: true };
}

/** Parse the `eth_signTypedData_v4` params: `[address, jsonString]`. */
export function parseTypedData(params: unknown): EvmTypedDataPayload | undefined {
  if (!Array.isArray(params)) return undefined;
  const raw = params[1];
  const json = typeof raw === "string" ? raw : undefined;
  if (json === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  const record = asRecord(parsed);
  const domain = record === undefined ? undefined : asRecord(record["domain"]);
  const types = record === undefined ? undefined : asRecord(record["types"]);
  const message = record === undefined ? undefined : asRecord(record["message"]);
  const primaryType = record === undefined ? undefined : record["primaryType"];
  if (domain === undefined || types === undefined || message === undefined || typeof primaryType !== "string") {
    return undefined;
  }
  return {
    domain: domain as EvmTypedDataPayload["domain"],
    types: types as EvmTypedDataPayload["types"],
    primaryType,
    message,
  };
}

/**
 * Perform an allowed request.
 *
 * `eth_accounts`/`eth_chainId` are answered without touching the key at all — a dapp asking which
 * account is connected should not cost a signature.
 */
export async function executeWalletRequest(signer: EvmSigner, body: WalletRequestBody): Promise<unknown> {
  if (body.method === "eth_accounts" || body.method === "eth_requestAccounts") {
    return [await signer.getAddress()];
  }
  if (body.method === "eth_chainId") {
    return `0x${WALLET_CHAIN_ID.toString(16)}`;
  }
  if (body.method === "personal_sign") {
    const params = Array.isArray(body.params) ? body.params : [];
    const message = params[0];
    if (typeof message !== "string") throw new Error("personal_sign needs a message.");
    return signer.signMessage(message as `0x${string}`);
  }
  if (body.method === "eth_signTypedData_v4") {
    const typed = parseTypedData(body.params);
    if (typed === undefined) throw new Error("The typed data could not be parsed.");
    return signer.signTypedData(typed);
  }
  if (body.method === "eth_sendTransaction") {
    const tx = firstParam(body.params) as { to: `0x${string}`; data?: `0x${string}`; value?: string } | undefined;
    if (tx === undefined) throw new Error("eth_sendTransaction needs a transaction object.");
    const handle = await signer.sendTransaction({
      chainId: WALLET_CHAIN_ID,
      to: tx.to,
      ...(tx.data === undefined ? {} : { data: tx.data }),
      ...(tx.value === undefined ? {} : { value: BigInt(tx.value) }),
    });
    return handle.transactionHash;
  }
  throw new Error(`Unsupported method: ${body.method}.`);
}
