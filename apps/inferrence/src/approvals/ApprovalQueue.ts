/**
 * Human-in-the-loop approval queue.
 *
 * The agent proposes; the user disposes. An intent sits here between
 * `approval.requested` and `approval.resolved`, and the run sits in
 * `awaiting_user`. Only a device-produced signature resolves it as `approved` —
 * there is no code path that approves an intent on the user's behalf.
 */
import { verifySigningIntent, type SigningIntent } from "@ethonline2026/custody";
import { HttpError } from "../http.js";

export type ApprovalOutcome = "approved" | "rejected" | "expired";

export interface PendingApproval {
  /**
   * Our run id.
   *
   * Deliberately **not** a field on the intent: the custody package is
   * app-agnostic and knows nothing about sessions or runs, so the correlation
   * lives here, where the run is what actually owns the approval.
   */
  readonly runId: string;
  readonly intent: SigningIntent;
  readonly requestedAt: string;
  readonly outcome: ApprovalOutcome | null;
  readonly resolvedAt: string | null;
}

export interface ResolveApprovalInput {
  readonly intentId: string;
  readonly outcome: ApprovalOutcome;
  /** Required for `approved`; the device-signed payload. */
  readonly signature?: string;
  readonly txHash?: string;
}

export class ApprovalQueue {
  readonly #pending = new Map<string, PendingApproval>();
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  request(intent: SigningIntent, runId: string): PendingApproval {
    if (!verifySigningIntent(intent)) {
      throw new HttpError("BAD_REQUEST", `Intent ${intent.intentId} digest does not match its body.`);
    }
    const entry: PendingApproval = {
      runId,
      intent,
      requestedAt: this.#now().toISOString(),
      outcome: null,
      resolvedAt: null,
    };
    this.#pending.set(intent.intentId, entry);
    return entry;
  }

  get(intentId: string): PendingApproval | null {
    return this.#pending.get(intentId) ?? null;
  }

  #require(intentId: string): PendingApproval {
    const entry = this.#pending.get(intentId);
    if (entry === undefined) {
      throw new HttpError("NOT_FOUND", `No approval request ${intentId}.`);
    }
    return entry;
  }

  resolve(input: ResolveApprovalInput): PendingApproval {
    const entry = this.#require(input.intentId);
    if (entry.outcome !== null) {
      throw new HttpError("CONFLICT", `Approval ${input.intentId} already resolved as ${entry.outcome}.`);
    }
    if (input.outcome === "approved" && (input.signature === undefined || input.signature.length === 0)) {
      throw new HttpError(
        "BAD_REQUEST",
        "An approval requires the device-produced signature; the service cannot sign.",
      );
    }
    const resolved: PendingApproval = {
      ...entry,
      outcome: input.outcome,
      resolvedAt: this.#now().toISOString(),
    };
    this.#pending.set(input.intentId, resolved);
    return resolved;
  }

  pending(runId?: string): PendingApproval[] {
    return [...this.#pending.values()].filter(
      (entry) => entry.outcome === null && (runId === undefined || entry.runId === runId),
    );
  }
}
