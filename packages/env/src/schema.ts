import { z } from "zod";
import { varsForService } from "./catalog.js";
import { checkFormat, resolveEnvironment, type EnvSource } from "./load.js";
import type { Environment, EnvVarSpec, Service } from "./types.js";

/**
 * Zod schemas, derived from the catalog.
 *
 * The architecture follows `@t3-oss/env-core` deliberately — a `createEnv` that returns a validated,
 * typed object, and a hard client/server split — but the field list comes from the catalog rather
 * than from a hand-written schema per app. That distinction is the whole point: t3-env has no
 * catalog, so the names, the secret flags and the per-environment requirements would live only in
 * each app's source, and the documentation, the CI manifest and the platform sync would have no
 * single origin to read from. Here zod is the engine; the catalog is the specification.
 *
 * Two rules taken from t3-env unchanged, because both are correct:
 *
 *   1. A client-exposed variable is identified by its framework prefix (`NEXT_PUBLIC_`), not by a
 *      hand-maintained list. A variable is client-visible exactly when its name says so.
 *   2. Nothing marked secret may carry a client prefix — a secret is server-only by definition, and
 *      allowing the combination is how a key ends up in a browser bundle.
 */
export const CLIENT_PREFIX = "NEXT_PUBLIC_";

/** Which side of the boundary a variable is allowed to cross. */
export function exposureOf(spec: EnvVarSpec): "client" | "server" {
  return spec.name.startsWith(CLIENT_PREFIX) ? "client" : "server";
}

/**
 * One field.
 *
 * A required variable is written with no default: `requiredIn` means the deployment must *state* it,
 * so a default satisfying the requirement would defeat the check. Format failures reuse the catalog's
 * `checkFormat`, so the CLI report and the zod error cannot disagree about what "valid" means.
 */
function fieldFor(spec: EnvVarSpec, environment: Environment): z.ZodTypeAny {
  const required = spec.requiredIn.includes(environment);
  const base = z.string().superRefine((value, ctx) => {
    const problem = checkFormat(spec, value);
    if (problem !== null) ctx.addIssue({ code: "custom", message: `${spec.name}: ${problem}` });
  });
  if (required) return base;
  return spec.default === undefined ? base.optional() : base.default(spec.default);
}

export interface SchemaOptions {
  /** Restrict to the client- or server-visible half of the service's variables. */
  readonly exposure?: "client" | "server";
  /**
   * Reject unknown keys. Only meaningful for a `.env` file; `process.env` always carries the whole
   * machine's environment, so strict mode against it would reject everything.
   */
  readonly strict?: boolean;
}

/** A zod object for one service in one environment, derived from the catalog. */
export function zodSchemaFor(
  service: Service,
  environment: Environment,
  options: SchemaOptions = {},
) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const spec of varsForService(service)) {
    if (options.exposure !== undefined && exposureOf(spec) !== options.exposure) continue;
    shape[spec.name] = fieldFor(spec, environment);
  }
  const object = z.object(shape);
  return options.strict === true ? object.strict() : object;
}

export interface CreateEnvOptions {
  readonly service: Service;
  /** Defaults to `EMS_ENV`, which defaults to `local`. */
  readonly environment?: Environment;
  /** Defaults to `process.env`. */
  readonly source?: EnvSource;
  readonly exposure?: "client" | "server";
  readonly strict?: boolean;
}

/**
 * Validate and return one service's configuration.
 *
 * This is the call a service makes at boot — "give me the variables I need, validated" — and it is
 * what makes injection mechanical: the catalog says which names to provide, and this says whether
 * what arrived is usable. It throws with every problem at once, so a deployment is fixed in one pass.
 */
export function createEnv(
  options: CreateEnvOptions,
): Readonly<Record<string, string | undefined>> {
  const source = options.source ?? process.env;
  const environment = options.environment ?? resolveEnvironment(source);
  const schema = zodSchemaFor(options.service, environment, {
    ...(options.exposure === undefined ? {} : { exposure: options.exposure }),
    ...(options.strict === undefined ? {} : { strict: options.strict }),
  });
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(
      `Invalid ${options.service} environment (${environment}):\n  - ${issues.join("\n  - ")}`,
    );
  }
  return parsed.data as Record<string, string | undefined>;
}

/**
 * The client-side configuration for a framework app.
 *
 * Filtered to prefixed variables *and* asserted: if a client key were ever marked secret in the
 * catalog this throws rather than shipping it, because the failure it prevents is a credential in a
 * browser bundle, which is not something a code review reliably catches.
 */
export function createClientEnv(
  options: Omit<CreateEnvOptions, "exposure" | "strict">,
): Readonly<Record<string, string | undefined>> {
  const source = options.source ?? process.env;
  const environment = options.environment ?? resolveEnvironment(source);
  const leaked = varsForService(options.service).filter(
    (spec) => exposureOf(spec) === "client" && spec.secret,
  );
  if (leaked.length > 0) {
    throw new Error(
      `Client-exposed variables must not be secrets: ${leaked.map((spec) => spec.name).join(", ")}`,
    );
  }
  return createEnv({ ...options, environment, source, exposure: "client" });
}
