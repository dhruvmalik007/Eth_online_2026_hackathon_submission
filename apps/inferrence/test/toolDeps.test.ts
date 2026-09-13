import { describe, expect, it } from "vitest";
import { loadInferenceEnv } from "../src/env.js";
import { buildTools } from "../src/tools/buildTools.js";
import { createToolDeps } from "../src/tools/deps.js";

/**
 * The contract under test is the one `buildTools` depends on: a dependency is either fully built or
 * `undefined`, and `undefined` omits the group with a reason naming the setting. These assert that
 * pairing directly, because a deps builder that returns a *half* object is the failure that would slip
 * through both suites independently — `buildTools` would see a value and register a broken group.
 */

const DB = "postgres://user:pass@localhost:5432/test";

/** A plausible DSN; `pg.Pool` is lazy, so nothing connects. */
function envWith(overrides: Record<string, string>) {
  return loadInferenceEnv(overrides as NodeJS.ProcessEnv);
}

describe("createToolDeps", () => {
  it("returns nothing at all when nothing is configured, rather than empty objects", () => {
    expect(createToolDeps(envWith({}))).toEqual({});
  });

  it("builds the risk reader from a local directory, which needs no credentials", () => {
    const deps = createToolDeps(envWith({ RISK_LOCAL_DIR: "/tmp/risk-snapshots" }));
    expect(deps.risk).toBeDefined();
    expect(deps.timeseries).toBeUndefined();
  });

  it("needs both halves for the timeseries bundle, since it includes the vector store", () => {
    // The database alone is not enough: `VectorRepository` takes an embedding service too.
    const dbOnly = createToolDeps(envWith({ TIMESERIES_DATABASE_URL: DB }));
    expect(dbOnly.timeseries).toBeUndefined();

    // The project alone is not enough either.
    const projectOnly = createToolDeps(envWith({ GOOGLE_CLOUD_PROJECT: "my-project" }));
    expect(projectOnly.timeseries).toBeUndefined();

    const both = createToolDeps(
      envWith({ TIMESERIES_DATABASE_URL: DB, GOOGLE_CLOUD_PROJECT: "my-project" }),
    );
    expect(both.timeseries).toBeDefined();
    expect(both.timeseries?.vectors).toBeDefined();
  });

  it("needs both halves for forecasting, since the window comes from the database", () => {
    // TimesFM-3 forecasts a window read from TimescaleDB — the service alone cannot answer.
    const serviceOnly = createToolDeps(envWith({ TIMESFM3_SERVICE_URL: "http://fm3" }));
    expect(serviceOnly.timesfm3).toBeUndefined();

    const both = createToolDeps(
      envWith({ TIMESFM3_SERVICE_URL: "http://fm3", TIMESERIES_DATABASE_URL: DB }),
    );
    expect(both.timesfm3?.http).toBeDefined();
    expect(both.timesfm3?.tsdb).toBeDefined();
  });

  it("builds the graph options only with a gateway key, carrying the optional ids through", () => {
    expect(createToolDeps(envWith({})).uniswapV4).toBeUndefined();

    const withId = createToolDeps(
      envWith({ GATEWAY_API_KEY: "k", UNISWAP_V4_SUBGRAPH_ID: "abc123" }),
    );
    expect(withId.uniswapV4).toEqual({ gatewayApiKey: "k", subgraphId: "abc123" });
  });

  it("treats a caller-owned client as configured, so a test or shared pool can inject one", () => {
    const deps = createToolDeps(envWith({}), {
      runner: {} as never,
      embeddings: { model: "local", dimension: 768, embed: async () => [] } as never,
    });
    expect(deps.timeseries).toBeDefined();
  });
});

describe("createToolDeps → buildTools", () => {
  it("moves the groups from omitted to registered as the settings appear", () => {
    // The end-to-end assertion for this pair: the reason strings and the builders have to agree, and
    // only a test that runs both can tell whether they do.
    const bare = buildTools("v01", createToolDeps(envWith({})));
    // All four dependency-bearing groups, since a stock environment sets none of their settings.
    expect(bare.omitted.map((o) => o.id).sort()).toEqual([
      "risk",
      "timeseries",
      "timesfm3",
      "uniswap-v4",
    ]);

    const configured = buildTools(
      "v01",
      createToolDeps(
        envWith({
          RISK_LOCAL_DIR: "/tmp/risk",
          TIMESERIES_DATABASE_URL: DB,
          GOOGLE_CLOUD_PROJECT: "my-project",
          GATEWAY_API_KEY: "k",
        }),
      ),
    );
    // `uniswap-v4` registers on the gateway key alone, so it is present in both runs.
    expect(configured.omitted.map((o) => o.id)).toEqual(["timesfm3"]);
    expect(configured.registered).toContain("risk");
    expect(configured.registered).toContain("timeseries");
    expect(configured.registered).toContain("uniswap-v4");
    expect(configured.tools.length).toBeGreaterThan(bare.tools.length);
  });
});
