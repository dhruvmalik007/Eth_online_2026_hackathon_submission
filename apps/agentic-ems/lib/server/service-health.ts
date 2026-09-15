/**
 * Server-side health probes for the operator surfaces.
 *
 * These replace values that used to be hardcoded in the UI. A status shown to an operator is a claim
 * about the world, and a claim that cannot be false is not a status — it is decoration. So each entry
 * here is the result of a real request, and "unreachable" is a legitimate, expected answer.
 *
 * Server-side on purpose: a browser probe would report the *browser's* reachability and CORS, not the
 * deployment's. The page asks the same question the platform would.
 */
export interface ServiceStatus {
  readonly label: string;
  readonly value: string;
  readonly tone: "ok" | "warn" | "info";
}

interface Probe {
  readonly ok: boolean;
  readonly body?: unknown;
}

/** Fetch JSON with a hard timeout; any failure is a result, not an exception. */
async function probe(url: string, timeoutMs = 2_500): Promise<Probe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    const body = (await response.json().catch(() => undefined)) as unknown;
    return body === undefined ? { ok: response.ok } : { ok: response.ok, body };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function databaseOf(body: unknown): string | undefined {
  const value = (body as { database?: unknown } | undefined)?.database;
  return typeof value === "string" ? value : undefined;
}

/**
 * Probe every service the reference page reports on.
 *
 * A service with no configured URL reports `unconfigured` rather than `unreachable`: those are
 * different problems with different fixes, and collapsing them sends someone to debug the network
 * when the answer is an environment variable.
 */
export async function probeServices(): Promise<readonly ServiceStatus[]> {
  const indexerUrl = (process.env.NEXT_PUBLIC_INDEXER_URL ?? "").replace(/\/$/, "");
  const executionUrl = (process.env.NEXT_PUBLIC_EXECUTION_URL ?? "").replace(/\/$/, "");
  const langsmithOn = ["true", "1"].includes(process.env.LANGSMITH_TRACING ?? "");

  const [indexer, execution] = await Promise.all([
    indexerUrl.length === 0 ? Promise.resolve<Probe>({ ok: false }) : probe(`${indexerUrl}/api/health`),
    executionUrl.length === 0 ? Promise.resolve<Probe>({ ok: false }) : probe(`${executionUrl}/health`),
  ]);

  const indexerValue =
    indexerUrl.length === 0
      ? { value: "unconfigured", tone: "info" as const }
      : indexer.ok
        ? { value: databaseOf(indexer.body) === "unavailable" ? "db down" : "OK", tone: "ok" as const }
        : { value: "unreachable", tone: "warn" as const };

  const executionValue =
    executionUrl.length === 0
      ? { value: "unconfigured", tone: "info" as const }
      : execution.ok
        ? { value: databaseOf(execution.body) === "unavailable" ? "degraded" : "OK", tone: "ok" as const }
        : { value: "unreachable", tone: "warn" as const };

  return [
    { label: "indexer", ...indexerValue },
    { label: "execution", ...executionValue },
    { label: "traces", value: langsmithOn ? "langsmith" : "off", tone: "info" },
  ];
}
