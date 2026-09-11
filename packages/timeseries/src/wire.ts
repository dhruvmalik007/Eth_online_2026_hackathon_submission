/**
 * Wire coercion helpers.
 *
 * pg returns `numeric` as a decimal string, `timestamptz` as a Date, arrays as
 * JS arrays and `jsonb` as a parsed object — but a misconfigured column or a
 * driver upgrade could change any of that. These narrow defensively instead of
 * casting, so a shape change degrades to `null` rather than poisoning a
 * downstream calculation.
 */

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' && value.length > 0) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** pg array columns arrive as JS arrays; accept a single value too. */
export function asStringArray(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

/** `jsonb` columns arrive parsed; fall back to parsing a raw string. */
export function asJsonObject(value: unknown): Record<string, string> {
  const source = typeof value === 'string' ? safeParse(value) : value;
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return {};
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(source as Record<string, unknown>)) {
    if (typeof v === 'string') out[key] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[key] = String(v);
  }
  return out;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
