import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A client-exposed variable must be read as a *literal* `process.env.NEXT_PUBLIC_X` member access.
 *
 * Next inlines a statically-referenced public variable into the client bundle. Reading it through the
 * catalog — `clientEnv.NEXT_PUBLIC_X` — is a dynamic lookup, invisible to that analysis, so the browser
 * receives `undefined` and a correctly configured deployment reports itself as unconfigured.
 *
 * This is not hypothetical. `executionBaseUrl` carried this bug once; routing the indexer, Privy and
 * wallet reads through the catalog reintroduced it in four more places. Every build stayed green,
 * because nothing at build time can see a value that resolves to undefined at runtime.
 */
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN = ["app", "components", "lib"];
const SKIP = ["lib/env.ts", "lib/envRules.test.ts"];
const NEEDLE = ["clientEnv", "NEXT_PUBLIC_"].join(".");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("client environment", () => {
  it("reads public variables literally, so Next can inline them", () => {
    const offenders = SCAN.flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .filter((file) => !SKIP.some((skip) => file.endsWith(skip)))
      .filter((file) => readFileSync(file, "utf8").includes(NEEDLE))
      .map((file) => relative(ROOT, file));

    expect(offenders).toEqual([]);
  });
});
