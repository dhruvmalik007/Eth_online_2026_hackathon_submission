/**
 * Secret redaction.
 *
 * Lives in `observability/` rather than `orchestrator/` because it has two
 * consumers with different reasons: the orchestrator scrubs error text before it
 * is streamed, and the tracer scrubs every payload before it leaves the process.
 * A trace dashboard is an outbound data path like any other, and the most common
 * accidental exfiltration is a credential inside an error message.
 */

const BEARER = /\b(?:sk|rk|pk|glpat|xox[baprs])-?[A-Za-z0-9_-]{16,}\b/g;
const LANGSMITH_KEY = /\blsv2_pt_[A-Za-z0-9_-]{12,}\b/g;
const PRIVY_KEY = /wallet-auth:[A-Za-z0-9+/=_-]+/g;
const HEX_SECRET = /\b0x[0-9a-fA-F]{64}\b/g;

/** Redact credential-shaped strings before they are persisted, streamed or traced. */
export function redactSecrets(text: string): string {
  return text
    .replace(BEARER, "[redacted]")
    .replace(LANGSMITH_KEY, "[redacted-key]")
    .replace(PRIVY_KEY, "wallet-auth:[redacted]")
    .replace(HEX_SECRET, "[redacted-key]");
}

/**
 * Redact every string in a nested value, for tracer payloads.
 *
 * **Order matters: redact, then truncate — never the reverse.** Truncating first
 * can cut a credential in half and leave its prefix in the trace, which is a real
 * leak (`lsv2_pt_abc…` is still a hint). Redacting first means the secret is gone
 * before any cut, at the cost of occasionally splitting a `[redacted]` marker.
 */
export function redactDeep(value: unknown, maxString = 2_000, depth = 0): unknown {
  if (depth > 8) return "[depth-limit]";
  if (typeof value === "string") {
    const redacted = redactSecrets(value);
    return redacted.length > maxString ? `${redacted.slice(0, maxString)}…[truncated]` : redacted;
  }
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redactDeep(item, maxString, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = redactDeep(item, maxString, depth + 1);
  }
  return out;
}
