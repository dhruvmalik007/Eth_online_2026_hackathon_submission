/**
 * Production entry point for the indexer — the Cloud Run service.
 *
 * Same handlers, same route table as the local runner (`server.ts`); the only differences are that
 * it defaults to the port Cloud Run injects (8080) and it drains on SIGTERM, which is what Cloud Run
 * sends before it takes an instance away. Without the drain, an in-flight forecast request is cut.
 *
 *     PORT=8080 node --import tsx scripts/serve.ts
 */
import { createIndexerServer, loadEnvFiles, ROUTES, scriptsDir } from "./server.js";

const HERE = scriptsDir();
// Cloud Run injects PORT. `.env.local` is loaded only if it happens to exist — on Cloud Run it does
// not, and configuration arrives as environment variables and mounted secrets.
loadEnvFiles([`${HERE}/../.env.local`, `${HERE}/../.env`]);

const PORT = Number(process.env.PORT ?? 8080);
const server = createIndexerServer({ here: HERE, port: PORT });

server.listen(PORT, () => {
  const dsn = process.env.TIMESERIES_DATABASE_URL;
  console.log(
    JSON.stringify({
      service: "indexer",
      runtime: "cloudrun",
      port: PORT,
      routes: Object.keys(ROUTES).length,
      database: dsn === undefined || dsn.length === 0 ? "unconfigured" : "configured",
    }),
  );
});

/** Cloud Run sends SIGTERM before removing an instance; finish what is in flight. */
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(JSON.stringify({ service: "indexer", event: "shutdown", signal }));
    server.close(() => process.exit(0));
  });
}
