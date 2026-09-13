import { describe, expect, it } from "vitest";
import { DeepGraphAgent } from "../src/agents/DeepGraphAgent.js";
import type { RiskProfileReader } from "@ethonline2026/risk-analysis-data-pipeline";

/**
 * The tools the agent can actually reach.
 *
 * `createMultiCategoryTools` is private, and that is right — tool assembly is not part of the agent's
 * contract. Reaching it through a cast is what makes *registration* testable, and registration is the
 * failure this file exists for: a tool that is exported from the package but never added to the array
 * is unreachable, and no public API would say so. Typechecking passes either way.
 */
function toolNames(agent: DeepGraphAgent): string[] {
  const internal = agent as unknown as { createMultiCategoryTools(): { name: string }[] };
  return internal.createMultiCategoryTools().map((entry) => entry.name);
}

describe("multi-category tool registration", () => {
  it("registers the Aqua/SwapVM tools", () => {
    // These reason about a proposal rather than reading one, so they need no RPC — there is no
    // configuration under which leaving them out would be right.
    const names = toolNames(new DeepGraphAgent());

    expect(names).toContain("aqua_flight_decision");
    expect(names).toContain("aqua_enablement");
    expect(names).toContain("aqua_order_bytes");
    expect(names).toContain("aqua_decode_receipt");
  });

  it("registers the chain risk report tool even with no reader configured", () => {
    // Registering it unconditionally is deliberate: with no store it answers
    // `risk_snapshots_unavailable`, which tells an operator to configure one. Omitting it would make
    // the absence look like "risk was not considered" instead.
    expect(toolNames(new DeepGraphAgent())).toContain("risk_chain_report");
  });

  it("keeps the pre-existing tools, so registering new ones is additive", () => {
    const names = toolNames(new DeepGraphAgent());

    // One from each of the families that were already there.
    expect(names.length).toBeGreaterThan(5);
    expect(names).toContain("risk_chain_profile");
  });

  it("accepts a reader without changing what is registered", () => {
    // The deps change the tool's behaviour, not the set — so a deployment that configures a store
    // does not silently gain or lose a tool.
    // Cast because `RiskProfileReader` extends four reader interfaces and this test only needs the
    // registration to succeed — the read path is covered by the risk package's own tests.
    const reader = { chain: async () => null } as unknown as RiskProfileReader;
    const withReader = toolNames(new DeepGraphAgent({ risk: { reader, inferredBy: "test-agent" } }));

    expect(withReader).toContain("risk_chain_report");
    expect(withReader.sort()).toEqual(toolNames(new DeepGraphAgent()).sort());
  });

  it("registers nothing twice", () => {
    // A duplicate name would make tool selection non-deterministic: the model picks by name, and two
    // entries with one name means which one runs is an implementation detail.
    const names = toolNames(new DeepGraphAgent());

    expect(new Set(names).size).toBe(names.length);
  });
});
