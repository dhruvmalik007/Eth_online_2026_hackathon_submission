import { varsForService } from "./catalog.js";
import { SERVICES, type Environment, type Service } from "./types.js";

export interface ExampleOptions {
  readonly service?: Service;
  readonly environment?: Environment;
}

/**
 * Render a `.env.example` from the catalog.
 *
 * Generated, not committed by hand: an example that is written by a human drifts from the catalog the
 * first time a variable is added, and a stale example is worse than none because it looks current.
 */
export function renderExample(options: ExampleOptions = {}): string {
  const environment = options.environment ?? "local";
  const services: readonly Service[] = options.service === undefined ? SERVICES : [options.service];
  const lines: string[] = [
    "# Generated from @ethonline2026/env — do not edit by hand.",
    `# Environment: ${environment}`,
    "# Secrets are left blank on purpose; fill them from your secret store.",
    "",
  ];

  for (const service of services) {
    const specs = varsForService(service);
    if (specs.length === 0) continue;
    lines.push(`# ${"=".repeat(2)} ${service} ${"=".repeat(Math.max(2, 60 - service.length))}`);
    for (const spec of specs) {
      const notes: string[] = [spec.requiredIn.includes(environment) ? `required in ${environment}` : "optional"];
      if (spec.secret) notes.push("secret");
      if (spec.format !== "string") notes.push(spec.format);
      lines.push(`# ${spec.description} — ${notes.join(", ")}`);
      const value = spec.secret ? "" : spec.default ?? spec.example ?? "";
      lines.push(`${spec.name}=${value}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
