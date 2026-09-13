/**
 * Persistence composition.
 *
 * `INFERENCE_PERSISTENCE=memory` (the default) runs entirely in-process, which is
 * what lets the whole pipeline — and its test suite — work with no database.
 *
 * `timescale` has **no silent fallback**: the TimescaleDB-backed stores (via
 * `@ethonline2026/timeseries`'s `SessionRepository`, `StrategyRepository` and
 * `ExecutionRepository`) are ROADMAP T1.1 / T1.3, and until they exist a
 * deployment must fail loudly rather than lose a run's audit trail in an
 * instance-local `Map`.
 */
import type { InferenceEnv } from "../env.js";
import { NotImplementedError } from "../http.js";
import { InMemoryEventJournal, type EventJournal } from "../session/EventJournal.js";
import {
  InMemoryRunRegistry,
  InMemorySessionStore,
  type RunRegistry,
  type SessionStore,
} from "../session/SessionManager.js";

export interface RunStores {
  readonly sessions: SessionStore;
  readonly runs: RunRegistry;
  readonly journal: EventJournal;
}

export function createInMemoryStores(): RunStores {
  return {
    sessions: new InMemorySessionStore(),
    runs: new InMemoryRunRegistry(),
    journal: new InMemoryEventJournal(),
  };
}

export function createStores(env: InferenceEnv): RunStores {
  if (env.INFERENCE_PERSISTENCE === "memory") return createInMemoryStores();
  throw new NotImplementedError(
    "TimescaleDB-backed session/run/event stores (INFERENCE_PERSISTENCE=timescale)",
    "T1.1 / T1.3",
  );
}
