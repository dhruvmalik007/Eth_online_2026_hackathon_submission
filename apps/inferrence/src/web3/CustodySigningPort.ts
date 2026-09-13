/**
 * The custody seam.
 *
 * The intent envelope, the signer port and the Safe client all live in
 * `@ethonline2026/custody`; this module is the *policy* around them: which signer
 * this deployment uses, and the rule that the service never holds a key unless a
 * custodian (Privy) holds it instead.
 *
 * Three rules are structural here:
 *
 *  1. **`dry` proposes and cannot sign.** There is no code path from `dry` to a
 *     signature.
 *  2. **`sign` signs the intent's own payload**, not a rebuilt transaction. If it
 *     re-derived the typed data, a mismatch between what was displayed, hashed
 *     and signed would be possible — which is the exact failure this whole
 *     pipeline exists to prevent.
 *  3. **`verify` recovers the signer from that same payload.** An approval is only
 *     accepted if it came from the configured owner.
 */
import type {
  SafeClient,
  SafeLeg,
  SafeTypedDataSigner,
  SigningIntent,
  SigningIntentInput,
} from "@ethonline2026/custody";
import { toViemTypedData, verifySigningIntent } from "@ethonline2026/custody";
import { recoverTypedDataAddress } from "viem";
import { HttpError, NotImplementedError } from "../http.js";

/** One audit line. Mirrors custody's `CustodyEvent` vocabulary. */
export interface CustodyAuditEvent {
  readonly type:
    | "intent_submitted"
    | "policy_rejected"
    | "proposal_created"
    | "device_requested"
    | "device_approved"
    | "device_rejected"
    | "executed"
    | "failed";
  readonly requestId: string;
  readonly intentHash?: string;
  readonly agentId?: string;
  readonly safeAddress?: string;
  readonly chain?: string;
  readonly detail?: Record<string, unknown>;
}

/** Where custody decisions are recorded. */
export interface CustodyAudit {
  record(event: CustodyAuditEvent): Promise<void>;
}

/** Logs each event as one structured line, so it lands in Cloud Logging. */
export class LoggingCustodyAudit implements CustodyAudit {
  async record(event: CustodyAuditEvent): Promise<void> {
    console.log(JSON.stringify({ custody: event, ts: new Date().toISOString() }));
  }
}

export interface ProposeIntentRequest {
  readonly legs: readonly SafeLeg[];
  readonly display: SigningIntentInput["display"];
  readonly requestId: string;
  readonly agentId: string;
  readonly kind?: SigningIntentInput["kind"];
  readonly policy?: SigningIntentInput["policy"];
  readonly provenance?: SigningIntentInput["provenance"];
}

export interface CustodyProposal {
  readonly intentId: string;
  readonly mode: "dry" | "live";
  readonly account: string;
  /** `execTransaction` calldata an owner would authorise. */
  readonly calldata: string | null;
  readonly safeTxHash: string | null;
  readonly digest: string;
}

export interface CustodySignature {
  readonly signature: string;
  /** The exact EIP-712 payload that was signed, kept for the audit trail. */
  readonly typedData: unknown;
}

export interface CustodySigningPort {
  readonly mode: "dry" | "live";
  /** Build the signable intent. In live mode this is a real Safe proposal. */
  proposeIntent(request: ProposeIntentRequest): Promise<SigningIntent>;
  /** Sign it. Refuses in `dry` mode. */
  sign(intent: SigningIntent): Promise<CustodySignature>;
  /** Whether `signature` came from this deployment's owner, over this intent's payload. */
  verify(intent: SigningIntent, signature: string): Promise<boolean>;
  record(intent: SigningIntent, outcome: string): Promise<void>;
  /** The owner address, when there is one. */
  ownerAddress(): Promise<`0x${string}` | null>;
  /**
   * Whether the signing path is actually usable right now.
   *
   * A Safe proposal needs a reachable RPC, so this is a real dependency probe —
   * without it a dead RPC shows up as a silently stalled run (which is exactly
   * how it first presented).
   */
  healthy(): Promise<boolean>;
  /**
   * The RPC host in use, for `/health`.
   *
   * Reported because a silent fallback to viem's built-in endpoint cost real time:
   * the proposal stalled, `/health` said "ok", and nothing anywhere named the host.
   */
  readonly rpcHost: string | null;
}

/** Dry: builds an intent with no chain and no signer. */
export class DryCustodySigningPort implements CustodySigningPort {
  readonly mode = "dry" as const;
  readonly rpcHost = null;

  constructor(private readonly audit: CustodyAudit = new LoggingCustodyAudit()) {}

  async proposeIntent(_request: ProposeIntentRequest): Promise<SigningIntent> {
    // No SafeClient, so no chain and no calldata. Honest rather than fabricated.
    throw new NotImplementedError(
      "Dry-mode intent proposals need a chain (CUSTODY_SIGNER=privy or local-key)",
      "T7.3",
    );
  }

  async sign(_intent: SigningIntent): Promise<CustodySignature> {
    throw new HttpError(
      "UNAVAILABLE",
      "Dry custody mode cannot sign. Configure CUSTODY_SIGNER=privy (ROADMAP T7.3).",
    );
  }

  async verify(_intent: SigningIntent, _signature: string): Promise<boolean> {
    return false;
  }

  async record(intent: SigningIntent, outcome: string): Promise<void> {
    await this.audit.record({
      type: outcome === "rejected" ? "device_rejected" : "proposal_created",
      requestId: intent.requestId,
      intentHash: intent.digest,
      agentId: intent.agentId,
      safeAddress: intent.account,
      chain: intent.chain,
      detail: { outcome, mode: this.mode },
    });
  }

