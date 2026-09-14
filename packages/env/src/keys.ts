import { requiredFor, varsForService } from "./catalog.js";
import { ENVIRONMENTS, type Service } from "./types.js";

/**
 * The catalog owns the names.
 *
 * A service's schema is a statement about *types* — a port is a number, a flag is a boolean — and it
 * should not also be a second, private list of what the variables are called. Those two things drift,
 * and the drift is invisible: the schema keeps compiling while the catalog documents a name nobody
 * provides. This is the seam that makes the catalog authoritative at runtime instead of only in a
 * test, so a schema key that the catalog does not know fails at boot, in the service that added it,
 * with the name it used.
 */
export function catalogKeysFor(service: Service): readonly string[] {
  return varsForService(service).map((spec) => spec.name);
}

export interface CatalogKeyReport {
  /** Schema keys the catalog does not know about — the drift this exists to catch. */
  readonly unknown: readonly string[];
  /** Catalog variables that are required somewhere but absent from the schema. */
  readonly gaps: readonly string[];
}

/** Compare a service's schema keys against the catalog, without throwing. */
export function checkCatalogKeys(service: Service, keys: readonly string[]): CatalogKeyReport {
  const declared = new Set(catalogKeysFor(service));
  const provided = new Set(keys);
  const requiredAnywhere = new Set(
    ENVIRONMENTS.flatMap((environment) => requiredFor(service, environment).map((spec) => spec.name)),
  );
  return {
    unknown: keys.filter((key) => !declared.has(key)),
    gaps: [...requiredAnywhere].filter((name) => !provided.has(name)).sort(),
  };
}

/**
 * Fail at boot when a service schema declares a variable the catalog does not know.
 *
 * Only `unknown` throws. A `gaps` entry is reported by {@link checkCatalogKeys} rather than thrown,
 * because a catalog may legitimately describe a requirement that is not yet consumed — and turning
 * that into a boot failure would make the honest state of an unfinished feature undeployable.
 */
export function assertCatalogKeys(service: Service, keys: readonly string[]): void {
  const { unknown } = checkCatalogKeys(service, keys);
  if (unknown.length === 0) return;
  throw new Error(
    `Uncatalogued ${service} environment variables: ${unknown.join(", ")}. ` +
      `Add them to ENV_CATALOG in @ethonline2026/env — the catalog is the single description of every variable.`,
  );
}
