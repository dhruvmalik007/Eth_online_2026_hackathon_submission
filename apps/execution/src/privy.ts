/**
 * Phase 4 — Privy server-side signing.
 *
 * ## A port, not a Privy integration
 *
 * The service depends on {@link WalletSigner}, never on Privy. That is not
 * ceremony: you've said the signing layer must eventually accept any wallet
 * provider, and a port written now costs nothing while retrofitting one later
 * means touching every call site. Privy is the first implementation, not the
 * interface.
 *
 * ## Two account kinds, and why both exist
 *
 * | | **smart** | **eoa** |
 * |---|---|---|
 * | Request | a user operation through the smart account | a direct transaction |
 * | Gas | sponsored or paid in USDC via a paymaster | native token |
 * | Signs | userOps | raw transactions *and* EIP-712 |
 *
 * The split is not a preference. **Polymarket's CLOB requires a direct EOA
 * EIP-712 signature** — a userOp signature is not accepted, because the order is
 * verified off-chain against the EOA. So a deployment that only ever signs
 * userOps cannot trade prediction markets at all, which is why
 * {@link WalletSigner} exposes both operations rather than one.
 *
 * ## The authorization signature is the security boundary
 *
 * Every Privy request is signed with the server's **P-256 authorization key**,
 * over a canonical payload that includes the method, URL and body. That is what
 * makes a stolen request body useless without the key, and why this module
 * builds the payload rather than accepting one — a caller who assembled it
 * differently would produce a signature Privy rejects, at the last step of a
 * long flow.
 */
import { createSign, type KeyObject } from "node:crypto";

/** Which kind of account is signing. */
export type WalletKind = "smart" | "eoa";

/** A signed, broadcastable transaction. */
export interface SignedTransaction {
  readonly kind: WalletKind;
  readonly chainId: number;
  /** The transaction hash Privy returned. */
  readonly hash: string;
  /** Present for a userOp; the bundler's identifier. */
  readonly userOperationHash?: string;
}

export interface SignTransactionRequest {
  readonly walletId: string;
  readonly kind: WalletKind;
  readonly chainId: number;
  readonly to: string;
  /** Hex wei. */
  readonly value: string;
  /** Hex calldata — e.g. the output of `encodeCctpBurn`. */
  readonly data: string;
}

export interface SignTypedDataRequest {
  readonly walletId: string;
  readonly kind: WalletKind;
  /** Must be `eoa`: an off-chain order verifier checks the EOA, not the account. */
  readonly typedData: unknown;
}

/** The signing capability the service depends on. */
export interface WalletSigner {
  readonly kind: WalletKind;
  signTransaction(request: SignTransactionRequest): Promise<SignedTransaction>;
  /** EIP-712. Required for off-chain orders such as Polymarket's CLOB. */
  signTypedData(request: SignTypedDataRequest): Promise<string>;
}

export class PrivySignerError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    // The detail goes in the message as well as the field. A signing failure is
    // read from a log far more often than from a catch block, and "Privy rejected
    // the request (HTTP 404: wallet not found)" is the difference between a
    // five-minute diagnosis and an afternoon.
    super(`${message} (${detail})`);
    this.name = "PrivySignerError";
  }
}

export interface PrivySignerConfig {
  readonly appId: string;
  /** The P-256 authorization key. Never logged, never serialised into a request body. */
  readonly authorizationKey: KeyObject;
  readonly baseUrl?: string;
  /** Injectable so the tests run without network access. */
  readonly fetchImpl?: typeof fetch;
}

interface PrivyRpcResponse {
  readonly data?: { readonly hash?: string; readonly user_operation_hash?: string; readonly signature?: string };
  readonly error?: { readonly message?: string };
}

export class PrivyWalletSigner implements WalletSigner {
  constructor(
    readonly kind: WalletKind,
    private readonly config: PrivySignerConfig,
  ) {}

  async signTransaction(request: SignTransactionRequest): Promise<SignedTransaction> {
    this.#assertKind(request.kind);

    const response = await this.#rpc(request.walletId, {
      method: "eth_sendTransaction",
      // `caip2` is how Privy pins the chain, and a wrong one signs for the wrong
      // network — the calldata would be valid and the funds elsewhere.
      caip2: `eip155:${request.chainId}`,
      params: {
        transaction: {
          to: request.to,
          value: request.value === "0x0" ? "0x0" : request.value,
          data: request.data,
        },
      },
    });

    const hash = response.data?.hash;
    if (hash === undefined || hash.length === 0) {
      throw new PrivySignerError(
        "Privy returned no transaction hash.",
        "a successful send always carries one; an empty response means the shape changed",
      );
    }

    const userOperationHash = response.data?.user_operation_hash;
    return userOperationHash === undefined
      ? { kind: request.kind, chainId: request.chainId, hash }
      : { kind: request.kind, chainId: request.chainId, hash, userOperationHash };
  }

  async signTypedData(request: SignTypedDataRequest): Promise<string> {
    // An off-chain order verifier checks an EOA signature, so signing one from a
    // smart account produces a signature that verifies nowhere.
    if (request.kind !== "eoa") {
      throw new PrivySignerError(
        "Typed-data signing requires an EOA account.",
        `asked to sign with kind="${request.kind}"; off-chain verifiers check the EOA`,
      );
    }

    const response = await this.#rpc(request.walletId, {
      method: "eth_signTypedData_v4",
      params: { typedData: request.typedData },
    });

    const signature = response.data?.signature;
    if (signature === undefined || signature.length === 0) {
      throw new PrivySignerError("Privy returned no signature.", "empty signature field");
    }
    return signature;
  }

  #assertKind(kind: WalletKind): void {
    if (kind !== this.kind) {
      throw new PrivySignerError(
        `This signer handles "${this.kind}" accounts, not "${kind}".`,
        "construct one signer per account kind; the routing differs",
      );
    }
  }

  async #rpc(walletId: string, body: Record<string, unknown>): Promise<PrivyRpcResponse> {
    const base = this.config.baseUrl ?? "https://api.privy.io";
    const url = `${base}/v1/wallets/${walletId}/rpc`;
    const bodyText = JSON.stringify(body);
    const fetchImpl = this.config.fetchImpl ?? fetch;

    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "privy-app-id": this.config.appId,
        "privy-authorization-signature": this.#authorizationSignature("POST", url, bodyText),
      },
      body: bodyText,
    });

    const parsed = (await response.json()) as PrivyRpcResponse;
    if (!response.ok) {
      throw new PrivySignerError(
        "Privy rejected the signing request.",
        `HTTP ${response.status}: ${parsed.error?.message ?? "(no message)"}`,
      );
    }
    return parsed;
  }

  /**
   * Sign the canonical request payload.
   *
   * Built here rather than passed in: Privy verifies a signature over the exact
   * method, URL and body, so a payload assembled anywhere else can disagree with
   * what is sent — and the failure appears as an authentication error at the end
   * of a flow, which reads like a credential problem rather than a bug here.
   *
   * Node emits ECDSA in DER, which is the encoding Privy expects; converting to
   * raw `r||s` would produce a well-formed signature that never verifies.
   */
  #authorizationSignature(method: string, url: string, body: string): string {
    const payload = JSON.stringify({
      version: 1,
      method,
      url,
      body: JSON.parse(body) as unknown,
      headers: { "privy-app-id": this.config.appId },
    });
    const signer = createSign("SHA256");
    signer.update(payload);
    signer.end();
    return `sig=${encodeURIComponent(signer.sign(this.config.authorizationKey).toString("base64"))}`;
  }
}
