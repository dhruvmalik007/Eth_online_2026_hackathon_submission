import { createEnv, type EnvSource } from "@ethonline2026/env";

/**
 * Arc's configuration, resolved through the shared catalog.
 *
 * This module exists so the rest of the package reads configuration the same way every other
 * service does. Before it, nine `process.env` lookups were scattered across `chains.ts` and
 * `erc8183/hook.ts`, each with its own inline default — so a value renamed in the deployment had to
 * be found in two files, and nothing said which names the package actually required.
 *
 * The error messages stay specific on purpose. A blank RPC URL is not a server error here, it is a
 * misconfiguration, and the useful response names the variable and shows an example rather than
 * failing later inside a client constructor with no indication of which value was wrong.
 */
export function arcEnv(source: EnvSource = process.env): Readonly<Record<string, string | undefined>> {
  return createEnv({ service: "arc", source });
}

/** A numeric variable, with the caller's documented fallback. */
export function envNumber(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${key} must be a number, got "${raw}".`);
  return parsed;
}

/** A string variable, treating empty as absent — an empty env var is a missing one. */
export function envString(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback = "",
): string {
  const raw = env[key];
  return raw === undefined || raw.trim().length === 0 ? fallback : raw;
}
