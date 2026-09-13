#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { varsForService } from "./catalog.js";
import { renderExample } from "./example.js";
import { buildManifest } from "./manifest.js";
import { formatReport, resolveEnvironment, validateEnv, type EnvSource } from "./load.js";
import { ENVIRONMENTS, SERVICES, type Environment, type Service } from "./types.js";

const USAGE = `ems-env — validate and document the Agentic EMS environment

  ems-env check   --env <local|staging|production> [--service <name>] [--file .env] [--strict]
  ems-env example [--env <local|staging|production>] [--service <name>]
  ems-env manifest
  ems-env list

Exit codes: 0 ok · 1 validation failed · 2 usage error`;

interface ParsedArgs {
  readonly command: string;
  readonly flags: ReadonlyMap<string, string>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const command = argv[0] ?? "help";
  const flags = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith("--")) continue;
    const value = argv[index + 1];
    if (value !== undefined && !value.startsWith("--")) {
      flags.set(token.slice(2), value);
      index += 1;
    } else {
      flags.set(token.slice(2), "true");
    }
  }
  return { command, flags };
}

function asService(value: string | undefined): Service | undefined {
  return SERVICES.find((service) => service === value);
}

function asEnvironment(value: string | undefined): Environment | undefined {
  return ENVIRONMENTS.find((environment) => environment === value);
}

/** Minimal `.env` reader: `KEY=VALUE`, `#` comments, optional surrounding quotes. */
function readEnvFile(path: string): EnvSource {
  const source: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const raw = trimmed.slice(separator + 1).trim();
    source[key] = raw.replace(/^["']|["']$/g, "");
  }
  return source;
}

function run(argv: readonly string[]): number {
  const { command, flags } = parseArgs(argv);

  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  if (command === "manifest") {
    process.stdout.write(`${JSON.stringify(buildManifest(), null, 2)}\n`);
    return 0;
  }

  if (command === "example") {
    const environment = asEnvironment(flags.get("env")) ?? "local";
    const service = asService(flags.get("service"));
    process.stdout.write(
      service === undefined ? renderExample({ environment }) : renderExample({ environment, service }),
    );
    return 0;
  }

  if (command === "list") {
    for (const service of SERVICES) {
      const specs = varsForService(service);
      process.stdout.write(`${service.padEnd(16)} ${specs.length} variables\n`);
    }
    return 0;
  }

  if (command === "check") {
    const file = flags.get("file");
    const fileSource = file === undefined ? {} : readEnvFile(file);
    const source: EnvSource = { ...process.env, ...fileSource };
    const environment = asEnvironment(flags.get("env")) ?? resolveEnvironment(source);
    const requested = asService(flags.get("service"));
    const services: readonly Service[] = requested === undefined ? SERVICES : [requested];
    let failed = false;
    for (const service of services) {
      const report = validateEnv({
        service,
        environment,
        source,
        reportUnknown: file !== undefined && flags.get("strict") === "true",
      });
      const required = report.issues.filter((issue) => issue.kind !== "unknown").length;
      if (!report.ok && required > 0) {
        process.stderr.write(`${formatReport(report)}\n`);
        failed = true;
      } else {
        process.stdout.write(`ok  ${service} (${environment}) — ${Object.keys(report.values).length} resolved\n`);
      }
    }
    return failed ? 1 : 0;
  }

  process.stderr.write(`${USAGE}\n`);
  return 2;
}

process.exitCode = run(process.argv.slice(2));
