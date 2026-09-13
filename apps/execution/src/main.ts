/**
 * Entry point.
 *
 * The only place a concrete authenticator is chosen. Until Privy verification
 * lands (Phase 4) this is the development authenticator, which `buildApp` refuses
 * to accept in `live` mode — so a misconfigured deploy fails at boot rather than
 * serving spoofable identities to something that can sign.
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
