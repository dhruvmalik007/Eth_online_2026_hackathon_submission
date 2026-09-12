/**
 * ScopedCapability — the ring-encrypted envelope that limits an agent to ONE
 * Safe and ONE policy, rooted in the Ledger Key Ring.
 *
 * A capability is a JSON document (the same shape as `ScopedCapability` in
 * policySchema) encrypted with `wallet-cli ring encrypt --key <name>` so that:
 *  - only this machine's ring (rooted in the user's Ledger seed) can decrypt it;
 *  - the key name (`agentId`-derived) scopes the agent to its own capability;
 *  - the decrypted policy is what PolicyGate enforces BEFORE anything proposes.
 */
import { readFile, writeFile, rm } from "node:fs/promises";
import type { AgentCapability } from "../policy/policySchema.js";
import { capabilitySchema } from "../policy/policySchema.js";
import type { KeyRingClient } from "./KeyRingClient.js";

export interface ScopedCapabilityOptions {
  /** Ring key name under which the capability is stored (e.g. `agent-scoped-0`). */
  keyName: string;
  /** Where the encrypted capability blob lives on disk. */
  ciphertextPath: string;
}

export class ScopedCapability {
  private readonly keyName: string;
  private readonly ciphertextPath: string;
  private readonly ring: KeyRingClient;

  constructor(ring: KeyRingClient, options: ScopedCapabilityOptions) {
    this.ring = ring;
    this.keyName = options.keyName;
    this.ciphertextPath = options.ciphertextPath;
  }

  get key(): string {
    return this.keyName;
  }

  get path(): string {
    return this.ciphertextPath;
  }

  /**
   * Issue a capability: validate the body, encrypt it to the ring, write the
   * ciphertext blob. Pure plaintext is only ever materialized in a temp file
   * that is removed immediately after encrypting.
   */
  async issue(body: AgentCapability, plaintextTempPath: string): Promise<void> {
    const parsed = capabilitySchema.parse(body);
    await writeFile(plaintextTempPath, JSON.stringify(parsed), "utf-8");
    await this.ring.encryptFile({
      key: this.keyName,
      input: plaintextTempPath,
      output: this.ciphertextPath,
    });
    await rm(plaintextTempPath, { force: true });
  }

  /** Resolve the capability: decrypt via the ring into memory (never logs it). */
  async resolve(plaintextTempPath: string): Promise<AgentCapability> {
    await this.ring.decryptFile({
      key: this.keyName,
      input: this.ciphertextPath,
      output: plaintextTempPath,
    });
    const raw = await readFile(plaintextTempPath, "utf-8");
    await rm(plaintextTempPath, { force: true });
    return capabilitySchema.parse(JSON.parse(raw));
  }
}