/**
 * The signer port: "something that can act as a Safe owner".
 *
 * Before this existed, `SafeClient` could sign only with a Ledger — the owner
 * source was a two-way union of `{ledger}` (live) or `{ownerAddress}` (dry, no
 * signing). That made "sign with a Privy EOA, headless, from a server" a
 * structural impossibility.
 *
 * With the port, every owner is the same shape and Ledger is simply one
 * implementation among several:
 *
 *   - `PrivyWalletSigner` — a Privy server wallet; the key lives in Privy's TEE.
 *   - `LocalKeySigner`   — a local viem account; dev/test only, gated.
 *   - `LedgerSignerAdapter` — hardware, unexercised in this pass but still valid.
 *
 * Nothing in this file holds, logs or transmits a key.
 */
import type { Eip712TypedData } from "../eip712.js";

export const SAFE_SIGNER_KINDS = ["privy", "local-key", "ledger"] as const;
export type SafeSignerKind = (typeof SAFE_SIGNER_KINDS)[number];

export interface SafeTypedDataSigner {
  readonly kind: SafeSignerKind;
  /**
   * The owner address this signer controls.
   *
   * For Privy/Ledger this is derived by the custodian, never from a key we hold.
   */
  address(): Promise<`0x${string}`>;
  /**
   * Sign the Safe transaction EIP-712 payload.
   *
   * @returns the canonical `0x<r><s><v>` owner signature.
   */
  signTypedData(typedData: Eip712TypedData): Promise<`0x${string}`>;
}

/**
 * How a signing attempt ended.
 *
 * `rejected` is deliberately distinct from `failed`: a custodian declining on
 * policy is a decision to surface neutrally, not an incident. This mirrors the
 * reasoning behind `isDeviceRejection` for the Ledger path — a user (or policy)
 * saying "no" must not be reported the same way as a broken connection.
 */
export type SignerFailureOutcome = "rejected" | "failed";

/** A signing failure that keeps the human-facing message and the debug detail apart. */
export class SafeSignerError extends Error {
  readonly debug: string;
  readonly outcome: SignerFailureOutcome;

  constructor(message: string, debug: string, outcome: SignerFailureOutcome = "failed") {
    super(message);
    this.name = "SafeSignerError";
    this.debug = debug;
    this.outcome = outcome;
  }
}

/**
 * Strip key-shaped material from any string before it reaches a log or an error.
 *
 * A leaked authorization key is a leaked treasury, and error messages are the
 * most common accidental exfiltration path in a signing service.
 */
export function redactSignerDetail(text: string): string {
  return text
    .replace(/wallet-auth:[A-Za-z0-9+/=_-]+/g, "wallet-auth:[redacted]")
    .replace(/-----BEGIN[^-]*-----[A-Za-z0-9+/=\s]+-----END[^-]*-----/g, "[redacted-pem]")
    .replace(/\b0x[0-9a-fA-F]{64}\b/g, "[redacted-key]")
    .replace(/\b(?:lsv2_pt_|sk-|sk_|pk_|rk_)[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]");
}
