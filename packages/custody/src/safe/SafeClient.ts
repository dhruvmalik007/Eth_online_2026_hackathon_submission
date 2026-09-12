/**
 * SafeClient — the Safe smart-account middleware for the EMS custody layer.
 *
 * ## The trust model
 *
 * A Safe holds the treasury. Its **owners are configured**, not assumed: a
 * Privy-derived EOA, the user's Ledger EOA, or both, with the Safe's
 * `threshold` deciding how many must sign. This class deliberately knows
 * nothing about *who* an owner is — that keeps it usable by any app without
 * coupling custody to an auth vendor.
 *
 * The agent NEVER holds a signing key. It can only *propose*: build the Safe
 * transaction, encode it, and hand back the calldata. Execution requires a
 * signature from an owner device, so every fund-moving action is confirmed by
 * a human on the Ledger.
 *
 * ## Modes
 *
 * - **dry** — no device. Build proposals and calldata (`buildProposal`),
 *   never sign. This is the package default and the mode an integrating app
 *   starts in.
 * - **live** — a Ledger-backed owner signs the EIP-712 digest on-device.
 *
 * The two modes are distinguished by the type: you supply either `ledger`
 * (live) or `ownerAddress` (dry), and supplying both — or neither — is a
 * compile error.
 *
 * @remarks
 * protocol-kit builds and encodes the transaction; the signature is produced
 * on-device by `LedgerSignerAdapter`. Only signature bytes ever reach the host
 * process. No private key is read, stored or passed anywhere in this file.
 */
import Safe, {
  EthSafeSignature,
  generateTypedData,
  getSafeProxyFactoryContract,
} from "@safe-global/protocol-kit";
import { hashDomain, type PublicClient } from "viem";
import { LedgerSignerAdapter } from "./LedgerSignerAdapter.js";
import { toLowerAddress } from "../utils/address.js";

/**
 * The EIP-1193 shape the SDK accepts for a provider.
 *
 * Declared structurally here because the SDK's own `Eip1193Provider` is not
 * exported in a form this package can name.
 */
interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}

/**
 * Adapt a viem `PublicClient` to that shape.
 *
 * At runtime a viem client already *is* an EIP-1193 provider. The types
 * disagree only because viem types `request` against its RPC-schema union
 * while the SDK takes `{ method: string }`, and TypeScript will not widen a
 * function parameter implicitly. This is the single place that bridges the
 * two, so the mismatch is contained and explained rather than spelled
 * `as never` at every call site.
 */
function asEip1193Provider(client: PublicClient): Eip1193Provider {
  const request = client.request as unknown as Eip1193Provider["request"];
  return { request: (args) => request(args) };
}

/**
 * Props the SDK's `createTransaction` accepts.
 *
 * Derived from the SDK rather than imported: the equivalent types live in
 * `@safe-global/types-kit`, which protocol-kit depends on internally but does
 * not expose to consumers of this package. Deriving them here means they track
 * the installed SDK automatically and cannot drift.
 */
type CreateTransactionProps = Parameters<Safe["createTransaction"]>[0];

/** One leg of a batched Safe proposal (a `MetaTransactionData`). */
export type SafeLeg = CreateTransactionProps["transactions"][number];

/** The SDK's Safe transaction object. */
export type SafeTransaction = Awaited<ReturnType<Safe["createTransaction"]>>;

/** Optional overrides accepted when building a Safe transaction (e.g. `nonce`). */
export type SafeTransactionOptions = NonNullable<CreateTransactionProps["options"]>;

/**
 * Safe singleton versions this package will deploy.
 *
 * A deliberate subset of the SDK's own `SafeVersion` union: every member here
 * must remain assignable to it, so a version the SDK does not ship is a
 * compile error rather than a runtime surprise.
 */
export type SafeVersionName = "1.3.0" | "1.4.1";

/** Owners and threshold for a Safe that has not been deployed yet. */
export interface PredictedSafeConfig {
  /**
   * Owner addresses. Omit to use the resolved owner alone.
   *
   * Listing more than one owner (say a Privy EOA and a Ledger EOA) is the
   * supported way to express shared control — this class needs no change to
   * accept a new kind of owner.
   */
  readonly owners?: readonly `0x${string}`[];
  /** Number of owners that must sign. Defaults to 1. */
  readonly threshold?: number;
  /** Safe singleton version to deploy. Defaults to `1.3.0`. */
  readonly safeVersion?: SafeVersionName;
}

/**
 * Where the owner identity comes from.
 *
 * A discriminated union so "exactly one source" is enforced by the compiler
 * rather than by a runtime check.
 */
export type SafeOwnerSource =
  | { readonly ledger: LedgerSignerAdapter; readonly ownerAddress?: never }
  | { readonly ledger?: never; readonly ownerAddress: `0x${string}` };

