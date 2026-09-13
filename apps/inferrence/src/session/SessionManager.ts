/**
 * Session lifecycle.
 *
 * A session is the durable conversation container (`SESSION_AGENTS = v01 | deep
 * | desk` in `@ethonline2026/timeseries`). The port here keeps the HTTP layer
 * independent of the storage adapter; the TimescaleDB-backed implementation is
 * ROADMAP T1.1, and the in-memory one is what the scaffold and tests use.
 */
import { isRunInFlight, assertTransition, type RunState } from "@ethonline2026/execution-domain";
import type { AgentMode } from "../events/contract.js";
import { HttpError } from "../http.js";

export type SessionStatus = "open" | "paused" | "closed";

export interface SessionRecord {
  readonly sessionId: string;
  readonly userId: string;
  readonly agent: AgentMode;
  readonly status: SessionStatus;
  readonly threadId: string | null;
  readonly startedAt: string;
  readonly lastActiveAt: string;
  readonly closedAt: string | null;
}

export interface OpenSessionInput {
  readonly userId: string;
  readonly agent?: AgentMode;
  readonly threadId?: string;
  readonly sessionId?: string;
}

export interface SessionStore {
  open(input: OpenSessionInput): Promise<SessionRecord>;
  touch(userId: string, sessionId: string): Promise<void>;
  close(userId: string, sessionId: string): Promise<void>;
  get(userId: string, sessionId: string): Promise<SessionRecord | null>;
  list(userId: string, limit?: number): Promise<SessionRecord[]>;
}

export class SessionManager {
  constructor(
    private readonly store: SessionStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async open(input: OpenSessionInput): Promise<SessionRecord> {
    return await this.store.open(input);
  }

  async get(userId: string, sessionId: string): Promise<SessionRecord> {
    const session = await this.store.get(userId, sessionId);
    if (session === null) {
      throw new HttpError("NOT_FOUND", `No session ${sessionId} for this identity.`);
    }
    return session;
  }

  async requireOpen(userId: string, sessionId: string): Promise<SessionRecord> {
    const session = await this.get(userId, sessionId);
    if (session.status === "closed") {
      throw new HttpError("CONFLICT", `Session ${sessionId} is closed.`);
    }
    return session;
  }

  async touch(userId: string, sessionId: string): Promise<void> {
    await this.store.touch(userId, sessionId);
  }

  async close(userId: string, sessionId: string): Promise<void> {
    await this.store.close(userId, sessionId);
  }

  async list(userId: string, limit?: number): Promise<SessionRecord[]> {
    return await this.store.list(userId, limit);
  }

  /** Exposed for tests and health probes. */
  get clock(): () => Date {
    return this.now;
  }
}

/** In-memory store: the scaffold default, and the test double. */
export class InMemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  async open(input: OpenSessionInput): Promise<SessionRecord> {
    const timestamp = this.#now().toISOString();
    const session: SessionRecord = {
      sessionId: input.sessionId ?? `ses_${this.#sessions.size + 1}_${timestamp}`,
      userId: input.userId,
      agent: input.agent ?? "v01",
      status: "open",
      threadId: input.threadId ?? null,
      startedAt: timestamp,
      lastActiveAt: timestamp,
      closedAt: null,
    };
    this.#sessions.set(session.sessionId, session);
    return session;
  }

  async touch(userId: string, sessionId: string): Promise<void> {
    const session = this.#owned(userId, sessionId);
    if (session !== null) {
      this.#sessions.set(sessionId, { ...session, lastActiveAt: this.#now().toISOString() });
    }
  }

  async close(userId: string, sessionId: string): Promise<void> {
    const session = this.#owned(userId, sessionId);
    if (session === null) return;
    this.#sessions.set(sessionId, {
      ...session,
      status: "closed",
      closedAt: this.#now().toISOString(),
    });
  }

  async get(userId: string, sessionId: string): Promise<SessionRecord | null> {
    return this.#owned(userId, sessionId);
  }

  async list(userId: string, limit = 50): Promise<SessionRecord[]> {
    return [...this.#sessions.values()]
      .filter((session) => session.userId === userId)
      .slice(0, limit);
  }

  /** Tenant scoping is enforced here, not by callers. */
  #owned(userId: string, sessionId: string): SessionRecord | null {
    const session = this.#sessions.get(sessionId);
    return session !== undefined && session.userId === userId ? session : null;
  }
}

/**
 * Runs are the unit of work inside a session. State transitions go through the
 * shared `execution-domain` state machine, so an illegal move is rejected before
 * any write — the same guard the execution service applies.
 */
export interface RunRecord {
  readonly runId: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly state: RunState;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

export interface CreateRunInput {
  readonly userId: string;
  readonly sessionId: string;
  readonly runId?: string;
}

export interface RunRegistry {
  create(input: CreateRunInput): Promise<RunRecord>;
  get(userId: string, runId: string): Promise<RunRecord | null>;
  advance(userId: string, runId: string, to: RunState): Promise<RunRecord>;
  listLive(userId: string): Promise<RunRecord[]>;
}

export class InMemoryRunRegistry implements RunRegistry {
  readonly #runs = new Map<string, RunRecord>();
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  async create(input: CreateRunInput): Promise<RunRecord> {
    const timestamp = this.#now().toISOString();
    const run: RunRecord = {
      runId: input.runId ?? `run_${this.#runs.size + 1}_${timestamp}`,
      sessionId: input.sessionId,
      userId: input.userId,
      state: "draft",
      startedAt: timestamp,
      finishedAt: null,
    };
    this.#runs.set(run.runId, run);
    return run;
  }

  async get(userId: string, runId: string): Promise<RunRecord | null> {
    return this.#owned(userId, runId);
  }

  async advance(userId: string, runId: string, to: RunState): Promise<RunRecord> {
    const run = this.#owned(userId, runId);
    if (run === null) throw new HttpError("NOT_FOUND", `No run ${runId} for this identity.`);
    // Throws IllegalTransitionError → mapped to 409 by the error handler.
    assertTransition(run.state, to);
    const finished = isRunInFlight(to) ? null : this.#now().toISOString();
    const next: RunRecord = { ...run, state: to, finishedAt: finished };
    this.#runs.set(runId, next);
    return next;
  }

  async listLive(userId: string): Promise<RunRecord[]> {
    return [...this.#runs.values()].filter(
      (run) => run.userId === userId && isRunInFlight(run.state),
    );
  }

  #owned(userId: string, runId: string): RunRecord | null {
    const run = this.#runs.get(runId);
    return run !== undefined && run.userId === userId ? run : null;
  }
}
