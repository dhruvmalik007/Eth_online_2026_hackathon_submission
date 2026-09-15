/**
 * Post-deploy smoke test for the deployed indexer.
 *
 * Run against a real revision, not a mock, because the failure this catches is deployment-shaped:
 * the service answers, but a dependency was never wired to it. `/api/health` reports each dependency
 * separately, so one failing check names the thing to fix rather than "the service is down".
 *
 *     pnpm --filter @ethonline2026/indexer verify:cloudrun -- https://agentic-ems-indexer-…run.app
 *
 * Exit code is non-zero on the first failing check, so a workflow can gate on it.
 */
interface Check {
  readonly name: string;
  readonly path: string;
}

const CHECKS: readonly Check[] = [
  { name: "liveness", path: "/healthz" },
  { name: "health", path: "/api/health" },
  { name: "metrics", path: "/api/metrics" },
  { name: "risk chains", path: "/api/risk/chains" },
];

async function main(): Promise<number> {
  const baseUrl = (process.argv[2] ?? process.env.INDEXER_URL ?? "").replace(/\/$/, "");
  if (baseUrl.length === 0) {
    console.error("usage: verify-cloudrun <base-url>   (or set INDEXER_URL)");
    return 2;
  }

  let failures = 0;
  for (const check of CHECKS) {
    const url = `${baseUrl}${check.path}`;
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      const body = (await response.json().catch(() => undefined)) as unknown;
      if (!response.ok) failures += 1;
      console.log(`${response.ok ? "ok  " : "FAIL"} ${check.name.padEnd(12)} ${response.status} ${url}`);
      if (!response.ok) console.log(`     ${JSON.stringify(body).slice(0, 300)}`);
    } catch (cause) {
      failures += 1;
      console.log(`FAIL ${check.name.padEnd(12)} ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed against ${baseUrl}`);
    return 1;
  }
  console.log(`\nall ${CHECKS.length} checks passed against ${baseUrl}`);
  return 0;
}

void main().then((code) => {
  process.exitCode = code;
});
