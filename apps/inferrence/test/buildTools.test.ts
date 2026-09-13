import type { RiskProfileReader } from "@ethonline2026/risk-analysis-data-pipeline";
import type { TimesFM3ToolDeps, TimeseriesToolDeps, UniswapV4ClientOptions } from "@ethonline2026/langchain-agent";
import { describe, expect, it } from "vitest";
import { buildTools, type ToolDeps } from "../src/tools/buildTools.js";

/**
 * These assert the *registration* decision, not the tools' behaviour — the tools have their own suites
 * in `packages/langchain`. What matters here is that a group is either fully present or explicitly
 * accounted for, because a half-wired group is invisible from the outside and shows up only as an
 * agent that cannot see the data it was asked about.
 */

/** Constructed rather than mocked: an empty object satisfies the structural shape at build time. */
function allDeps(): ToolDeps {
  return {
    risk: {} as unknown as RiskProfileReader,
    timeseries: {} as unknown as TimeseriesToolDeps,
    timesfm3: { http: {}, tsdb: {} } as unknown as TimesFM3ToolDeps,
    uniswapV4: { gatewayApiKey: "test" } as UniswapV4ClientOptions,
  };
}

describe("buildTools", () => {
  it("registers the dependency-free groups, so an unconfigured deployment still has tools", () => {
    const built = buildTools("v01");
    expect(built.registered).toContain("math");
    expect(built.registered).toContain("fixed-income");
    expect(built.registered).toContain("lending");
    expect(built.tools.length).toBeGreaterThan(0);
  });

  it("absorbs the factories that return an object rather than an array", () => {
    // `createAquaTools` returns a name-keyed object. A caller that assumed an array would register the
    // group with zero tools and report success — which is why this is asserted by count, not by id.
    const built = buildTools("v01", allDeps());
    const aqua = buildTools("v01").registered.includes("aqua");
    expect(aqua).toBe(true);
    const names = built.tools.map((tool) => tool.name);
    expect(names).toContain("aqua_flight_decision");
    expect(names).toContain("aqua_enablement");
  });

  it("omits a group whose dependency is absent, naming the setting that would include it", () => {
    const built = buildTools("v01");
    expect(built.registered).not.toContain("risk");
    expect(built.omitted.find((o) => o.id === "risk")?.reason).toContain("RISK_GCS_BUCKET");
  });

  it("registers a group as soon as its dependency is supplied, and stops reporting it omitted", () => {
    const built = buildTools("v01", { risk: {} as unknown as RiskProfileReader });
    expect(built.registered).toContain("risk");
    expect(built.omitted.map((o) => o.id)).not.toContain("risk");
    expect(built.tools.map((t) => t.name)).toContain("risk_chain_profile");
  });

  it("never reports a sandbox group as omitted — it runs elsewhere, it is not missing", () => {
    const built = buildTools("v01", allDeps());
    expect(built.omitted.map((o) => o.id)).not.toContain("untrusted-code");
    expect(built.registered).not.toContain("untrusted-code");
  });

  it("honours the mode, so a deep-only group does not appear in v01", () => {
    expect(buildTools("v01").registered).not.toContain("prediction");
    expect(buildTools("deep").registered).toContain("prediction");
  });

  it("registers no duplicate tool name, since the model selects by name", () => {
    const names = buildTools("deep", allDeps()).tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("registers strictly more tools with full dependencies than without", () => {
    // The coarse check: if the dependency-bearing groups silently contributed nothing, these would be
    // equal and every finer assertion above could still pass.
    expect(buildTools("deep", allDeps()).tools.length).toBeGreaterThan(
      buildTools("deep").tools.length,
    );
  });
});
