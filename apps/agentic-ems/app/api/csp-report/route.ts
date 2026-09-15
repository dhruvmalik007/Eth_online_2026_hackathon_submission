import { NextResponse } from "next/server";

/**
 * Collects Content-Security-Policy violation reports.
 *
 * The policy in `middleware.ts` ships as `Report-Only`, and a report-only policy with nowhere to
 * report to is decorative — it protects nothing and tells you nothing. This is the sink, so that
 * promoting it to enforcing can be a decision made on data from a real deployment rather than a guess.
 *
 * ## Why this route has no session
 *
 * The browser sends these with no credentials of its own — it cannot be asked to authenticate for a
 * report — so requiring a session would simply mean collecting nothing. That does make it a log write
 * anyone can drive, which is the trade: the body is length-capped, parsed, and only two fields are
 * ever logged, so a caller cannot inject arbitrary text into the logs or make this route expensive.
 */

/** Reports are a few hundred bytes. Anything much larger is not a report. */
const MAX_BYTES = 8 * 1024;

interface LegacyReport {
  readonly "csp-report"?: {
    readonly "violated-directive"?: unknown;
    readonly "blocked-uri"?: unknown;
  };
}

interface ReportingApiEntry {
  readonly type?: unknown;
  readonly body?: { readonly effectiveDirective?: unknown; readonly blockedURL?: unknown };
}

function readStrings(value: unknown): readonly [string, string] | null {
  // The legacy `report-uri` shape and the Reporting API's envelope, which differ and both arrive.
  if (Array.isArray(value)) {
    for (const entry of value as readonly ReportingApiEntry[]) {
      if (entry?.type !== "csp-violation") continue;
      const directive = entry.body?.effectiveDirective;
      const blocked = entry.body?.blockedURL;
      if (typeof directive === "string") {
        return [directive, typeof blocked === "string" ? blocked : ""];
      }
    }
    return null;
  }
  const report = (value as LegacyReport)?.["csp-report"];
  const directive = report?.["violated-directive"];
  const blocked = report?.["blocked-uri"];
  if (typeof directive !== "string") return null;
  return [directive, typeof blocked === "string" ? blocked : ""];
}

export async function POST(request: Request): Promise<Response> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  if (raw.length > MAX_BYTES) return new NextResponse(null, { status: 413 });

  try {
    const parsed = readStrings(JSON.parse(raw) as unknown);
    // Only two fields, both taken from a fixed set of keys — so the message cannot be made to say
    // something it did not. The blocked URI is still caller-influenced; it is the one field worth
    // having, and it is bounded by MAX_BYTES.
    if (parsed !== null) console.warn(`[csp] ${parsed[0]} blocked ${parsed[1] || "(inline)"}`);
  } catch {
    // A malformed report is not worth a status the browser will act on.
  }

  // 204: nothing for the browser to do with a body, and nothing to retry.
  return new NextResponse(null, { status: 204 });
}
