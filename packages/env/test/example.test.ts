import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildManifest, renderExample } from "../src/index.js";

describe("renderExample", () => {
  it("is generated, header and all", () => {
    const example = renderExample({ environment: "staging" });
    expect(example).toContain("Generated from @ethonline2026/env");
    expect(example).toContain("# Environment: staging");
    expect(example).toContain("EMS_ENV=");
  });

  it("never writes a secret value", () => {
    const example = renderExample({ environment: "production" });
    const dsnLine = example.split("\n").find((line) => line.startsWith("TIMESERIES_DATABASE_URL="));
    expect(dsnLine).toBe("TIMESERIES_DATABASE_URL=");
  });

  it("is deterministic", () => {
    expect(renderExample({ service: "execution" })).toBe(renderExample({ service: "execution" }));
  });
});

describe("the committed root .env.example", () => {
  it("is exactly what the generator produces, so it cannot drift", () => {
    const repoRoot = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const committed = readFileSync(join(repoRoot, ".env.example"), "utf8");
    expect(committed).toBe(renderExample({ environment: "local" }));
  });
});

describe("buildManifest", () => {
  it("is the CI contract", () => {
    const manifest = buildManifest();
    expect(manifest.environments).toEqual(["local", "staging", "production"]);
    expect(manifest.vars.length).toBeGreaterThan(50);
    const dsn = manifest.vars.find((entry) => entry.name === "TIMESERIES_DATABASE_URL");
    expect(dsn?.requiredIn).toEqual(["staging", "production"]);
    expect(dsn?.secret).toBe(true);
  });
});