export type SafeClientOptions = {
  /** viem public client for the chain; also the SDK's RPC provider. */
  readonly publicClient: PublicClient;
  /** An existing deployed Safe. Omit to work against a counterfactual Safe. */
  readonly safeAddress?: string;
  /** Owners and threshold, for a Safe that is not deployed yet. */
  readonly predictedSafe?: PredictedSafeConfig;
  /**
   * Explicit Safe nonce.
   *
   * Supplied so a dry proposal can be built without reading the chain.
   */
  readonly nonce?: number;
} & SafeOwnerSource;

/** The two 32-byte hashes that make up the EIP-712 payload a Safe owner signs. */
export interface SafeEip712Digest {
  readonly domainSeparator: string;
  /** The Safe transaction hash — the EIP-712 struct hash the Safe verifies. */
  readonly messageHash: string;
}

/** A Safe transaction signed by an owner. */
export interface SignedSafeTransaction extends SafeEip712Digest {
  readonly tx: SafeTransaction;
  /** Canonical owner signature bytes, `0x<r><s><v>`. */
  readonly signature: string;
}

/**
 * A proposal the agent is allowed to produce: no signature, just the intent
 * and the calldata an owner would authorise.
 */
export interface SafeProposal {
  readonly safeAddress: string;
  /** The Safe transaction hash an owner must sign. */
  readonly safeTxHash: string;
  /** `execTransaction` calldata, ready to submit once the owner has signed. */
  readonly calldata: string;
  /** The Safe nonce this proposal was built against. */
  readonly nonce: number;
  /** The legs it batches, echoed back so a caller can audit the intent. */
  readonly legs: readonly SafeLeg[];
}

/**
 * The transaction that deploys a Safe.
 *
 * Returned rather than sent. Deployment is paid for by an owner EOA, and this
 * middleware holds no key, so it hands the transaction back to whoever can
 * legitimately sign it.
 */
export interface SafeDeploymentRequest {
  /** The proxy factory the transaction must be sent to. */
  readonly to: string;
  readonly value: bigint;
  /** `createProxyWithNonce` calldata, from the SDK's `getInitCode()`. */
  readonly data: string;
  /** The address the Safe will have once this transaction confirms. */
  readonly predictedAddress: string;
}

export class SafeClient {
  private readonly opts: SafeClientOptions;
  private readonly chainId: number;
  private cachedSafe: Safe | null = null;
  private cachedOwner: `0x${string}` | null = null;

  constructor(opts: SafeClientOptions) {
    this.opts = opts;
    this.chainId = opts.publicClient.chain?.id ?? 0;
    if (this.chainId === 0) {
      throw new Error("SafeClient requires a public client with a chain set");
    }
  }

  /** `live` when a device-backed owner was supplied, otherwise `dry`. */
  get mode(): "dry" | "live" {
    return this.opts.ledger !== undefined ? "live" : "dry";
  }

  /**
   * The owner the SDK is configured with.
   *
   * In live mode this comes from the device, so no key material is involved.
   */
  async ownerAddress(): Promise<`0x${string}`> {
    if (this.cachedOwner !== null) return this.cachedOwner;
    this.cachedOwner =
      this.opts.ledger !== undefined
        ? await this.opts.ledger.address()
        : this.opts.ownerAddress;
    return this.cachedOwner;
  }

  /**
   * Derive the Safe instance: connect to an existing address, or build the
   * not-yet-deployed configuration. The SDK's `signer` is the owner *address*
   * — never a private key.
   */
  private async safe(): Promise<Safe> {
    if (this.cachedSafe !== null) return this.cachedSafe;

    const { publicClient, safeAddress, predictedSafe } = this.opts;
    const owner = await this.ownerAddress();

    this.cachedSafe = await Safe.init({
      provider: asEip1193Provider(publicClient),
      signer: owner,
      ...(safeAddress !== undefined
        ? { safeAddress }
        : {
            predictedSafe: {
              safeAccountConfig: {
                owners: [...(predictedSafe?.owners ?? [owner])],
                threshold: predictedSafe?.threshold ?? 1,
              },
              safeDeploymentConfig: {
                safeVersion: predictedSafe?.safeVersion ?? "1.3.0",
              },
            },
          }),
    });
    return this.cachedSafe;
  }

  /** The configured or counterfactual Safe address, lower-cased. */
  async address(): Promise<string> {
    const sdk = await this.safe();
    return toLowerAddress(await sdk.getAddress());
  }

  /** Whether the Safe has code on chain. Live mode only — this reads the chain. */
  async isDeployed(): Promise<boolean> {
    const sdk = await this.safe();
    return sdk.isSafeDeployed();
  }

  /** The Safe singleton version in use. */
  async version(): Promise<string> {
    const sdk = await this.safe();
    return sdk.getContractVersion();
  }

