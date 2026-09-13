/**
 * Run the indexer locally.
 *
 * The deployment on Vercel cannot reach TimescaleDB: the database accepts a fixed IP allowlist and
 * Vercel's egress addresses are not on it. Running the same handlers from a machine that *is* allowed
 * removes the network problem entirely — and that is also why production runs this server on Cloud
 * Run: there the container sits where the database already trusts the network.
 *
 *     pnpm --filter @ethonline2026/indexer dev:local
 *
 * Then point the app at it: `NEXT_PUBLIC_INDEXER_URL=http://localhost:3001`.
 * The server itself lives in `server.ts`, shared with the Cloud Run entry point.
 */
import { createIndexerServer, loadEnvFiles, ROUTES, scriptsDir } from "./server.js";

const HERE = scriptsDir();

// `.env.local` wins over `.env`, matching Next's precedence; an explicit environment wins over both.
loadEnvFiles([`${HERE}/../.env.local`, `${HERE}/../.env`, `${HERE}/../../../.env`]);

const PORT = Number(process.env.PORT ?? 3001);
const server = createIndexerServer({ here: HERE, port: PORT });

server.listen(PORT, () => {
  const dsn = process.env.TIMESERIES_DATABASE_URL;
  console.log(`  indexer (local)  → http://localhost:${PORT}`);
  console.log(`  routes           → ${Object.keys(ROUTES).length}`);
  console.log(`  database         → ${dsn === undefined || dsn.length === 0 ? "NOT CONFIGURED" : "configured"}`);
});
