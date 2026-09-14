import { specFor } from "./catalog.js";

/**
 * Mask a value so it can appear in a log or a CI summary.
 *
 * The shape is kept — enough to tell two keys apart when debugging ("is this the staging one?") but
 * never enough to use. Short values are masked entirely rather than partially.
 */
export function redact(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

/** True when the catalog marks this name as a secret. */
export function isSecretName(name: string): boolean {
  return specFor(name)?.secret ?? false;
}

/** Redact every value whose *name* is marked secret; leave the rest readable. */
export function redactRecord(values: Readonly<Record<string, string>>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    output[name] = isSecretName(name) ? redact(value) : value;
  }
  return output;
}
