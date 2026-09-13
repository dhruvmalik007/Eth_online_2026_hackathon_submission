import { describe, expect, it } from "vitest";
import { SECRET_NAMES, renderSyncScript, syncPlan } from "../src/index.js";

describe("renderSyncScript", () => {
  it("pushes to Vercel by piping the value, never echoing it", () => {
    const script = renderSyncScript({ target: "vercel", environment: "staging", file: ".env.staging" });
    expect(script).toContain('vercel env add "$key" staging --force');
    expect(script).toContain('FILE=".env.staging"');
    expect(script).not.toContain('echo "$value"');
  });

  it("creates a GCP secret or adds a version to an existing one", () => {
    const script = renderSyncScript({
      target: "gcloud",
      environment: "production",
      file: ".env.production",
      project: "agentic-ems",
    });
    expect(script).toContain("gcloud secrets versions add");
    expect(script).toContain("gcloud secrets create");
    expect(script).toContain("--project agentic-ems");
  });

  it("sets a GitHub environment secret", () => {
    const script = renderSyncScript({ target: "github", environment: "production", file: ".env.production" });
    expect(script).toContain('gh secret set "$key" --env production');
  });

  it("filters to secrets only from the catalog", () => {
    const script = renderSyncScript({
      target: "vercel",
      environment: "staging",
      file: ".env.staging",
      secretsOnly: true,
    });
    expect(script).toContain("TIMESERIES_DATABASE_URL");
    expect(script).not.toContain("PORT");
  });

  it("refuses to run without the values file", () => {
    const script = renderSyncScript({ target: "dotenv", environment: "local", file: ".env.local" });
    expect(script).toContain('[ -f "$FILE" ]');
  });
});

describe("syncPlan", () => {
  it("lists every variable for a service", () => {
    expect(syncPlan({ service: "shared" })).toEqual(["EMS_ENV", "LOG_LEVEL"]);
  });

  it("restricts to secrets when asked", () => {
    const secrets = syncPlan({ secretsOnly: true });
    expect(secrets).toEqual([...SECRET_NAMES]);
    expect(secrets).not.toContain("PORT");
  });
});
