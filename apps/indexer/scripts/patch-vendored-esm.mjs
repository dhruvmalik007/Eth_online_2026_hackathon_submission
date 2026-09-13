/**
 * Repair vendored ESM inside a dependency's bundle.
 *
 * `@langchain/langgraph-sdk` publishes a `dist/node_modules` store alongside its own code. Inside
 * it, each package directory holds only `index.js` / `index.cjs` — the `package.json` files are
 * **missing entirely**. Node decides a `.js` file's module system from the nearest `package.json`,
 * so with none present it assumes CommonJS and the first `import` throws:
 *
 *   SyntaxError: Cannot use import statement outside a module
 *
 * That kills the function at load, before any handler runs, which is why every route returned 500.
 *
 * This writes the missing declaration. Three deliberate limits:
 *
 *   - **Only where a `package.json` is absent.** An existing one is never read, never rewritten,
 *     and never overwritten, so a real CommonJS dependency cannot be mislabelled as ESM.
 *   - **Only when the file is actually ESM.** `index.cjs` is left alone; the check is the leading
 *     `import`, not the directory name.
 *   - **Idempotent.** Re-running finds the written files and does nothing, so it is safe both as a
 *     build step and locally.
 *
 * The alternative — pinning a different SDK version — would risk the agent stack, which is working
 * and which the vendored layout is otherwise fine for. This changes one missing file, nothing else.
 */
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.argv[2] ?? join(import.meta.dirname, "..", "..", "..");

/** `<store>/<pkg>/node_modules/<pkg>/dist/node_modules/.pnpm/<dep>/node_modules/<dep>/` */
async function findVendoredPackages(storeDir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(storeDir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    // <store>/@langchain+langgraph-sdk@1.10.2_.../node_modules/@langchain/langgraph-sdk/dist/...
    const pkgRoot = join(storeDir, entry.name, "node_modules");
    let scopes;
    try {
      scopes = await readdir(pkgRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const scope of scopes) {
      const bases = scope.name.startsWith("@")
        ? (await readdir(join(pkgRoot, scope.name), { withFileTypes: true }).catch(() => [])).map(
            (e) => join(scope.name, e.name),
          )
        : [scope.name];
      for (const base of bases) {
        const vendoredStore = join(pkgRoot, base, "dist", "node_modules", ".pnpm");
        let deps;
        try {
          deps = await readdir(vendoredStore, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const dep of deps) {
          const depScope = join(vendoredStore, dep.name, "node_modules");
          const depEntries = await readdir(depScope, { withFileTypes: true }).catch(() => []);
          for (const depEntry of depEntries) {
            const candidates = depEntry.name.startsWith("@")
              ? (await readdir(join(depScope, depEntry.name), { withFileTypes: true }).catch(() => [])).map(
                  (e) => join(depScope, depEntry.name, e.name),
                )
              : [join(depScope, depEntry.name)];
            for (const candidate of candidates) found.push(candidate);
          }
        }
      }
    }
  }
  return found;
}

/**
 * A package is ESM when any of its `.js` files carries a top-level `import` or `export`.
 *
 * Two earlier versions of this check were both too narrow, and each cost a deploy by letting the
 * failure move to the next package:
 *
 *   1. Looking only for `import` skipped `is-network-error`, a one-function module that only
 *      ever *exports*.
 *   2. Looking only at the package root skipped `p-queue`, whose ESM entry is `dist/index.js`.
 *
 * So the scan now covers the whole package. `.cjs` and `.map` files are excluded deliberately:
 * a package may legitimately ship both builds, and `.cjs` is CommonJS by definition — its
 * presence must not mask the ESM entry sitting beside it.
 */
const ESM_STATEMENT = /^(?:import\s|export\s+\{)/m;

async function findEsmSource(dir, depth = 0) {
  if (depth > 4) return false;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // `node_modules` here is the package's own vendored tree; the check is about this package.
      if (entry.name === "node_modules") continue;
      if (await findEsmSource(full, depth + 1)) return true;
      continue;
    }
    if (!entry.name.endsWith(".js") || entry.name.endsWith(".cjs")) continue;
    try {
      if (ESM_STATEMENT.test(await readFile(full, "utf8"))) return true;
    } catch {
      // An unreadable file is not evidence of ESM.
    }
  }
  return false;
}

async function main() {
  const store = join(ROOT, "node_modules", ".pnpm");
  const packages = await findVendoredPackages(store);

  let repaired = 0;
  let skipped = 0;

  for (const dir of packages) {
    const manifest = join(dir, "package.json");
    if (await stat(manifest).then(() => true, () => false)) {
      skipped += 1;
      continue;
    }
    if (!(await findEsmSource(dir))) {
      skipped += 1;
      continue;
    }
    await writeFile(manifest, `${JSON.stringify({ type: "module" }, null, 2)}\n`);
    repaired += 1;
    console.log(`[patch-vendored-esm] restored module declaration: ${dir.replace(ROOT + "/", "")}`);
  }

  console.log(
    `[patch-vendored-esm] ${repaired} repaired, ${skipped} left alone (${packages.length} vendored packages found)`,
  );
}

await main();
