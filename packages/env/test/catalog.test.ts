import { describe, expect, it } from "vitest";
import { ENV_CATALOG, requiredFor, specFor, varsForService } from "../src/index.js";
import { ENVIRONMENTS, SERVICES } from "../src/types.js";

describe("ENV_CATALOG", () => {
  it("has no duplicate names", () => {
    const names = ENV_CATALOG.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every variable at least one service", () => {
    for (const spec of ENV_CATALOG) {
      expect(spec.services.length, spec.name).toBeGreaterThan(0);
    }
  });

  it("only ever marks a variable required in a known environment", () => {
    for (const spec of ENV_CATALOG) {
      for (const environment of spec.requiredIn) {
        expect(ENVIRONMENTS).toContain(environment);
      }
    }
  });

  it("requires EMS_ENV to be explicit outside local", () => {
    expect(specFor("EMS_ENV")?.requiredIn).toEqual(["staging", "production"]);
    expect(specFor("EMS_ENV")?.default).toBe("local");
  });

  it("requires the browser credentials a deployment cannot function without", () => {
    // Both are public identifiers that ship in the client bundle. Absent, the app does not fail to
    // build — it renders "not configured" at the point a user tries to sign in, which is why an
    // undeclared one sat unnoticed on a live preview. Requiring them moves that to `env check`,
    // which runs before the deploy rather than after it.
    for (const name of ["NEXT_PUBLIC_PRIVY_APP_ID", "NEXT_PUBLIC_REOWN_PROJECT_ID"]) {
      expect(specFor(name)?.requiredIn, name).toEqual(["staging", "production"]);
      expect(specFor(name)?.secret, name).toBe(false);
    }
  });

  it("requires a database DSN and Redis in production for the services that use them", () => {
    expect(requiredFor("timeseries", "production").map((spec) => spec.name)).toContain(
      "TIMESERIES_DATABASE_URL",
    );
    expect(requiredFor("execution", "production").map((spec) => spec.name)).toContain("REDIS_URL");
  });

  it("does not require cloud credentials locally", () => {
    const local = SERVICES.flatMap((service) => requiredFor(service, "local")).map((spec) => spec.name);
    expect(local).toEqual([]);
  });

  it("gives every service a non-empty variable set", () => {
    for (const service of SERVICES) {
      expect(varsForService(service).length, service).toBeGreaterThan(0);
    }
  });
});
