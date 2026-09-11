# @ethonline2026/indexer

Serverless API + Terminal Noir console for the Agentic EMS. It exposes the v0.1
five-node LangGraph cycle, the TimesFM-3 forecast ledger, SQL-computed
performance evaluation and temporal-vector retrieval over HTTP, so a browser can
ask the desk a question and read a fully cited answer.

## Routes

All routes run on the **Node.js** runtime (pg needs sockets, not the edge
runtime) and answer with `cache-control: no-store` — a forecast or a decision is
never stale.

| Route | Method | Returns |
|---|---|---|
| `/api/health` | GET | Per-dependency reachability: TimescaleDB, TimesFM-3, pgvector/vectorscale, retrieval |
| `/api/metrics` | GET | Time-bucketed pool metrics (`poolId`, `metric`, `days`, `bucket`) |
| `/api/forecast` | GET/POST | A TimesFM-3 forecast, or the stored path (`stored=true`) |
| `/api/performance` | GET | Realized yield, forecast calibration and scored decisions |
| `/api/search` | POST | Temporal-vector hits with the row ids behind each chunk |
| `/api/agent` | POST | The full cycle: synthesis, decisions, guardrails, audit, evidence |

`/api/agent` takes `mode: "v01" | "deep"` (deep runs the deepagents
tool-calling harness) and `dry: true` to skip every model call and return the
deterministic skeleton — useful for smoke-testing a fresh deployment without
spend.

### Error contract

Failures return a typed code the frontend renders as a specific state rather
than a blank pane: `BAD_REQUEST`, `VECTOR_UNAVAILABLE`, `DATABASE_UNAVAILABLE`,
`MODEL_UNAVAILABLE`, `UPSTREAM_ERROR`, `INTERNAL_ERROR`. Unexpected errors are
logged server-side and returned as a generic `INTERNAL_ERROR`, so a raw message
can never leak SQL or a connection string to the browser.

## Deploy

**1. Provision the database.** Create a Tiger Cloud service, then apply the
schema from the repo root:

```bash
TIMESERIES_DATABASE_URL='postgres://…' pnpm --filter @ethonline2026/timeseries migrate
```

**2. Point Vercel at the app.** Set the project's **Root Directory** to
`apps/indexer`. This app is a workspace member (`pnpm-workspace.yaml`), so Vercel
installs from the repo root and links `@ethonline2026/*` locally rather than
reaching for the registry.

**3. Set environment variables** from `.env.example`. On Vercel there is no
`gcloud` session and no persistent disk, so provide the service-account JSON in
`GOOGLE_SERVICE_ACCOUNT_KEY`; the runtime materializes it to `/tmp` and points
`GOOGLE_APPLICATION_CREDENTIALS` at it on cold start. Locally, an ADC session
from `gcloud auth application-default login` is enough.

**4. Deploy.**
```bash
cd apps/indexer && vercel deploy --prod
```

The build command is `turbo run build --filter=@ethonline2026/indexer^...`,
which builds the workspace dependencies (they publish `dist/`, which is what
this app imports) without recursing into this package's own validation task.

### Local development

```bash
pnpm --filter @ethonline2026/indexer dev   # vercel dev
```

## Architecture notes

**One composition root.** `api/_lib/runtime.ts` is the only place concrete
adapters meet. It caches the pg pool, the repositories and the deep agent on
`globalThis`, because a Vercel instance freezes between requests and thaws on
the next one — a cold start pays for them once, warm invocations reuse them.

**Handlers take their runtime as a parameter.** `api/_lib/handlers.ts` holds all
route logic and receives an `IndexerRuntime`, so the whole surface is exercisable
offline with injected fakes; the files in `api/` are thin adapters. That is why
the test suite needs no server, no database and no network.

**Degradation is explicit.** An absent pgvector install, an unreachable model or
a missing embedding project all produce a typed state and a health entry rather
than a silent empty result.

**The UI computes nothing.** `public/app.js` renders only what the API returned,
so the screen cannot drift from what the agent and SQL actually said. The
activity column replays the run's real audit entries, not a timer.

## Verify

```bash
pnpm --filter @ethonline2026/indexer typecheck
pnpm --filter @ethonline2026/indexer test        # 31 offline tests
pnpm --filter @ethonline2026/indexer lint
```

Against live services (requires the env from `.env.example`):

```bash
pnpm --filter @ethonline2026/indexer verify:live
```
