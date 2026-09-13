/**
 * Backfill `pool_metrics_hourly` for a mandate's resolved pools.
 *
 *   pnpm backfill:metrics                    # the default mandate
 *   pnpm backfill:metrics fi-lend-lp-base-v1 # a named template
 *
 * Resolves the mandate against the live yields feed first, so the pools that get
 * a history are the same ones the agent will be told about — a backfill for a
 * different pool set would leave the forecast reading an empty window while the
 * plan looked complete.
 */
import { loadInferenceEnv } from "../src/env.js";
import { backfillPoolMetrics } from "../src/mandate/backfill.js";
import { loadMandate } from "../src/mandate/registry.js";
import { createYieldsFeed, resolveMandate } from "../src/mandate/resolve.js";
import { PgSqlRunner, TimeseriesClient } from "@ethonline2026/timeseries";

async function main(): Promise<void> {
  const mandateId = process.argv[2] ?? "fi-lend-lp-base-v1";
  const env = loadInferenceEnv({ ...process.env, LOG_LEVEL: "info" });

  if (env.TIMESERIES_DATABASE_URL === undefined) {
    console.error("\nTIMESERIES_DATABASE_URL is not set. Nothing to write to.\n");
    process.exitCode = 1;
    return;
  }

  console.log(`\nmandate ${mandateId}: resolving pools against the live yields feed…`);
  const resolved = await resolveMandate(loadMandate(mandateId), createYieldsFeed());
  console.log(
    `resolved ${resolved.pools.length} pool(s):\n` +
      resolved.legs.map((leg) => `  ${leg.legId}  ${leg.pool.poolId}  ${leg.pool.symbol}`).join("\n"),
  );

  const runner = PgSqlRunner.fromEnv();
  const client = new TimeseriesClient(runner);

  const result = await backfillPoolMetrics({
    pools: resolved.legs.map((leg) => ({
      poolId: leg.pool.poolId,
      protocol: leg.pool.project,
      network: leg.pool.chain,
    })),
    client,
  });

  console.log(`\nwritten ${result.written} row(s) across ${result.pools} pool(s)`);
  for (const skip of result.skipped) {
    console.warn(`  skipped ${skip.poolId}: ${skip.reason}`);
  }
  console.log(
    `\ncoverage: ${result.coverage.pools} pool(s), ${result.coverage.rows} row(s), ` +
      `${result.coverage.earliest ?? "—"} → ${result.coverage.latest ?? "—"}`,
  );
  console.log(
    "\nTimesFM-3 needs at least 8 points per pool; check the coverage above before forecasting.\n",
  );

  await runner.close?.();
}

void main();
