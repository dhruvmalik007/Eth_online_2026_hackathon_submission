import { requiredFor, specFor, varsForService } from "./catalog.js";
import { redact, redactRecord } from "./redact.js";
import { ENVIRONMENTS, type Environment, type EnvVarSpec, type Service } from "./types.js";

/** Anything that can supply environment values: `process.env` or a parsed `.env` file. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface EnvIssue {
  readonly name: string;
  readonly kind: "missing" | "invalid" | "unknown";
  readonly message: string;
}

export interface EnvReport {
  readonly service: Service;
  readonly environment: Environment;
  readonly ok: boolean;
  readonly issues: readonly EnvIssue[];
  /** Resolved values for the service, secrets redacted. */
  readonly values: Readonly<Record<string, string>>;
}

/** Read `EMS_ENV`, defaulting to `local` — the only safe default. */
export function resolveEnvironment(source: EnvSource = process.env): Environment {
  const raw = source.EMS_ENV;
  const found = ENVIRONMENTS.find((environment) => environment === raw);
  return found ?? "local";
}

/** A non-empty string, or `undefined` for absent/empty. */
function present(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

/** `null` when the value satisfies the spec's format, else a human explanation. */
export function checkFormat(spec: EnvVarSpec, value: string): string | null {
  switch (spec.format) {
    case "url":
      return /^https?:\/\/\S+$/.test(value) ? null : "must be an http(s) URL";
    case "dsn":
      return /^postgres(ql)?:\/\/\S+$/.test(value) ? null : "must be a postgres:// connection string";
    case "port": {
      const port = Number(value);
      return Number.isInteger(port) && port >= 1 && port <= 65535 ? null : "must be a port (1–65535)";
    }
    case "flag":
      return value === "true" || value === "false" || value === "1" || value === "0"
        ? null
        : "must be one of true, false, 1, 0";
    case "number":
      return Number.isFinite(Number(value)) ? null : "must be a number";
    case "csv":
      return value.split(",").some((part) => part.trim().length > 0) ? null : "must be a non-empty list";
    case "enum":
      return (spec.allowed ?? []).includes(value)
        ? null
        : `must be one of ${(spec.allowed ?? []).join(", ")}`;
    case "json":
      try {
        JSON.parse(value);
        return null;
      } catch {
        return "must be valid JSON";
      }
    case "path":
    case "string":
      return value.trim().length > 0 ? null : "must not be empty";
  }
}

export interface ValidateOptions {
  readonly service: Service;
  readonly environment: Environment;
  readonly source: EnvSource;
  /** Report keys that belong to *other* services (used when checking a `.env` file). */
  readonly reportUnknown?: boolean;
}

/**
 * Validate one service's configuration for one environment.
 *
 * Returns every problem at once rather than the first, so a deployment is fixed in a single pass.
 */
export function validateEnv(options: ValidateOptions): EnvReport {
  const { service, environment, source } = options;
  const issues: EnvIssue[] = [];
  const values: Record<string, string> = {};

  for (const spec of varsForService(service)) {
    const value = present(source[spec.name]);
    if (value === undefined) {
      if (spec.requiredIn.includes(environment)) {
        issues.push({
          name: spec.name,
          kind: "missing",
          message: `required in ${environment}: ${spec.description}`,
        });
      }
      if (spec.default !== undefined) values[spec.name] = spec.default;
      continue;
    }
    const problem = checkFormat(spec, value);
    if (problem !== null) {
      issues.push({ name: spec.name, kind: "invalid", message: problem });
      continue;
    }
    values[spec.name] = value;
  }

  if (options.reportUnknown === true) {
    const known = new Set(varsForService(service).map((spec) => spec.name));
    for (const name of Object.keys(source)) {
      if (known.has(name)) continue;
      if (specFor(name) !== undefined) continue; // belongs to another service
      if (/^[A-Z][A-Z0-9_]*$/.test(name)) {
        issues.push({ name, kind: "unknown", message: "not in the environment catalog" });
      }
    }
  }

  return {
    service,
    environment,
    ok: issues.length === 0,
    issues,
    values: redactRecord(values),
  };
}

/** One line per issue, suitable for a thrown error or a CI annotation. */
export function formatReport(report: EnvReport): string {
  const header = `Invalid ${report.service} environment (${report.environment})`;
  const lines = report.issues.map((issue) => {
    const spec = specFor(issue.name);
    const shown = issue.kind === "invalid" ? " [value rejected]" : "";
    return `  - ${issue.name}: ${issue.message}${shown}${spec?.secret === true ? " (secret)" : ""}`;
  });
  return [header, ...lines].join("\n");
}

/**
 * Validate and return the resolved values, throwing on any problem.
 *
 * `values` holds defaults for absent optional variables and redacted secrets, so it is safe to log —
 * use {@link rawEnv} when the actual secret value is needed (e.g. to open a connection).
 */
export function assertEnv(options: ValidateOptions): Readonly<Record<string, string>> {
  const report = validateEnv(options);
  if (!report.ok) throw new Error(formatReport(report));
  return report.values;
}

/** The unredacted values, for the caller that actually needs to open a connection. */
export function rawEnv(service: Service, source: EnvSource): Record<string, string> {
  const output: Record<string, string> = {};
  for (const spec of varsForService(service)) {
    const value = present(source[spec.name]);
    if (value !== undefined) output[spec.name] = value;
    else if (spec.default !== undefined) output[spec.name] = spec.default;
  }
  return output;
}

export { redact, requiredFor };
