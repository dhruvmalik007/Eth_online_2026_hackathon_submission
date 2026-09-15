import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnvLines, ROUTES, scriptsDir } from "../scripts/server.js";

describe("ROUTES", () => {
  it("covers every api route file, so a new route cannot be silently unreachable", () => {
    const apiDir = join(scriptsDir(), "..", "api");
    const routes = new Set(Object.keys(ROUTES));
    for (const file of readdirSync(apiDir).filter((name) => name.endsWith(".ts") && !name.startsWith("_"))) {
      expect(routes.has(`/api/${file.replace(/\.ts$/, "")}`), `no route for api/${file}`).toBe(true);
    }
    for (const file of readdirSync(join(apiDir, "risk")).filter((name) => name.endsWith(".ts"))) {
      expect(routes.has(`/api/risk/${file.replace(/\.ts$/, "")}`), `no route for api/risk/${file}`).toBe(true);
    }
  });

  it("maps to relative paths, because the server resolves them from the script directory", () => {
    for (const target of Object.values(ROUTES)) {
      expect(target.startsWith("../api/")).toBe(true);
    }
  });
});

describe("parseEnvLines", () => {
  it("parses KEY=VALUE, ignoring comments and blanks", () => {
    expect(parseEnvLines("# a comment\n\nA=1\nB=two\n")).toEqual({ A: "1", B: "two" });
  });

  it("strips surrounding quotes and keeps inner '='", () => {
    expect(parseEnvLines('DSN="postgres://u:p@h/db?sslmode=require"\n')).toEqual({
      DSN: "postgres://u:p@h/db?sslmode=require",
    });
  });

  it("ignores a line with no separator", () => {
    expect(parseEnvLines("NOT_AN_ASSIGNMENT\n")).toEqual({});
  });
});
