import { createClientEnv, createEnv, type EnvSource } from "@ethonline2026/env";

/**
 * The demo app's configuration, split at the client/server boundary.
 *
 * Next inlines only `NEXT_PUBLIC_*` into the browser bundle; every other variable is `undefined`
 * there and stays `undefined` silently. So the split is not cosmetic — it is the difference between
 * a missing key failing where it is read and a key that was never shipped at all. Read from
 * `clientEnv` in components and `serverEnv()` in route handlers and server components, and the
 * catalog decides which side each variable is on by its prefix, rather than a list kept by hand.
 *
 * `createClientEnv` also refuses a `NEXT_PUBLIC_` name that the catalog marks secret, because that
 * combination ships a credential to the browser and nothing else would catch it.
 */
export const clientEnv = createClientEnv({ service: "agentic-ems" });

let cachedServerEnv: Readonly<Record<string, string | undefined>> | undefined;

/**
 * Server-only configuration: the Reactor key, the model credentials, the inference service token and
 * the Google service account. Throws if called in the browser, where these are not present — an
 * explicit error beats a request that fails later with an empty Authorization header.
 */
export function serverEnv(
  source?: EnvSource,
): Readonly<Record<string, string | undefined>> {
  if (typeof window !== "undefined") {
    throw new Error(
      "serverEnv() must not be called in the browser: server variables are not exposed to the client.",
    );
  }
  // Validate once. Route handlers call this per request, and re-parsing the schema on every call
  // would make configuration a per-request cost for a value that cannot change while the process runs.
  // An explicit source bypasses the cache, which is what tests need.
  if (source !== undefined) {
    return createEnv({ service: "agentic-ems", exposure: "server", source });
  }
  cachedServerEnv ??= createEnv({ service: "agentic-ems", exposure: "server" });
  return cachedServerEnv;
}
