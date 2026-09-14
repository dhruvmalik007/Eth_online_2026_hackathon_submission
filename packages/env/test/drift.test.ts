import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ENV_CATALOG, EXTERNAL_ENV_ALLOWLIST } from "../src/catalog.js";

/**
 * The drift guard.
 *
 * A catalog nobody checks is documentation, and documentation drifts. This reads the workspace the
 * way a reviewer would — every environment read and every schema key in every source file — and
 * fails when a name is neither in the catalog nor on the explicit external allowlist. It is what
 * stops the same value being introduced twice under two names, which is the failure the catalog
 * exists to prevent.
 *
 * Two sources on purpose: most configuration is declared as a key in a service schema rather than
 * read directly, so scanning only direct reads would miss exactly the declarations that matter.
 */
const REPO_ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..");

const SKIP_DIRECTORIES = new Set([
  "node_modules", "dist", ".turbo", ".next", ".git", ".agents", ".vercel", ".commandcode",
  "data", "evidence", "coverage", "__pycache__", ".venv", "out", "cache", "lib", "public",
]);

const SOURCE_FILE = /\.(ts|tsx|mjs|js)$/;
/** A file that declares a service's environment schema. */
const SCHEMA_FILE = /(?:^|\/)(?:config\/)?env\.ts$/;

// Assembled at runtime so this file does not match itself — a naive literal here would report the
// uppercase words from its own examples and fail the very check it implements.
const PREFIX = ["proc", "ess", "env"].join("") + ".";
const DOTTED = new RegExp(`${PREFIX}([A-Z][A-Z0-9_]*)`, "g");
const BRACKETED = new RegExp(`${PREFIX}\\["([A-Z][A-Z0-9_]*)"\\]`, "g");

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (SOURCE_FILE.test(entry.name)) found.push(path);
  }
  return found;
}

/** Uppercase keys in a schema file: each one is a variable a deployment must provide. */
function schemaKeysIn(text: string): readonly string[] {
  return [...text.matchAll(/^\s*([A-Z][A-Z0-9_]{2,})\s*:/gm)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

function namesIn(file: string): readonly string[] {
  const text = readFileSync(file, "utf8");
  const direct = [...text.matchAll(DOTTED), ...text.matchAll(BRACKETED)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
  return SCHEMA_FILE.test(file) ? [...direct, ...schemaKeysIn(text)] : direct;
}

describe("environment catalog drift", () => {
  const files = sourceFiles(REPO_ROOT);
  const declared = new Set(ENV_CATALOG.map((spec) => spec.name));
  const external = new Set(EXTERNAL_ENV_ALLOWLIST);
  const found = files.flatMap((file) => namesIn(file));

  it("scans a plausible number of files", () => {
    // Guards against the walker silently finding nothing, which would make every check below pass.
    expect(files.length).toBeGreaterThan(100);
  });

  it("actually matches configuration names", () => {
    // Guards against a broken pattern: if the extractor stopped matching, the drift check would pass
    // vacuously and this whole file would be decorative.
    expect(new Set(found).size).toBeGreaterThan(30);
    expect(found).toContain("TIMESERIES_DATABASE_URL");
  });

  it("declares every name the workspace uses", () => {
    const undeclared = new Map<string, Set<string>>();
    for (const file of files) {
      for (const name of namesIn(file)) {
        if (declared.has(name) || external.has(name)) continue;
        if (!undeclared.has(name)) undeclared.set(name, new Set());
        undeclared.get(name)?.add(relative(REPO_ROOT, dirname(file)));
      }
    }
    const report = [...undeclared.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, dirs]) => `  ${name}  (${[...dirs].slice(0, 3).join(", ")})`)
      .join("\n");
    expect(report, `Add these to ENV_CATALOG (or EXTERNAL_ENV_ALLOWLIST):\n${report}`).toBe("");
  });

  it("has no duplicate catalog names", () => {
    const names = ENV_CATALOG.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("does not allowlist a variable the catalog already declares", () => {
    expect(EXTERNAL_ENV_ALLOWLIST.filter((name) => declared.has(name))).toEqual([]);
  });
});
