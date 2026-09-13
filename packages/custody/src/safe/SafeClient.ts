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
 * - **dry** — no signer. Build proposals, calldata and signing intents
 *   (`buildProposal`, `proposeIntent`), never sign. This is the package default
 *   and the mode an integrating app starts in.
 * - **live** — a {@link SafeTypedDataSigner} signs the EIP-712 digest. That
 *   signer may be a Privy server wallet (`PrivyWalletSigner`), a local key
 *   (`LocalKeySigner`, gated and test-only) or a Ledger device
 *   (`LedgerSignerAdapter`).
 *
 * The modes are distinguished by the type: you supply `signer`, `ledger`, or
 * `ownerAddress`, and supplying two — or none — is a compile error.
 *
 * @remarks
 * protocol-kit builds and encodes the transaction; the signature comes from a
 * signer. Only signature bytes ever reach the host process. No private key is
 * read, stored or passed anywhere in this file.
 */
import Safe, {
  EthSafeSignature,
  generateTypedData,
  getSafeProxyFactoryContract,
} from "@safe-global/protocol-kit";
import type { PublicClient } from "viem";
import type { Eip712TypedData } from "../eip712.js";
import { buildSigningIntent } from "../intent/IntentBuilder.js";
import type { SigningIntent, SigningIntentInput } from "../intent/SigningIntent.js";
// Type-only on purpose. `LedgerSignerAdapter` is used solely in the
// `SafeOwnerSource` union, and importing it as a value would pull the Ledger DMK
// into every consumer of this module — whose ESM build Node cannot resolve
// (`ERR_UNSUPPORTED_DIR_IMPORT`), breaking any plain-`node` entrypoint.
import type { LedgerSignerAdapter } from "./LedgerSignerAdapter.js";
import type { SafeTypedDataSigner } from "./SafeTypedDataSigner.js";
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
 *
 * Three sources, because the owner is a role rather than a device:
 *  - `signer` — any {@link SafeTypedDataSigner}: a Privy server wallet, a local
 *    key, or a future custodian. This is the general case.
 *  - `ledger` — kept as its own variant so existing hardware integrations do not
 *    change; `LedgerSignerAdapter` also satisfies the signer port.
 *  - `ownerAddress` — dry: identify an owner and build proposals, never sign.
 */
export type SafeOwnerSource =
  | {
      readonly ledger: LedgerSignerAdapter;
      readonly signer?: never;
      readonly ownerAddress?: never;
    }
  | {
      readonly signer: SafeTypedDataSigner;
      readonly ledger?: never;
      readonly ownerAddress?: never;
    }
  | {
      readonly ledger?: never;
      readonly signer?: never;
      readonly ownerAddress: `0x${string}`;
    };

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

/** A Safe transaction signed by an owner. */
export interface SignedSafeTransaction {
  readonly tx: SafeTransaction;
  /** Canonical owner signature bytes, `0x<r><s><v>`. */
  readonly signature: string;
  /**
   * The exact payload that was signed.
   *
   * Kept on the result so a caller can audit, re-derive or independently verify
   * what was authorised — and so the human-readable intent survives past the
   * signing step.
   */
  readonly typedData: Eip712TypedData;
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
 * Everything `proposeIntent` needs that is not derivable from the chain.
 *
 * The display fields are required: an intent whose human-readable sentence is
 * missing cannot be safely approved by anyone, so it is not optional.
 */
export interface ProposeIntentContext {
  readonly intentId: string;
  /** Correlates with `CustodyEvent.requestId`. */
  readonly requestId: string;
  readonly agentId: string;
  readonly kind?: SigningIntentInput["kind"];
  readonly display: SigningIntentInput["display"];
  readonly policy?: SigningIntentInput["policy"];
  readonly provenance?: SigningIntentInput["provenance"];
  readonly createdAt?: string;
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

  /** `live` when an owner signer was supplied, otherwise `dry`. */
  get mode(): "dry" | "live" {
    return this.opts.ledger !== undefined || this.opts.signer !== undefined ? "live" : "dry";
  }

  /**
   * The owner signer, when one can sign at all.
   *
   * `ledger` is not special-cased beyond this line: it satisfies the same port,
   * so every downstream call site is signer-agnostic.
   */
  private resolveSigner(): SafeTypedDataSigner | undefined {
    if (this.opts.signer !== undefined) return this.opts.signer;
    if (this.opts.ledger !== undefined) return this.opts.ledger;
    return undefined;
  }

  /**
   * The owner the SDK is configured with.
   *
   * In live mode this comes from the custodian (Privy) or the device (Ledger), so
   * no key material is involved.
   */
  async ownerAddress(): Promise<`0x${string}`> {
    if (this.cachedOwner !== null) return this.cachedOwner;
    this.cachedOwner =
      this.opts.ledger !== undefined
        ? await this.opts.ledger.address()
        : this.opts.signer !== undefined
          ? await this.opts.signer.address()
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
    const props: CreateTransactionProps = {
      transactions: [...transactions],
      // `onlyCalls` sits beside `transactions`, NOT inside `options` — protocol-kit
      // destructures it at the top level and defaults it to `true`, which throws on
      // any `operation: 1` leg. A batch containing MultiSend (or a v4 position flow)
      // legitimately needs DELEGATECALL, so the flag is derived from the legs rather
      // than left at a default that cannot express them.
      ...(hasDelegateCall(transactions) ? { onlyCalls: false } : {}),
    };
    const resolvedOptions = options ?? this.nonceOptions();
    if (resolvedOptions !== undefined) props.options = resolvedOptions;
    return sdk.createTransaction(props);
  }

