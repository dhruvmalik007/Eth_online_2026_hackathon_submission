import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Loads a mandate template by id.
 *
 * The id arrives from a request, so it is validated against a strict pattern **before** it reaches the
 * filesystem. `join(dir, id)` with an unvalidated `../../etc/passwd` walks out of the directory, and the
 * check has to happen here rather than at the call site — a second caller will not remember.
 */

/** Lowercase, digits and inner hyphens only: no separators, no dots, nothing that can traverse. */
export const MANDATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class MandateNotFoundError extends Error {
  constructor(readonly mandateId: string, readonly dir: string) {
    super(`no mandate template \`${mandateId}\` in ${dir}`);
    this.name = "MandateNotFoundError";
  }
}

export class InvalidMandateIdError extends Error {
  constructor(readonly mandateId: string) {
    super(
      `\`${mandateId}\` is not a valid mandate id (expected lowercase letters, digits and hyphens)`,
    );
    this.name = "InvalidMandateIdError";
  }
}

/** Where the templates live, relative to the service root unless overridden. */
export function mandatesDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.MANDATES_DIR ?? new URL("../../mandates/", import.meta.url).pathname;
}

/**
 * Read and parse one template. Returns `unknown` on purpose: the caller validates with `MandateSchema`,
 * so an invalid template fails at the schema with a field path rather than as a JSON error here.
 */
export function loadMandate(mandateId: string, dir: string = mandatesDir()): unknown {
  if (!MANDATE_ID_PATTERN.test(mandateId)) throw new InvalidMandateIdError(mandateId);
  const path = join(dir, `${mandateId}.json`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new MandateNotFoundError(mandateId, dir);
    }
    throw error;
  }
}
