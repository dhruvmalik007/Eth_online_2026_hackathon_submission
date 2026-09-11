/** Strict JSON extraction helpers for LLM structured output. */

export function parseJsonArray(text: string): unknown[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('response contains no JSON array');
  }
  return zParseArray(text.slice(start, end + 1));
}

function zParseArray(s: string): unknown[] {
  // Local import-free JSON.parse wrapper keeps error messages tight.
  const parsed: unknown = JSON.parse(s);
  if (!Array.isArray(parsed)) throw new Error('response is not a JSON array');
  return parsed;
}

export function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('response contains no JSON object');
  }
  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('response is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}
