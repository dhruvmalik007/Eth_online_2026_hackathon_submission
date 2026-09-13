/**
 * The Cloud Run entrypoint.
 *
 * Boot order matters: build the runtime, build the app (which enforces the
 * deployability check), then listen. Shutdown drains in-flight requests and
 * releases runtime-held resources, so a rolling deploy does not cut a run in half.
 */
import { buildApp } from "./app.js";
import { HeaderAuthenticator } from "./http.js";
import { closeRuntime, createRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const runtime = createRuntime();
  const app = buildApp({ runtime, authenticator: new HeaderAuthenticator() });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await closeRuntime(runtime);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: runtime.env.PORT, host: runtime.env.HOST });
}

void main();
