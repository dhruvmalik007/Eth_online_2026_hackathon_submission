/**
 * CustodyLog — append-only JSONL audit trail.
 *
 * Every custody decision (intent submitted, attested, policy-rejected,
 * device-approved, device-rejected, executed) is written once. The file is
 * never rewritten in place; a corrupt/locked file fails the operation loudly
 * rather than silently continuing without an audit record.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type CustodyEventType =
  | "intent_submitted"
  | "policy_rejected"
  | "attestation_created"
  | "proposal_created"
  | "device_requested"
  | "device_approved"
  | "device_rejected"
  | "executed"
  | "failed";

export interface CustodyEvent {
  /** Epoch milliseconds. */
  ts: number;
  type: CustodyEventType;
  /** Run/request correlation id. */
  requestId: string;
  intentHash?: string;
  agentId?: string;
  safeAddress?: string;
  chain?: string;
  /** Machine-readable detail (proposal id, tx hash, policy reason…). */
  detail?: Record<string, unknown>;
}

export class CustodyLog {
  private readonly path: string;

  constructor(path: string = process.env.CUSTODY_LOG_PATH ?? "./custody-audit.jsonl") {
    this.path = path;
  }

  get filePath(): string {
    return this.path;
  }

  /** Append a single event atomically (one line), creating the dir/file on first use. */
  async append(event: CustodyEvent): Promise<void> {
    const line = `${JSON.stringify(event)}\n`;
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, line, { encoding: "utf-8" });
  }
}