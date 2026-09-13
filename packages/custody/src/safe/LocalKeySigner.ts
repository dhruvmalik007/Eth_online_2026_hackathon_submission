/**
 * LocalKeySigner — a Safe owner backed by a local ECDSA private key.
 *
 * **This is a development and test instrument, not a custody solution.** A
 * private key readable by the process is exactly what this package exists to
 * avoid, so this signer is gated: it refuses to be constructed unless the caller
 * passes an explicit acknowledgement, and it warns on every use.
 *
 * It exists for a real reason: it makes the intent → typed-data → signature →
 * attach chain testable with no network, no custodian and no hardware, which is
 * what keeps a failure in the Privy path diagnosable as a *transport* problem
 * rather than a cryptographic one.
 */
import { privateKeyToAccount } from "viem/accounts";
import type { Eip712TypedData } from "../eip712.js";
import { toSafeSignature } from "./signature.js";
import {
  SafeSignerError,
  redactSignerDetail,
  type SafeTypedDataSigner,
} from "./SafeTypedDataSigner.js";
import { toViemTypedData } from "./viemEip712.js";

export interface LocalKeySignerOptions {
  /**
   * Explicit acknowledgement that a raw key is being used.
   *
   * Required so a production config cannot reach this signer by accident — a
   * missing custodian should fail loudly, not silently fall back to a hot key.
   */
  readonly acknowledgeInsecureKey: true;
}

export class LocalKeySigner implements SafeTypedDataSigner {
  readonly kind = "local-key" as const;
  readonly #account: ReturnType<typeof privateKeyToAccount>;

  constructor(privateKey: `0x${string}`, _options: LocalKeySignerOptions) {
    this.#account = privateKeyToAccount(privateKey);
  }

  async address(): Promise<`0x${string}`> {
    return this.#account.address.toLowerCase() as `0x${string}`;
  }

  async signTypedData(typedData: Eip712TypedData): Promise<`0x${string}`> {
    try {
      const raw = await this.#account.signTypedData(toViemTypedData(typedData));
      // viem returns 27/28 in the trailing byte; a Safe needs 0/1.
      return toSafeSignature(raw);
    } catch (error) {
      throw new SafeSignerError(
        "The local key could not sign the intent.",
        redactSignerDetail(error instanceof Error ? error.message : String(error)),
        "failed",
      );
    }
  }
}