  /**
   * Build a complete, unsigned proposal — the dry-mode deliverable.
   *
   * Returns the Safe tx hash an owner must sign plus the `execTransaction`
   * calldata, so an integrating app can show the user exactly what is being
   * authorised before any signer is ever involved.
   */
  async buildProposal(
    transactions: readonly SafeLeg[],
    options?: SafeTransactionOptions,
  ): Promise<SafeProposal> {
    const tx = await this.createTransaction(transactions, options);
    return await this.proposalFrom(tx, transactions);
  }

  /** The proposal view of an already-built transaction. Shared by `buildProposal` and `proposeIntent`. */
  private async proposalFrom(
    tx: SafeTransaction,
    legs: readonly SafeLeg[],
  ): Promise<SafeProposal> {
    const sdk = await this.safe();
    return {
      safeAddress: await this.address(),
      safeTxHash: await sdk.getTransactionHash(tx),
      calldata: await sdk.getEncodedTransaction(tx),
      nonce: tx.data.nonce,
      legs: [...legs],
    };
  }

  /**
   * Build the full, signable intent for a batch of legs.
   *
   * Composes the proposal, the EIP-712 payload and the versioned envelope in one
   * call so the three cannot drift apart — a mismatch between what is displayed,
   * what is hashed and what is signed is the failure mode this whole path exists
   * to prevent.
   *
   * Pure with respect to keys: nothing is signed here.
   */
  async proposeIntent(
    legs: readonly SafeLeg[],
    context: ProposeIntentContext,
  ): Promise<SigningIntent> {
    const tx = await this.createTransaction(legs);
    const proposal = await this.proposalFrom(tx, legs);
    const typedData = await this.safeTypedData(tx);

    return buildSigningIntent({
      intentId: context.intentId,
      requestId: context.requestId,
      agentId: context.agentId,
      createdAt: context.createdAt ?? new Date().toISOString(),
      chain: `eip155:${this.chainId}`,
      chainId: this.chainId,
      account: proposal.safeAddress,
      kind: context.kind ?? "safe-batch",
      signing: {
        scheme: "safe-typed-data",
        safeAddress: proposal.safeAddress,
        safeTxHash: proposal.safeTxHash,
        safeNonce: proposal.nonce,
        typedData,
      },
      display: context.display,
      authorized: {
        legs: [...proposal.legs],
        calldata: proposal.calldata,
        nonce: proposal.nonce,
      },
      ...(context.policy === undefined ? {} : { policy: context.policy }),
      ...(context.provenance === undefined ? {} : { provenance: context.provenance }),
    });
  }

  /**
   * The complete Safe EIP-712 payload, in the shape the device signs.
   *
   * Derived from protocol-kit's own typed data rather than assembled here, so
   * it is exactly what the Safe contract verifies — including protocol-kit's
   * rule that `chainId` appears in the domain only from Safe 1.3.0 onward.
   *
   * Sent whole rather than as two hashes so the device can decode and display
   * the intent instead of opaque bytes.
   */
  async safeTypedData(tx: SafeTransaction): Promise<Eip712TypedData> {
    const sdk = await this.safe();
    const generated = generateTypedData({
      safeAddress: await sdk.getAddress(),
      safeVersion: sdk.getContractVersion(),
      chainId: BigInt(this.chainId),
      data: tx.data,
    });

    const types: Record<string, Array<{ name: string; type: string }>> = {};
    for (const [name, fields] of Object.entries(generated.types)) {
      types[name] = fields.map((field: { name: string; type: string }) => ({
        name: field.name,
        type: field.type,
      }));
    }

    return {
      domain: {
        // The device takes a number, and every real chain id fits one easily.
        ...(generated.domain.chainId !== undefined
          ? { chainId: Number(generated.domain.chainId) }
          : {}),
        ...(generated.domain.verifyingContract !== undefined
          ? { verifyingContract: generated.domain.verifyingContract }
          : {}),
      },
      types,
      primaryType: generated.primaryType,
      message: generated.message,
    };
  }

  /**
   * Sign a Safe transaction with the configured owner signer.
   *
   * Whichever signer is in play, the human (or the custodian's policy) is the
   * gate: this is the irreversible-action step and it is never automatic.
   *
   * @throws if the client is in dry mode, where there is no signer.
   */
  async signWithSigner(tx: SafeTransaction): Promise<SignedSafeTransaction> {
    const signer = this.resolveSigner();
    if (signer === undefined) {
      throw new Error(
        "SafeClient is in dry mode and has no device to sign with. " +
          "Construct it with `signer` (or `ledger`) to sign, or use `buildProposal` instead.",
      );
    }
    const typedData = await this.safeTypedData(tx);
    const signature = await signer.signTypedData(typedData);
    return { tx, signature, typedData };
  }

  /**
   * Alias for {@link signWithSigner}, kept because it names the Safe context and
   * existing callers use it.
   */
  async signWithLedger(tx: SafeTransaction): Promise<SignedSafeTransaction> {
    return await this.signWithSigner(tx);
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

  /** The configured nonce, when the caller supplied one (a counterfactual Safe cannot read it). */
  private nonceOptions(): SafeTransactionOptions | undefined {
    return this.opts.nonce !== undefined ? { nonce: this.opts.nonce } : undefined;
  }
}

/** Whether any leg is a DELEGATECALL (`operation: 1`). */
function hasDelegateCall(legs: readonly SafeLeg[]): boolean {
  return legs.some((leg) => (leg.operation ?? 0) === 1);
}