  /**
   * Build the agent's proposal: a Safe transaction, with no signature
   * attached.
   */
  async createTransaction(
    transactions: readonly SafeLeg[],
    options?: SafeTransactionOptions,
  ): Promise<SafeTransaction> {
    const sdk = await this.safe();
    const props: CreateTransactionProps = { transactions: [...transactions] };
    const resolvedOptions = options ?? this.defaultOptions();
    if (resolvedOptions !== undefined) props.options = resolvedOptions;
    return sdk.createTransaction(props);
  }

  /**
   * Build a complete, unsigned proposal — the dry-mode deliverable.
   *
   * Returns the Safe tx hash an owner must sign plus the `execTransaction`
   * calldata, so an integrating app can show the user exactly what is being
   * authorised before a device is ever involved.
   */
  async buildProposal(
    transactions: readonly SafeLeg[],
    options?: SafeTransactionOptions,
  ): Promise<SafeProposal> {
    const sdk = await this.safe();
    const tx = await this.createTransaction(transactions, options);
    return {
      safeAddress: await this.address(),
      safeTxHash: await sdk.getTransactionHash(tx),
      calldata: await sdk.getEncodedTransaction(tx),
      nonce: tx.data.nonce,
      legs: [...transactions],
    };
  }

  /**
   * The EIP-712 payload split into the two 32-byte hashes a Ledger signs.
   *
   * The struct hash comes from the SDK's `getTransactionHash` rather than
   * being re-hashed here, so it is exactly what the Safe contract verifies.
   */
  async eip712Digest(tx: SafeTransaction): Promise<SafeEip712Digest> {
    const sdk = await this.safe();
    const typedData = generateTypedData({
      safeAddress: await sdk.getAddress(),
      safeVersion: sdk.getContractVersion(),
      chainId: BigInt(this.chainId),
      data: tx.data,
    });
    return {
      /**
       * Bridge, not a conversion: protocol-kit declares `domain.chainId` as
       * `string | number` and its `types` as a closed shape, while viem's
       * `hashDomain` takes `number | bigint` and an open `TypedData`. At
       * runtime the objects are exactly the EIP-712 payload viem hashes.
       *
       * Kept as the SDK's own output rather than mirroring the domain by hand
       * because protocol-kit varies it by Safe version — `chainId` is present
       * only from 1.3.0 — and getting that subtly wrong would produce
       * signatures that fail on-device, where nothing here could catch it.
       */
      domainSeparator: hashDomain({
        domain: typedData.domain,
        types: typedData.types,
      } as unknown as Parameters<typeof hashDomain>[0]),
      messageHash: await sdk.getTransactionHash(tx),
    };
  }

  /**
   * Sign a Safe transaction on the Ledger. The human approves on the device —
   * this is the irreversible-action gate.
   *
   * @throws if the client is in dry mode, where there is no device.
   */
  async signWithLedger(tx: SafeTransaction): Promise<SignedSafeTransaction> {
    if (this.opts.ledger === undefined) {
      throw new Error(
        "SafeClient is in dry mode and has no device to sign with. " +
          "Construct it with `ledger` to sign, or use `buildProposal` instead.",
      );
    }
    const digest = await this.eip712Digest(tx);
    const signature = await this.opts.ledger.signSafeDigest(
      digest.domainSeparator,
      digest.messageHash,
    );
    return { tx, signature, ...digest };
  }

  /**
   * Attach an owner signature to a Safe transaction and return the packed
   * signature payload, ready for submission or relay.
   */
  async attachSignature(signed: SignedSafeTransaction): Promise<string> {
    const owner = await this.ownerAddress();
    signed.tx.addSignature(new EthSafeSignature(owner, signed.signature));
    return signed.tx.encodedSignatures();
  }

  /**
   * The transaction that deploys this Safe, for an owner to send.
   *
   * protocol-kit v6 has no `deploySafe`, but it does expose `getInitCode()`,
   * which produces exactly the proxy-creation calldata. Nothing is signed or
   * broadcast here.
   *
   * @throws if the Safe is already deployed — there is nothing to deploy.
   */
  async deploymentRequest(): Promise<SafeDeploymentRequest> {
    const sdk = await this.safe();
    if (await sdk.isSafeDeployed()) {
      throw new Error(`Safe ${await this.address()} is already deployed`);
    }
    const factory = await getSafeProxyFactoryContract({
      safeProvider: sdk.getSafeProvider(),
      safeVersion: sdk.getContractVersion(),
    });
    return {
      to: await factory.getAddress(),
      value: 0n,
      data: await sdk.getInitCode(),
      predictedAddress: await this.address(),
    };
  }

  /** The configured nonce, when the caller supplied one. */
  private defaultOptions(): SafeTransactionOptions | undefined {
    return this.opts.nonce !== undefined ? { nonce: this.opts.nonce } : undefined;
  }
}
