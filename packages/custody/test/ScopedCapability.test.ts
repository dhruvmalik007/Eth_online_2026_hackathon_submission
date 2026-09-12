import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScopedCapability } from "../src/ring/ScopedCapability.js";
import type { KeyRingClient, RingKeyInfo } from "../src/ring/KeyRingClient.js";
import type { AgentCapability } from "../src/policy/policySchema.js";

/** In-memory ring that encrypts by base64 (not LKRP, but exercises the round-trip). */
class FakeRing {
  readonly stored = new Map<string, string>();
  encryptFile = vi.fn(async (o: { key: string; input: string; output: string }) => {
    const plain = await readFile(o.input, "utf-8");
    this.stored.set(o.key, Buffer.from(plain, "utf-8").toString("base64"));
    await writeFile(o.output, this.stored.get(o.key)!, "utf-8");
    return o.key;
  });
  decryptFile = vi.fn(async (o: { key: string; input: string; output: string }) => {
    const buf = await readFile(o.input, "utf-8");
    const plain = Buffer.from(buf, "base64").toString("utf-8");
    await writeFile(o.output, plain, "utf-8");
    return o.key;
  });
  listKeys = vi.fn(async (): Promise<RingKeyInfo[]> => []);
  hasKey = vi.fn(async (_name: string) => false);
}

describe("ScopedCapability", () => {
  it("round-trips a capability through encrypt -> decrypt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "custody-cap-"));
    try {
      const ring = new FakeRing() as unknown as KeyRingClient;
      const cap = new ScopedCapability(ring, {
        keyName: "agent-scoped-0",
        ciphertextPath: join(dir, "agent-0.cap.enc"),
      });
      const body: AgentCapability = {
        agentId: "agent-0",
        safeAddress: "0x1111111111111111111111111111111111111111",
        role: "proposer",
        policy: { perTxCapUsdc: 1000, dailyCapUsdc: 5000, recipientAllowlist: [], chainAllowlist: [] },
      };

      await cap.issue(body, join(dir, "plain.json"));
      // ciphertext must not be the plaintext
      const enc = await readFile(cap.path, "utf-8");
      expect(enc).not.toContain("agent-0");

      const resolved = await cap.resolve(join(dir, "plain2.json"));
      expect(resolved).toEqual(body);
      expect(ring.encryptFile).toHaveBeenCalledTimes(1);
      expect(ring.decryptFile).toHaveBeenCalledTimes(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});