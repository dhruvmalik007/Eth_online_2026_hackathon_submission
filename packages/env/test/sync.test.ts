import { describe, expect, it } from "vitest";
import { ENVIRONMENTS, SECRET_NAMES, VERCEL_ENVIRONMENTS, renderSyncScript, syncPlan } from "../src/index.js";

describe("renderSyncScript", () => {
  it("pushes to Vercel by piping the value, never echoing it", () => {
    const script = renderSyncScript({ target: "vercel", environment: "staging", file: ".env.staging" });
    expect(script).toContain('vercel env add "$key" preview "" --force --yes --non-interactive');
    expect(script).toContain('FILE=".env.staging"');
    expect(script).not.toContain('echo "$value"');
  });

  it("sends Vercel the platform's lane name, never ours", () => {
    // `staging` is not a Vercel environment. Sent verbatim it is rejected — "custom environment ids
    // that do not exist" — and under the script's `set -e` the loop dies on the first variable, so the
    // sync looks like it ran and injects nothing. This mapping is the whole fix.
    const script = renderSyncScript({ target: "vercel", environment: "staging", file: ".env.staging" });
    const commands = script.split("\n").filter((line) => line.includes("vercel env add"));
    expect(commands).toHaveLength(1);
    expect(commands[0]).not.toContain("staging");
    expect(commands[0]).toContain("preview");
  });

  it("keeps production as production", () => {
    const script = renderSyncScript({ target: "vercel", environment: "production", file: ".env.production" });
    expect(script).toContain('vercel env add "$key" production "" --force --yes --non-interactive');
  });

  it("maps every repo environment onto a lane Vercel accepts", () => {
    expect(Object.keys(VERCEL_ENVIRONMENTS).sort()).toEqual([...ENVIRONMENTS].sort());
    for (const lane of Object.values(VERCEL_ENVIRONMENTS)) {
      expect(["production", "preview", "development"]).toContain(lane);
    }
  });

  it("does not require a git branch to be answered, so it can run unattended", () => {
    // Without the empty branch argument and --non-interactive the CLI answers
    // `action_required: git_branch_required` and exits 1 rather than adding anything.
    const script = renderSyncScript({ target: "vercel", environment: "staging", file: ".env.staging" });
    expect(script).toContain("--non-interactive");
    expect(script).toContain('preview ""');
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