  async ownerAddress(): Promise<`0x${string}` | null> {
    return null;
  }

  async healthy(): Promise<boolean> {
    // Nothing to reach: dry mode never touches a chain.
    return true;
  }
}

export interface LiveCustodyOptions {
  readonly safeClient: SafeClient;
  readonly signer: SafeTypedDataSigner;
  /**
   * Resolves the owner address.
   *
   * A function rather than a value because deriving it (from Privy, or from a
   * local key) is asynchronous, while the composition root is synchronous and must
   * not await or block a cold start.
   */
  readonly resolveOwnerAddress: () => Promise<`0x${string}`>;
  /** Reaches the chain; see {@link CustodySigningPort.healthy}. */
  readonly probe: () => Promise<boolean>;
  /** Reported on `/health`; see {@link CustodySigningPort.rpcHost}. */
  readonly rpcHost: string | null;
  readonly audit: CustodyAudit;
}

/**
 * Live: a real Safe proposal plus a real signature from a configured owner.
 *
 * Used for both the Privy server wallet and the gated local-key path — the
 * difference is which `SafeTypedDataSigner` was injected, not which code runs.
 */
export class LiveCustodySigningPort implements CustodySigningPort {
  readonly mode = "live" as const;
  readonly rpcHost: string | null;
  readonly #options: LiveCustodyOptions;
  #owner: `0x${string}` | null = null;

  constructor(options: LiveCustodyOptions) {
    this.#options = options;
    this.rpcHost = options.rpcHost;
  }

  async ownerAddress(): Promise<`0x${string}` | null> {
    this.#owner ??= await this.#options.resolveOwnerAddress();
    return this.#owner;
  }

  async healthy(): Promise<boolean> {
    try {
      return await this.#options.probe();
    } catch {
      return false;
    }
  }

  async proposeIntent(request: ProposeIntentRequest): Promise<SigningIntent> {
    // Phase timing, because a stalled proposal has no error to report — it just
    // never resolves, and the only way to localise it is to log each boundary.
    const started = Date.now();
    const account = await this.#options.safeClient.address();
    const initialisedAt = Date.now();
    const intent = await this.#options.safeClient.proposeIntent(request.legs, {
      intentId: `intent-${request.requestId}`,
      requestId: request.requestId,
      agentId: request.agentId,
      ...(request.kind === undefined ? {} : { kind: request.kind }),
      display: request.display,
      ...(request.policy === undefined ? {} : { policy: request.policy }),
      ...(request.provenance === undefined ? {} : { provenance: request.provenance }),
    });
    console.log(
      JSON.stringify({
        custody: "propose_timing",
        requestId: request.requestId,
        safeInitMs: initialisedAt - started,
        proposalMs: Date.now() - initialisedAt,
        account,
      }),
    );
    await this.#options.audit.record({
      type: "intent_submitted",
      requestId: intent.requestId,
      intentHash: intent.digest,
      agentId: intent.agentId,
      safeAddress: intent.account,
      chain: intent.chain,
      detail: { legs: intent.authorized.legs.length, safeTxHash: safeTxHashOf(intent) },
    });
    return intent;
  }

  async sign(intent: SigningIntent): Promise<CustodySignature> {
    if (intent.signing.scheme !== "safe-typed-data") {
      throw new HttpError(
        "BAD_REQUEST",
        `This signer signs Safe typed data; intent uses scheme \`${intent.signing.scheme}\`.`,
      );
    }
    if (!verifySigningIntent(intent)) {
      throw new HttpError("BAD_REQUEST", `Intent ${intent.intentId} digest does not match its body.`);
    }
    // Signs the intent's OWN payload rather than rebuilding a transaction: the
    // typed data that was displayed and hashed is the typed data that is signed.
    const signature = await this.#options.signer.signTypedData(intent.signing.typedData);
    await this.#options.audit.record({
      type: "device_requested",
      requestId: intent.requestId,
      intentHash: intent.digest,
      agentId: intent.agentId,
      safeAddress: intent.account,
      chain: intent.chain,
      detail: { signer: this.#options.signer.kind },
    });
    return { signature, typedData: intent.signing.typedData };
  }

  async verify(intent: SigningIntent, signature: string): Promise<boolean> {
    if (intent.signing.scheme !== "safe-typed-data") return false;
    const owner = await this.ownerAddress();
    if (owner === null) return false;
    try {
      const recovered = await recoverTypedDataAddress({
        ...toViemTypedData(intent.signing.typedData),
        signature: signature as `0x${string}`,
      } as Parameters<typeof recoverTypedDataAddress>[0]);
      return recovered.toLowerCase() === owner.toLowerCase();
    } catch {
      // A malformed signature is a failed verification, not a 500.
      return false;
    }
  }

  async record(intent: SigningIntent, outcome: string): Promise<void> {
    await this.#options.audit.record({
      type:
        outcome === "approved"
          ? "device_approved"
          : outcome === "rejected"
            ? "device_rejected"
            : "failed",
      requestId: intent.requestId,
      intentHash: intent.digest,
      agentId: intent.agentId,
      safeAddress: intent.account,
      chain: intent.chain,
      detail: { outcome, signer: this.#options.signer.kind },
    });
  }
}

function safeTxHashOf(intent: SigningIntent): string | null {
  return intent.signing.scheme === "safe-typed-data" ? intent.signing.safeTxHash : null;
}
