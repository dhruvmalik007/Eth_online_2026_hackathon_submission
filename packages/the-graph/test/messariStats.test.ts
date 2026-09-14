/**
 * The registry's numbers, as the landing page reports them.
 *
 * These assert the two things a tile can get wrong: claiming the registry size is the live count
 * (it is not — 88 endpoints are dead), and reporting a deployment total that does not add up.
 */
import { describe, expect, it } from "vitest";
import { messariLiveness, messariNetworksIn, subgraphStats } from "../src/index.js";

describe("subgraphStats", () => {
  const stats = subgraphStats();

  it("counts live and dead separately, and they account for every probe", () => {
    const { total, standard, partial, dead } = stats.liveness;
    expect(standard + partial + dead).toBe(total);
    // The claim the hero must not make: the registry size as though it were the live count.
    expect(standard).toBeLessThan(total);
  });

  it("carries the provenance of the probe, so a stale count is visible", () => {
    expect(stats.liveness.probe).toBe(messariLiveness.probe);
    expect(stats.liveness.verifiedAt).toBe(messariLiveness.verifiedAt);
    expect(stats.liveness.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("totals deployments as the sum of its categories", () => {
    expect(stats.deployments.total).toBe(197);
    const summed = stats.deployments.byCategory.reduce((sum, entry) => sum + entry.count, 0);
    expect(summed).toBe(stats.deployments.total);
  });

  it("orders categories by size, so the display does not reshuffle", () => {
    const counts = stats.deployments.byCategory.map((entry) => entry.count);
    expect([...counts].sort((left, right) => right - left)).toEqual(counts);
  });

  it("is deterministic across calls", () => {
    expect(subgraphStats()).toEqual(stats);
  });
});

describe("messariNetworksIn", () => {
  it("reports the real spread of lending, which is far more than one chain", () => {
    const networks = messariNetworksIn("lending");
    expect(networks.length).toBeGreaterThanOrEqual(3);
    expect(networks).toContain("ethereum");
    expect(networks).toContain("arbitrum");
    expect(new Set(networks).size).toBe(networks.length);
  });
});
