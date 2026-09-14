import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ENV_CATALOG } from "../src/catalog.js";

/**
 * The default-drift guard.
 *
 * `packages/langchain`, `apps/inferrence` and the rest keep hand-written zod schemas for variables the
 * catalog also describes, and they import `assertCatalogKeys` to stay honest. But that comparison is
 * over *names*: it answers "does the catalog know this variable", never "does it agree about this
 * variable". So a default written in one place and a different default written in the other is
 * invisible — and that is not hypothetical. `VERTEX_AI_MODEL` was `gemini-2.5-pro` in the catalog and
 * `gemini-2.5-flash-lite` in langchain, so which model a service used depended on which path read the
 * variable. Two defaults for one variable is the failure the catalog exists to prevent.
 *
 * This reads the schemas the way drift.test.ts reads the workspace, and fails when the two disagree.
 * A file counts as a second schema when it imports `assertCatalogKeys` — the marker of a service that
 * has opted into catalog conformance.
 */
const REPO_ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..");

const SKIP_DIRECTORIES = new Set([
  "node_modules", "dist", ".turbo", ".next", ".git", ".agents", ".vercel", ".commandcode",
  "data", "evidence", "coverage", "__pycache__", ".venv", "out", "cache", "lib", "public",
  "test", "tests", "__tests__", "e2e", "scripts",
]);

const CONFORMANCE_MARKER = ["assert", "CatalogKeys"].join("");
const SCHEMA_MARKER = ["z", "object("].join(".");

/** `NAME: z.<assertions>.default(<literal>)` — the one shape a default is written in. */
const DEFAULTED = /^\s*([A-Z][A-Z0-9_]{2,})\s*:\s*z\.[^\n]*?\.default\(([^)]*)\),?\s*$/gm;

/**
 * Divergences that are known, and deliberately not reconciled here.
 *
 * Every one is a behaviour or cost knob whose correct value is a decision rather than a typo, so the
 * guard records it instead of forcing a change. Recording them is the point: they were invisible
 * before, and any *new* divergence now fails. A listed name that stops diverging also fails, so the
 * list cannot rot into a set of stale excuses.
 */
const KNOWN_DIVERGENCES: Readonly<Record<string, string>> = {
  INFERENCE_MODE:
    "the inference schema defaults to `dry` so an unconfigured instance never spends; the catalog documents `serve`",
  AGENT_IMPL:
    "the inference schema defaults to `mock`; the catalog documents the real agent",
  INFERENCE_MAX_CONCURRENT_RUNS:
    "catalog 2, inference schema 8 — a concurrency cap, so the difference is a cost decision",
  SANDBOX_MAX_PER_INSTANCE:
    "catalog 4, inference schema 8 — a sandbox cap, so the difference is a cost decision",
};

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

/** Every file that declares a schema and claims to conform to the catalog. */
function parallelSchemas(): readonly string[] {
  return ["apps", "packages"]
    .flatMap((root) => sourceFiles(join(REPO_ROOT, root)))
    .filter((file) => {
      if (file.startsWith(join(REPO_ROOT, "packages", "env"))) return false;
      const text = readFileSync(file, "utf8");
      return text.includes(CONFORMANCE_MARKER) && text.includes(SCHEMA_MARKER);
    });
}

/** `250_000` and `250000` are the same number; the catalog writes the second, source the first. */
function normalise(value: string): string {
  const bare = value.trim().replace(/^['"`]|['"`]$/g, "");
  return /^-?[\d_]+(\.\d+)?$/.test(bare) ? bare.replace(/_/g, "") : bare;
}

/** The defaults a schema file states, by variable name. */
function defaultsIn(file: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const match of readFileSync(file, "utf8").matchAll(DEFAULTED)) {
    const name = match[1];
    const raw = match[2];
    if (name === undefined || raw === undefined) continue;
    found.set(name, normalise(raw));
  }
  return found;
}

const schemas = parallelSchemas();
const catalogDefaults = new Map(
  ENV_CATALOG.flatMap((spec) => (spec.default === undefined ? [] : [[spec.name, normalise(spec.default)] as const])),
);

interface Divergence {
  readonly name: string;
  readonly catalog: string;
  readonly file: string;
  readonly value: string;
}

const divergences: readonly Divergence[] = schemas.flatMap((file) =>
  [...defaultsIn(file)].flatMap(([name, value]) => {
    const catalog = catalogDefaults.get(name);
    // No catalog default means nothing to disagree with — the schema is free to choose.
    if (catalog === undefined || catalog === value) return [];
    return [{ name, catalog, file: relative(REPO_ROOT, file), value }];
  }),
);

describe("parallel schema defaults", () => {
  it("finds the schemas that claim catalog conformance", () => {
    // Guards against the discovery silently finding nothing, which would make every check below pass
    // vacuously and leave this file decorative.
    expect(schemas.length).toBeGreaterThanOrEqual(2);
    const total = schemas.reduce((sum, file) => sum + defaultsIn(file).size, 0);
    expect(total).toBeGreaterThan(20);
  });

  it("agrees with the catalog, except where a divergence is recorded", () => {
    const unexplained = divergences
      .filter((d) => KNOWN_DIVERGENCES[d.name] === undefined)
      .map((d) => `  ${d.name}: catalog ${d.catalog}, ${d.file} ${d.value}`);
    expect(
      unexplained,
      `One variable, one default. Reconcile these, or record why they differ in KNOWN_DIVERGENCES:\n${unexplained.join("\n")}`,
    ).toEqual([]);
  });

  it("does not carry a stale divergence", () => {
    // A reason for a divergence that no longer exists is worse than no reason: it implies a problem
    // that has been fixed and hides the next real one behind it.
    const stale = Object.keys(KNOWN_DIVERGENCES).filter(
      (name) => !divergences.some((d) => d.name === name),
    );
    expect(stale, `These no longer diverge — remove them from KNOWN_DIVERGENCES: ${stale.join(", ")}`).toEqual([]);
  });

  it("pins VERTEX_AI_MODEL to one model wherever it is declared", () => {
    // The variable whose disagreement went unnoticed; named so a regression is unambiguous.
    const declaring = schemas.filter((file) => defaultsIn(file).has("VERTEX_AI_MODEL"));
    expect(declaring.length).toBeGreaterThanOrEqual(2);
    for (const file of declaring) {
      expect(defaultsIn(file).get("VERTEX_AI_MODEL"), relative(REPO_ROOT, file)).toBe(
        catalogDefaults.get("VERTEX_AI_MODEL"),
      );
    }
  });
});
