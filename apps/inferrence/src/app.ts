/**
 * The Fastify app.
 *
 * `assertDeployable` runs at construction, not on the first request: a service
 * that can propose funds-moving intents must not accept a spoofable identity, so
 * a bad configuration is a boot failure rather than a runtime surprise.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { registerRoutes } from "./api/routes.js";
import { assertDeployable, toErrorResponse, type Authenticator } from "./http.js";
import type { InferenceRuntime } from "./runtime.js";

export interface AppOptions {
  readonly runtime: InferenceRuntime;
  readonly authenticator: Authenticator;
}

export function buildApp(options: AppOptions): FastifyInstance {
  const { runtime, authenticator } = options;
  assertDeployable(runtime.env.INFERENCE_MODE, authenticator);

  const app = Fastify({ logger: { level: runtime.env.LOG_LEVEL } });
  app.setErrorHandler((error, request, reply) => {
    // Log the real cause BEFORE the wire response is scrubbed. Without this a
    // failure is an unlogged 500 with a generic message — which is exactly how a
    // credential-with-trailing-newline bug presents, and it is undebuggable.
    request.log.error({ err: error }, "request failed");
    reply.send(toErrorResponse(error, reply));
  });

  registerRoutes(app, runtime, authenticator);
  return app;
}
