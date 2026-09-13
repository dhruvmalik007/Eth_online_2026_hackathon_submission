import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http.js";
import {
  InMemoryRunRegistry,
  InMemorySessionStore,
  SessionManager,
} from "../src/session/SessionManager.js";

describe("SessionManager", () => {
  it("runs the open → touch → close lifecycle", async () => {
    const manager = new SessionManager(new InMemorySessionStore());
    const session = await manager.open({ userId: "u1", agent: "deep" });

    expect(session.status).toBe("open");
    expect(session.agent).toBe("deep");

    await manager.touch("u1", session.sessionId);
    expect((await manager.get("u1", session.sessionId)).lastActiveAt).toBeDefined();

    await manager.close("u1", session.sessionId);
    expect((await manager.get("u1", session.sessionId)).status).toBe("closed");
    await expect(manager.requireOpen("u1", session.sessionId)).rejects.toBeInstanceOf(HttpError);
  });

  it("never returns another tenant's session", async () => {
    const manager = new SessionManager(new InMemorySessionStore());
    const session = await manager.open({ userId: "u1" });
    // The store returns null; the manager surfaces it as a typed NOT_FOUND, so a
    // cross-tenant probe cannot distinguish "not yours" from "does not exist".
    expect(await new InMemorySessionStore().get("u2", session.sessionId)).toBeNull();
    await expect(manager.get("u2", session.sessionId)).rejects.toBeInstanceOf(HttpError);
  });

  it("lists only the caller's sessions", async () => {
    const manager = new SessionManager(new InMemorySessionStore());
    await manager.open({ userId: "u1" });
    await manager.open({ userId: "u2" });
    expect(await manager.list("u1")).toHaveLength(1);
  });
});

describe("InMemoryRunRegistry", () => {
  it("moves through the shared state machine and applies the guard", async () => {
    const runs = new InMemoryRunRegistry();
    const run = await runs.create({ userId: "u1", sessionId: "s1" });
    expect(run.state).toBe("draft");

    await runs.advance("u1", run.runId, "simulating");
    await runs.advance("u1", run.runId, "ranked");
    const awaiting = await runs.advance("u1", run.runId, "awaiting_user");
    expect(awaiting.state).toBe("awaiting_user");

    // ranked → confirmed is not a legal move; the guard fires before any write.
    await expect(runs.advance("u1", run.runId, "confirmed")).rejects.toThrow(/Illegal run transition/);
    expect((await runs.get("u1", run.runId))?.state).toBe("awaiting_user");
  });

  it("scopes runs to their owner", async () => {
    const runs = new InMemoryRunRegistry();
    const run = await runs.create({ userId: "u1", sessionId: "s1" });
    expect(await runs.get("u2", run.runId)).toBeNull();
    await expect(runs.advance("u2", run.runId, "simulating")).rejects.toBeInstanceOf(HttpError);
  });

  it("reports in-flight runs only", async () => {
    const runs = new InMemoryRunRegistry();
    const run = await runs.create({ userId: "u1", sessionId: "s1" });
    expect(await runs.listLive("u1")).toHaveLength(0);
    await runs.advance("u1", run.runId, "simulating");
    await runs.advance("u1", run.runId, "ranked");
    await runs.advance("u1", run.runId, "awaiting_user");
    await runs.advance("u1", run.runId, "signed");
    expect(await runs.listLive("u1")).toHaveLength(1);
  });
});
