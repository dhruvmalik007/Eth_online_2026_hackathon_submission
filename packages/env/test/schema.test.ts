import { describe, expect, it } from "vitest";
import { ENV_CATALOG, createClientEnv, createEnv, exposureOf, specFor, zodSchemaFor } from "../src/index.js";

describe("zodSchemaFor", () => {
  it("applies catalog defaults for local", () => {
    expect(zodSchemaFor("shared", "local").parse({})).toEqual({ EMS_ENV: "local", LOG_LEVEL: "info" });
  });

  it("rejects a required variable that was not stated", () => {
    const result = zodSchemaFor("timeseries", "production").safeParse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
      "TIMESERIES_DATABASE_URL",
    );
  });

  it("rejects a malformed value with the catalog's own wording", () => {
    const result = zodSchemaFor("timeseries", "staging").safeParse({
      TIMESERIES_DATABASE_URL: "mysql://host/db",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain("postgres://");
  });

  it("keeps only the requested side of the client/server boundary", () => {
    const parsed = zodSchemaFor("agentic-ems", "local", { exposure: "client" }).parse({
      NEXT_PUBLIC_INDEXER_URL: "https://indexer.example",
      REACTOR_API_KEY: "should-not-cross",
    });
    expect(parsed).toEqual({ NEXT_PUBLIC_INDEXER_URL: "https://indexer.example" });
  });

  it("rejects an unknown key when strict", () => {
    const result = zodSchemaFor("shared", "local", { strict: true }).safeParse({ EMS_ENV: "local", NOPE: "x" });
    expect(result.success).toBe(false);
  });
});

describe("createEnv", () => {
  it("returns the validated configuration with defaults applied", () => {
    const env = createEnv({ service: "execution", source: { EMS_ENV: "local" } });
    expect(env.EXECUTION_MODE).toBe("dry");
    expect(env.APPROVAL_REQUIRED_BY_DEFAULT).toBe("true");
  });

  it("throws one message naming every problem", () => {
    expect(() => createEnv({ service: "timeseries", environment: "production", source: {} })).toThrowError(
      /TIMESERIES_DATABASE_URL/,
    );
  });

  it("reads EMS_ENV when no environment is given", () => {
    expect(() => createEnv({ service: "timeseries", source: { EMS_ENV: "production" } })).toThrowError(
      /production/,
    );
  });
});

describe("client/server split", () => {
  it("classifies a variable by its framework prefix", () => {
    const client = specFor("NEXT_PUBLIC_INDEXER_URL");
    const server = specFor("PORT");
    expect(client && exposureOf(client)).toBe("client");
    expect(server && exposureOf(server)).toBe("server");
  });

  it("never marks a client-exposed variable secret", () => {
    const leaked = ENV_CATALOG.filter((spec) => exposureOf(spec) === "client" && spec.secret);
    expect(leaked.map((spec) => spec.name)).toEqual([]);
  });

  it("createClientEnv returns only the client half", () => {
    const env = createClientEnv({
      service: "agentic-ems",
      source: { EMS_ENV: "local", NEXT_PUBLIC_PRIVY_APP_ID: "app-id", REACTOR_API_KEY: "secret" },
    });
    expect(env.NEXT_PUBLIC_PRIVY_APP_ID).toBe("app-id");
    expect(env.REACTOR_API_KEY).toBeUndefined();
  });
});
