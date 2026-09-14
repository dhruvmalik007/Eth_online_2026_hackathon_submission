import { describe, expect, it } from "vitest";
import { assertCatalogKeys, catalogKeysFor, checkCatalogKeys } from "../src/index.js";

describe("catalogKeysFor", () => {
  it("returns the names a service is allowed to declare", () => {
    const keys = catalogKeysFor("execution");
    expect(keys).toContain("EXECUTION_MODE");
    expect(keys).toContain("LOG_LEVEL");
  });
});

describe("checkCatalogKeys", () => {
  it("reports a schema key the catalog does not know", () => {
    const report = checkCatalogKeys("execution", ["EXECUTION_MODE", "NOT_A_REAL_VARIABLE"]);
    expect(report.unknown).toEqual(["NOT_A_REAL_VARIABLE"]);
  });

  it("reports a required catalog variable the schema omits", () => {
    const report = checkCatalogKeys("timeseries", []);
    expect(report.gaps).toContain("TIMESERIES_DATABASE_URL");
  });

  it("is empty for a schema that matches the catalog exactly", () => {
    const report = checkCatalogKeys("execution", catalogKeysFor("execution"));
    expect(report.unknown).toEqual([]);
  });
});

describe("assertCatalogKeys", () => {
  it("throws with the offending name", () => {
    expect(() => assertCatalogKeys("execution", ["EXECUTION_MODE", "TYPO_MODE"])).toThrowError(/TYPO_MODE/);
  });

  it("passes when every key is catalogued", () => {
    expect(() => assertCatalogKeys("custody", catalogKeysFor("custody"))).not.toThrow();
  });
});
