import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { HeaderAuthenticator } from "../src/http.js";
import { loadInferenceEnv } from "../src/env.js";
import { createTracing } from "../src/observability/tracing.js";
import { makeRuntime, USER } from "./helpers.js";

/**
 * "Is tracing working?" has to be answerable without reading the logs of a running revision, because
 * the failure it guards against is invisible: `enabled: true` with no key produces an empty dashboard
 * while every other signal says tracing is on.
 *
 * The key itself is never asserted *or* reported — only whether one is present — so these tests also
 * pin that the health block cannot become a place a credential leaks.
 */

const open: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((app) => app.close()));
});

function warned(env: Record<string, string>): string[] {
  const messages: string[] = [];
  createTracing(loadInferenceEnv(env as NodeJS.ProcessEnv), (message) => messages.push(message));
  return messages;
}

describe("createTracing", () => {
  it("says nothing when tracing is simply off — that is a choice, not a fault", () => {
    expect(warned({ LANGSMITH_TRACING: "false" })).toEqual([]);
  });

  it("warns when tracing is enabled with no key, because that state looks like success", () => {
    expect(warned({ LANGSMITH_TRACING: "true" })).toEqual([
      expect.stringContaining("LANGSMITH_API_KEY is unset"),
    ]);
  });

  it("treats an empty key as absent rather than as a key", () => {
    // A shell that exports `LANGSMITH_API_KEY=` from a missing secret produces this, and it would
    // otherwise read as configured.
    expect(warned({ LANGSMITH_TRACING: "true", LANGSMITH_API_KEY: "" })).toHaveLength(1);
  });

  it("says nothing once a key is present", () => {
    expect(warned({ LANGSMITH_TRACING: "true", LANGSMITH_API_KEY: "lsv2_pt_test" })).toEqual([]);
  });
});

describe("/health tracing block", () => {
  async function health(env: Record<string, string>) {
    const app = buildApp({
      runtime: makeRuntime({}, env),
      authenticator: new HeaderAuthenticator(),
    });
    await app.ready();
    open.push(app);
    const res = await app.inject({ method: "GET", url: "/health", headers: { "x-user-id": USER } });
    return res.json() as { tracing: Record<string, unknown> };
  }

  it("reports that tracing is on with a key, and where traces will land", async () => {
    const body = await health({
      LANGSMITH_TRACING: "true",
      LANGSMITH_API_KEY: "lsv2_pt_test",
      LANGSMITH_PROJECT: "ethonline2026-fixed-income",
    });
    expect(body.tracing.enabled).toBe(true);
    expect(body.tracing.keyPresent).toBe(true);
    expect(body.tracing.project).toBe("ethonline2026-fixed-income");
    expect(body.tracing.warning).toBeUndefined();
  });

  it("flags the enabled-but-unkeyed state rather than reporting a healthy config", async () => {
    const body = await health({ LANGSMITH_TRACING: "true" });
    expect(body.tracing.enabled).toBe(true);
    expect(body.tracing.keyPresent).toBe(false);
    expect(String(body.tracing.warning)).toContain("LANGSMITH_API_KEY");
  });

  it("never reports the key itself, so the block stays safe to quote in a ticket", async () => {
    // A synthetic key of the right *shape*. Using the real one would commit a live credential to prove
    // that credentials are not exposed — and a test fixture is the last place anyone looks for a leak.
    const secret = "lsv2_pt_deadbeefdeadbeefdeadbeefdeadbeef_cafebabe";
    const body = await health({ LANGSMITH_TRACING: "true", LANGSMITH_API_KEY: secret });
    expect(JSON.stringify(body)).not.toContain(secret);
    // Not even a prefix: a partial key is still a leak once it is in a screenshot or an issue.
    expect(JSON.stringify(body)).not.toContain("lsv2_pt");
  });

  it("defaults the project to the repository's, so a package cannot silently open a second one", async () => {
    const body = await health({});
    expect(body.tracing.project).toBe("ethonline2026-fixed-income");
  });
});
