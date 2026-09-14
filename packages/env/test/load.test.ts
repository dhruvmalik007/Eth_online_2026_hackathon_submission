import { describe, expect, it } from "vitest";
import {
  assertEnv,
  checkFormat,
  formatReport,
  redact,
  resolveEnvironment,
  validateEnv,
} from "../src/index.js";
import { ENV_CATALOG, specFor } from "../src/catalog.js";

const dsn = "postgres://user:secret@host:5432/db?sslmode=require";

describe("resolveEnvironment", () => {
  it("defaults to local, the only safe default", () => {
    expect(resolveEnvironment({})).toBe("local");
  });

  it("reads a valid EMS_ENV", () => {
    expect(resolveEnvironment({ EMS_ENV: "production" })).toBe("production");
  });

  it("falls back to local for an unknown value", () => {
    expect(resolveEnvironment({ EMS_ENV: "prod" })).toBe("local");
  });
});

describe("validateEnv", () => {
  it("accepts an empty source for local when everything has a default", () => {
    const report = validateEnv({ service: "shared", environment: "local", source: {} });
    expect(report.ok).toBe(true);
    expect(report.values.EMS_ENV).toBe("local");
  });

  it("reports a missing required variable with its description", () => {
    const report = validateEnv({ service: "timeseries", environment: "production", source: {} });
    const issue = report.issues.find((entry) => entry.name === "TIMESERIES_DATABASE_URL");
    expect(issue?.kind).toBe("missing");
    expect(issue?.message).toContain("required in production");
  });

  it("rejects a malformed DSN", () => {
    const report = validateEnv({
      service: "timeseries",
      environment: "staging",
      source: { TIMESERIES_DATABASE_URL: "mysql://host/db" },
    });
    expect(report.issues.find((entry) => entry.name === "TIMESERIES_DATABASE_URL")?.kind).toBe("invalid");
  });

  it("rejects an out-of-range enum", () => {
    const report = validateEnv({
      service: "execution",
      environment: "local",
      source: { EXECUTION_MODE: "broadcast" },
    });
    expect(report.issues.find((entry) => entry.name === "EXECUTION_MODE")?.message).toContain("dry, live");
  });

  it("never returns a secret in clear text", () => {
    const report = validateEnv({
      service: "timeseries",
      environment: "staging",
      source: { EMS_ENV: "staging", TIMESERIES_DATABASE_URL: dsn },
    });
    expect(report.values.TIMESERIES_DATABASE_URL).not.toContain("secret");
    expect(report.values.TIMESERIES_DATABASE_URL).toContain("…");
  });

  it("flags a key that is not in the catalog when asked", () => {
    const report = validateEnv({
      service: "shared",
      environment: "local",
      source: { EMS_ENV: "local", TYPO_KEY: "x" },
      reportUnknown: true,
    });
    expect(report.issues.find((entry) => entry.name === "TYPO_KEY")?.kind).toBe("unknown");
  });

  it("does not flag a variable that belongs to another service", () => {
    const report = validateEnv({
      service: "shared",
      environment: "local",
      source: { EMS_ENV: "local", GATEWAY_API_KEY: "x" },
      reportUnknown: true,
    });
    expect(report.issues).toHaveLength(0);
  });
});

describe("assertEnv", () => {
  it("throws one message listing every problem", () => {
    expect(() => assertEnv({ service: "timeseries", environment: "production", source: {} })).toThrowError(
      /TIMESERIES_DATABASE_URL/,
    );
  });

  it("returns values when the environment is valid", () => {
    const values = assertEnv({
      service: "timeseries",
      environment: "staging",
      source: { EMS_ENV: "staging", TIMESERIES_DATABASE_URL: dsn },
    });
    expect(values.TIMESERIES_DB_MAX_CONNECTIONS).toBe("5");
  });
});

describe("checkFormat", () => {
  it("validates ports, flags and JSON", () => {
    const port = specFor("PORT");
    const flag = specFor("APPROVAL_REQUIRED_BY_DEFAULT");
    const json = specFor("GOOGLE_SERVICE_ACCOUNT_KEY");
    expect(port && checkFormat(port, "70000")).toContain("port");
    expect(flag && checkFormat(flag, "yes")).toContain("true");
    expect(json && checkFormat(json, "{not json")).toContain("JSON");
  });
});

describe("redact", () => {
  it("masks short values entirely", () => {
    expect(redact("short")).toBe("***");
  });

  it("keeps a recognisable shape for long values", () => {
    expect(redact("abcdefghijklmnop")).toBe("abcd…op");
  });

  it("marks exactly the secret variables", () => {
    const secrets = ENV_CATALOG.filter((spec) => spec.secret).map((spec) => spec.name);
    expect(secrets).toContain("TIMESERIES_DATABASE_URL");
    expect(secrets).not.toContain("PORT");
  });
});

describe("formatReport", () => {
  it("names the service and environment", () => {
    const report = validateEnv({ service: "timeseries", environment: "production", source: {} });
    expect(formatReport(report)).toContain("Invalid timeseries environment (production)");
  });
});
