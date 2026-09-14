import { ENV_CATALOG } from "./catalog.js";
import { ENVIRONMENTS, SERVICES, type Environment, type Service } from "./types.js";

export interface EnvManifestEntry {
  readonly name: string;
  readonly services: readonly Service[];
  readonly requiredIn: readonly Environment[];
  readonly secret: boolean;
  readonly format: string;
  readonly default?: string;
  readonly description: string;
}

export interface EnvManifest {
  readonly generatedBy: "@ethonline2026/env";
  readonly environments: readonly Environment[];
  readonly services: readonly Service[];
  readonly vars: readonly EnvManifestEntry[];
}

/**
 * The machine-readable contract CI reads.
 *
 * It is what lets a workflow assert "this deployment has every variable this service requires in this
 * environment" without importing the services themselves.
 */
export function buildManifest(): EnvManifest {
  return {
    generatedBy: "@ethonline2026/env",
    environments: ENVIRONMENTS,
    services: SERVICES,
    vars: ENV_CATALOG.map((spec) => ({
      name: spec.name,
      services: spec.services,
      requiredIn: spec.requiredIn,
      secret: spec.secret,
      format: spec.format,
      description: spec.description,
      ...(spec.default === undefined ? {} : { default: spec.default }),
    })),
  };
}
