/**
 * PrivyWalletSigner — a Safe owner backed by a **Privy server wallet**.
 *
 * The signing key lives in Privy's infrastructure; this process never sees it.
 * What it does hold is an *authorization key* (P-256) that Privy requires on
 * every server-side wallet call, so the blast radius of a leaked config is
 * "whoever holds it can ask Privy to sign", which is why:
 *
 *   - every error message is scrubbed through `redactSignerDetail`;
 *   - the caller is expected to pair this with `PolicyGate` (local pre-flight)
 *     and a Privy **default-deny policy** that allows `eth_signTypedData_v4`
 *     only within the Safe's domain and value bounds (server-side hard stop).
 *
 * ## The call, verified against the installed SDK
 *
 * `@privy-io/node@0.34.0` exposes
 * `privy.wallets().ethereum().signTypedData(walletId, { params: { typed_data }, authorization_context })`
 * returning `{ encoding: "hex", signature }`. Note `wallets()` is a **method** on
 * the client, and `authorization_private_keys` are base64-encoded PKCS#8 blobs
 * with no PEM headers.
 *
 * A Safe owner must produce a plain ECDSA signature, which is this call's
 * default; `erc1271` would only be correct if the owner were itself a contract.
 */
import type { Eip712TypedData } from "../eip712.js";
import { toSafeSignature } from "./signature.js";
import {
  SafeSignerError,
  redactSignerDetail,
  type SafeTypedDataSigner,
} from "./SafeTypedDataSigner.js";

/**
 * The narrow slice of Privy this package uses.
 *
 * Declared as a port so the signing path is testable without credentials and so
 * an SDK rename is a one-file change rather than a rewrite.
 */
export interface PrivySigningTransport {
  signTypedData(input: {
    readonly walletId: string;
    readonly typedData: Eip712TypedData;
    readonly authorizationPrivateKey: string;
  }): Promise<string>;
}

export interface PrivyWalletSignerOptions {
  readonly walletId: string;
  /** base64 PKCS#8, optionally with the dashboard's `wallet-auth:` prefix. */
  readonly authorizationPrivateKey: string;
  /** The signing transport. Defaults to the `@privy-io/node` SDK. */
  readonly transport: PrivySigningTransport;
  /**
   * The owner address, when it is already known.
   *
   * Avoids a `wallets().get()` round-trip on every cold start. When omitted,
   * {@link PrivyWalletSigner.address} asks the custodian.
   */
  readonly knownAddress?: `0x${string}`;
}

/**
 * The dashboard shows the authorization key with a `wallet-auth:` prefix; the
 * SDK wants the bare base64 PKCS#8 body. Normalise here so an operator can paste
 * either form.
 */
export function normalizeAuthorizationKey(raw: string): string {
  const trimmed = raw.trim();
  const withoutPrefix = trimmed.startsWith("wallet-auth:") ? trimmed.slice("wallet-auth:".length) : trimmed;
  return withoutPrefix.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
}

export class PrivyWalletSigner implements SafeTypedDataSigner {
  readonly kind = "privy" as const;
  readonly #options: PrivyWalletSignerOptions;
  #cachedAddress: `0x${string}` | null = null;

  constructor(options: PrivyWalletSignerOptions) {
    if (options.walletId.trim().length === 0) {
      throw new SafeSignerError(
        "A Privy wallet id is required to sign.",
        "missing walletId",
        "failed",
      );
    }
    if (options.authorizationPrivateKey.trim().length === 0) {
      throw new SafeSignerError(
        "A Privy authorization key is required to sign.",
        "missing authorizationPrivateKey",
        "failed",
      );
    }
    this.#options = options;
  }

  async address(): Promise<`0x${string}`> {
    if (this.#cachedAddress !== null) return this.#cachedAddress;
    if (this.#options.knownAddress === undefined) {
      throw new SafeSignerError(
        "The Privy wallet address was not supplied and cannot be derived locally.",
        "pass knownAddress (from the Privy wallet record) or resolve it before signing",
        "failed",
      );
    }
    this.#cachedAddress = this.#options.knownAddress.toLowerCase() as `0x${string}`;
    return this.#cachedAddress;
  }

  async signTypedData(typedData: Eip712TypedData): Promise<`0x${string}`> {
    try {
      const signature = await this.#options.transport.signTypedData({
        walletId: this.#options.walletId,
        typedData,
        authorizationPrivateKey: normalizeAuthorizationKey(
          this.#options.authorizationPrivateKey,
        ),
      });
      return toSafeSignature(signature as `0x${string}`);
    } catch (error) {
      if (error instanceof SafeSignerError) throw error;
      throw new SafeSignerError(
        "The Privy wallet did not sign the intent. Check the wallet's policy allows eth_signTypedData_v4 for this Safe.",
        redactSignerDetail(error instanceof Error ? error.message : String(error)),
        "failed",
      );
    }
  }
}

/** The production transport: the `@privy-io/node` SDK. */
export class PrivySdkTransport implements PrivySigningTransport {
  readonly #appId: string;
  readonly #appSecret: string;
  #client: unknown = null;

  constructor(options: { readonly appId: string; readonly appSecret: string }) {
    this.#appId = options.appId;
    this.#appSecret = options.appSecret;
  }

  async #privy(): Promise<{
    wallets: () => { ethereum: () => { signTypedData: (id: string, input: unknown) => Promise<{ signature: string }> } };
  }> {
    if (this.#client !== null) return this.#client as never;
    const mod = await import("@privy-io/node");
    const Client = (mod as { PrivyClient?: new (o: { appId: string; appSecret: string }) => unknown })
      .PrivyClient;
    if (Client === undefined) {
      throw new SafeSignerError(
        "The Privy SDK is not available.",
        "`@privy-io/node` did not export PrivyClient",
        "failed",
      );
    }
    this.#client = new Client({ appId: this.#appId, appSecret: this.#appSecret });
    return this.#client as never;
  }

  async signTypedData(input: {
    readonly walletId: string;
    readonly typedData: Eip712TypedData;
    readonly authorizationPrivateKey: string;
  }): Promise<string> {
    const privy = await this.#privy();
    const result = await privy
      .wallets()
      .ethereum()
      .signTypedData(input.walletId, {
        params: {
          typed_data: {
            domain: input.typedData.domain,
            types: input.typedData.types,
            primary_type: input.typedData.primaryType,
            message: input.typedData.message,
          },
        },
        authorization_context: {
          authorization_private_keys: [input.authorizationPrivateKey],
        },
      });
    if (typeof result.signature !== "string" || result.signature.length === 0) {
      throw new SafeSignerError(
        "Privy returned no signature.",
        "signTypedData response had an empty signature field",
        "failed",
      );
    }
    return result.signature;
  }
}
