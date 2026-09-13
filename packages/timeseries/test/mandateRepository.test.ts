import { describe, expect, it } from "vitest";
import { AgentMandateRepository, InvalidMandateError } from "../src/mandateRepository.js";
import type { SqlRunner } from "../src/runner.js";

/** Records what was asked, and answers with whatever the test wants. */
class RecordingRunner implements SqlRunner {
  readonly queries: { text: string; values: readonly unknown[] | undefined }[] = [];
  constructor(private readonly rows: Record<string, unknown>[] = []) {}

  async query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }> {
    this.queries.push({ text, values });
    // Only the upsert returns a row; the reads return the canned set.
    return { rows: text.includes("INSERT") ? this.rows : this.rows };
  }

  async transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

const ROW = {
  user_id: "did:privy:u1",
  agent: "v01",
  max_spend_usd: "250000",
  approval_required: true,
  updated_by: "did:privy:u1",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("AgentMandateRepository.get", () => {
  it("reports absence as null, which is not the same as zero", async () => {
    // A mandate of zero would forbid every trade; absence means "use the deployment default". A
    // caller that collapses the two cannot tell a deliberate lock-down from an unconfigured agent.
    const repository = new AgentMandateRepository(new RecordingRunner([]));

    expect(await repository.get("did:privy:u1", "v01")).toBeNull();
  });

  it("maps a row, coercing numerics out of Postgres' text form", async () => {
    const repository = new AgentMandateRepository(new RecordingRunner([ROW]));

    const mandate = await repository.get("did:privy:u1", "v01");

    expect(mandate).toMatchObject({ agent: "v01", maxSpendUsd: 250_000, approvalRequired: true });
    expect(mandate?.updatedAt).toBeInstanceOf(Date);
  });

  it("keys on the principal *and* the agent", async () => {
    // The same operator running two agents needs two limits; keying on the user alone would give both
    // whichever number was written last.
    const runner = new RecordingRunner([ROW]);
    await new AgentMandateRepository(runner).get("did:privy:u1", "v01");

    expect(runner.queries[0]?.values).toEqual(["did:privy:u1", "v01"]);
  });
});

describe("AgentMandateRepository.set", () => {
  it("upserts, so a settings form need not know whether the value already existed", async () => {
    const runner = new RecordingRunner([ROW]);

    await new AgentMandateRepository(runner).set({
      userId: "did:privy:u1",
      agent: "v01",
      maxSpendUsd: 250_000,
      approvalRequired: true,
      updatedBy: "did:privy:u1",
    });

    expect(runner.queries[0]?.text).toContain("ON CONFLICT");
    // The row is replaced wholesale, so a partial write cannot leave an old limit beside a new flag.
    expect(runner.queries[0]?.text).toContain("max_spend_usd     = EXCLUDED.max_spend_usd");
  });

  it("records who changed it", async () => {
    // The interesting question about a limit is rarely its value; it is who raised it.
    const runner = new RecordingRunner([ROW]);

    await new AgentMandateRepository(runner).set({
      userId: "did:privy:u1",
      agent: "v01",
      maxSpendUsd: 1_000,
      approvalRequired: false,
      updatedBy: "did:privy:treasury-1",
    });

    expect(runner.queries[0]?.values?.[4]).toBe("did:privy:treasury-1");
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
  ])("refuses a %s limit rather than storing it", async (_label, maxSpendUsd) => {
    // Zero would silently forbid every trade and NaN compares false against everything — both are
    // worse than a rejected save, because both fail at the point of spending.
    const repository = new AgentMandateRepository(new RecordingRunner([ROW]));

    await expect(
      repository.set({
        userId: "did:privy:u1",
        agent: "v01",
        maxSpendUsd,
        approvalRequired: true,
        updatedBy: "did:privy:u1",
      }),
    ).rejects.toThrow(InvalidMandateError);
  });

  it("refuses a blank agent name", async () => {
    const repository = new AgentMandateRepository(new RecordingRunner([ROW]));

    await expect(
      repository.set({
        userId: "did:privy:u1",
        agent: "   ",
        maxSpendUsd: 100,
        approvalRequired: true,
        updatedBy: "did:privy:u1",
      }),
    ).rejects.toThrow(InvalidMandateError);
  });

  it("refuses a write that returned no row instead of inventing one", async () => {
    const repository = new AgentMandateRepository(new RecordingRunner([]));

    await expect(
      repository.set({
        userId: "did:privy:u1",
        agent: "v01",
        maxSpendUsd: 100,
        approvalRequired: true,
        updatedBy: "did:privy:u1",
      }),
    ).rejects.toThrow(/returned no row/);
  });
});

describe("AgentMandateRepository.list", () => {
  it("returns every mandate for the principal, ordered by agent", async () => {
    const runner = new RecordingRunner([ROW]);

    const mandates = await new AgentMandateRepository(runner).list("did:privy:u1");

    expect(mandates).toHaveLength(1);
    expect(runner.queries[0]?.text).toContain("ORDER BY agent");
  });
});
