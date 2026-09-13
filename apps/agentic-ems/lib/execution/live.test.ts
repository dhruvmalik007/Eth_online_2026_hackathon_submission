import { describe, expect, it, vi } from "vitest";
import {
  chainKeyForId,
  confirmedHash,
  fetchBridgeProgress,
  hashesFromSteps,
  toMessageTracking,
  type RecordedStep,
} from "./live";

/** A step as the service stores it; overrides keep each test about one field. */
function step(overrides: Partial<RecordedStep> = {}): RecordedStep {
  return {
    stepId: "s1",
    intentId: "i1",
    seq: 0,
    kind: "bridge",
    label: "Bridge USDC to Base",
    status: "submitted",
    chainId: 8453,
    txHash: null,
    srcTxHash: null,
    dstTxHash: null,
    guid: null,
    error: null,
    ...overrides,
  };
}

describe("chainKeyForId", () => {
  it("resolves the chains the desk supports", () => {
    expect(chainKeyForId(8453)).toBe("base");
    expect(chainKeyForId(137)).toBe("polygon");
    expect(chainKeyForId(10)).toBe("optimism");
  });

  it("returns undefined for a chain it does not know", () => {
    // The app must not invent an explorer domain for a chain it has no metadata for.
    expect(chainKeyForId(1)).toBeUndefined();
  });
});

describe("toMessageTracking", () => {
  it("returns undefined when a step recorded no hash at all", () => {
    // The dry-mode case, and the reason the UI can say "not broadcast" instead of linking nowhere.
    expect(toMessageTracking(step())).toBeUndefined();
  });

  it("keeps the source and destination hashes distinct", () => {
    const tracking = toMessageTracking(
      step({ srcTxHash: "0xaaa", dstTxHash: "0xbbb", guid: "0xguid" }),
    );
    expect(tracking?.srcTxHash).toBe("0xaaa");
    expect(tracking?.dstTxHash).toBe("0xbbb");
    expect(tracking?.srcExplorerUrl).toContain("0xaaa");
    expect(tracking?.dstExplorerUrl).toContain("0xbbb");
    expect(tracking?.srcExplorerUrl).not.toBe(tracking?.dstExplorerUrl);
  });

  it("keys the scan URL on the guid, since that is what the tracker resolves", () => {
    const tracking = toMessageTracking(step({ srcTxHash: "0xaaa", guid: "0xguid" }));
    expect(tracking?.scanUrl).toContain("0xguid");
  });

  it("falls back to the source hash when there is no guid", () => {
    expect(toMessageTracking(step({ srcTxHash: "0xaaa" }))?.scanUrl).toContain("0xaaa");
  });

  it("keeps the hash but drops the link on an unknown chain", () => {
    const tracking = toMessageTracking(step({ chainId: 1, srcTxHash: "0xaaa" }));
    expect(tracking?.srcTxHash).toBe("0xaaa");
    expect(tracking?.srcExplorerUrl).toBeUndefined();
  });

  it("treats an empty-string hash as absent", () => {
    // Empty is what a nullable column yields through a mapper that returns '' for null.
    expect(toMessageTracking(step({ srcTxHash: "" }))).toBeUndefined();
  });
});

describe("confirmedHash", () => {
  it("returns the recorded hash", () => {
    expect(confirmedHash(step({ txHash: "0xccc" }))).toBe("0xccc");
  });

  it("returns undefined rather than an empty string", () => {
    expect(confirmedHash(step())).toBeUndefined();
  });
});

describe("hashesFromSteps", () => {
  it("emits nothing for a run with no hashes", () => {
    expect(hashesFromSteps([step(), step({ stepId: "s2" })])).toEqual([]);
  });

  it("labels each hash with the step that produced it", () => {
    const out = hashesFromSteps([step({ label: "Supply USDC", txHash: "0xccc" })]);
    expect(out).toEqual([
      { label: "Supply USDC", hash: "0xccc", url: expect.stringContaining("0xccc") },
    ]);
  });

  it("prefers the destination hash for a cross-chain step", () => {
    // The destination is where the funds ended up, so that is the one worth linking.
    const out = hashesFromSteps([step({ srcTxHash: "0xaaa", dstTxHash: "0xbbb" })]);
    expect(out).toHaveLength(1);
    expect(out[0]?.hash).toBe("0xbbb");
  });

  it("does not fall back to the source hash when only the source exists", () => {
    // A bridge that has not landed has no destination hash; the row shows its in-flight tracking
    // instead, and a run record listing a delivered-looking hash would overstate it.
    expect(hashesFromSteps([step({ srcTxHash: "0xaaa" })])).toEqual([]);
  });
});

describe("fetchBridgeProgress", () => {
  it("sends the development authenticator's header", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ count: 0, bridges: [] }), { status: 200 }),
    );
    await fetchBridgeProgress({ baseUrl: "https://x.test", userId: "u1", fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-user-id"]).toBe("u1");
  });

  it("parses the bridges envelope", async () => {
    const body = { count: 1, bridges: [{ ...step({ srcTxHash: "0xaaa" }) }] };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const steps = await fetchBridgeProgress({
      baseUrl: "https://x.test/",
      userId: "u1",
      fetchImpl,
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]?.srcTxHash).toBe("0xaaa");
  });

  it("names the status when the service refuses", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));
    await expect(
      fetchBridgeProgress({ baseUrl: "https://x.test", userId: "u1", fetchImpl }),
    ).rejects.toThrow(/503/);
  });

  it("drops rows that are not steps", async () => {
    // An unreadable row must not become a half-rendered tracking row.
    const body = { count: 2, bridges: [{ nope: true }, { ...step({ dstTxHash: "0xbbb" }) }] };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const steps = await fetchBridgeProgress({ baseUrl: "https://x.test", userId: "u1", fetchImpl });
    expect(steps).toHaveLength(1);
  });
});
