# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated by the user ("your call"), decided here: **Vite + React + shadcn/ui (Tailwind), building
into `apps/indexer/public`**.

The reasoning that decided it: the existing `api/*.ts` Vercel functions are correct and covered by
31 offline tests, and `api/_lib/handlers.ts` is already framework-agnostic (it takes an injected
`IndexerRuntime` and returns a `Response`). Rewriting the transport to fix the presentation would put
a working, tested surface at risk for no user-visible gain. So the console becomes a real React app
while the functions, their tests, `verify:live`, `serve-local.ts` and the deploy keep working
unchanged. `vercel.json` already sets `outputDirectory: "public"`, so the build target needs no
change either.

## Users

Anyone who arrives at the deployment without prior knowledge of it: hackathon judges and technical
evaluators, the team demonstrating it, and a newcomer who wants to see what the system can actually
do. Their defining situation is **ignorance of the deployment's contents** — they do not know a pool
address, what is indexed, what the model status is, or which endpoints exist.

The incumbent console fails this user at the first interaction: it opens with a pool id already
typed into a form field, and refuses to run without one.

## Product Purpose

A console over the Agentic EMS indexer API. It lets someone who knows nothing about the deployment
discover what is indexed, run the five-node agent cycle on a real question, read the resulting
forecast and readjustment decisions, check every endpoint, and see whether the data and the models
behind it are currently healthy.

Success is a visitor who never learns a pool address, never reads the README, and still ends up
having seen the system do real work and knowing exactly how current that work is.

## Positioning

Every figure on screen is traceable to a stored row or a SQL view, and the console itself computes
nothing — it renders what the API returned. The grounding guarantee is enforced in the schema, not
just claimed in copy: a readjustment decision that cites nothing is not emitted as a decision at all.

## Operating Context

- Deployed on Vercel: static console plus Node-runtime serverless functions (pg needs sockets).
- Data in TimescaleDB; TimesFM-3 forecasts; temporal-vector retrieval; a risk-snapshot store.
- The agent cycle runs **in-process in the indexer function** via `@ethonline2026/langchain-agent`.
- A separate inference service on Cloud Run exists, and is currently deployed pinned to
  `AGENT_IMPL=mock` and `INFERENCE_PERSISTENCE=memory` — anything shown about it must reflect that
  rather than implying live model work.
- Used in evaluation sessions: someone will open this cold, with an audience, and it has to make
  sense within a minute.
- Routes answer `cache-control: no-store`; a forecast or decision is never stale.

## Capabilities and Constraints

**Confirmed to expose:** the full agent cycle from a natural-language question; quantile forecast
(q10–q50–q90) with the stored run; readjustment decisions and their outcomes; an endpoint explorer
showing request/response JSON for every route; per-dependency data status and recency; and model
status / SLA statistics for TimesFM-3 and Vertex.

**Two capabilities require new backend work — this is a constraint, not a preference:**

- **Pools cannot be enumerated by any route today.** Every pool-scoped route requires an address the
  caller already knows; `/api/agent` defaults `poolIds` to the literal `"0xpool"`. The distinct set
  exists in `pool_metrics_hourly.pool_id` and nowhere else exposed. `GET /api/pools` with metadata
  (protocol, network, observation count, last-seen) is added — it is the only thing that makes an
  address-agnostic console possible, and it doubles as the recency view.
- **Model status/SLA has no backing store.** There is no calls/health/uptime table, the health probe
  persists nothing, and there is no cron. The sole per-call telemetry is `ts_forecasts`
  (`run_id`, `issued_at`, `model_version`, `latency_ms`) and it covers only forecasts issued through
  the agent graph — the plain `/api/forecast` endpoint never persists. No table carries
  success/failure or an error message, so failures leave no trace. Recording is therefore added: a
  `model_probes` table plus a scheduled Vercel cron that probes TimesFM-3, Vertex and TimescaleDB and
  stores outcome and latency. **The view must read as "recording since <date>" until history
  accumulates, and must never imply uptime it did not observe.**

**Other confirmed constraints:**

- Chains and protocols *are* listable (`/api/risk/chains`, `/api/risk/protocols`; 12 and 12 in the
  curated roster). Market-maker slugs exist in code but are not routed.
- Errors are a typed contract — `BAD_REQUEST`, `VECTOR_UNAVAILABLE`, `DATABASE_UNAVAILABLE`,
  `MODEL_UNAVAILABLE`, `UPSTREAM_ERROR`, `INTERNAL_ERROR` — and raw SQL or connection strings must
  never reach the browser.
- The deep agent reports in prose; the v0.1 agent returns structured state. Both are reachable.
- A `dry` mode runs the deterministic path with no model spend.

**A decided behaviour:** the readjustment schema rejected a decision with no `parameters` and no
`citations`, and the raw zod dump surfaced as a 502. `parameters` becomes optional (a HOLD
legitimately has none); `citations` stays required. If the model still returns an ungrounded
decision, that single decision degrades to an explicitly-flagged `HOLD` and the cycle completes,
rather than the whole run failing.

**Open, not decided here:** whether the inference service is promoted from mock to live; whether the
indexer console gains authentication (the SPA grew a session layer, this app has none).

## Brand Commitments

The user made one binding constraint: **keep the base theme**. The incumbent "Terminal Noir" visual
language is therefore preserved, not replaced — the palette in `public/style.css` (ink `#0a0b0d`,
panel `#101214`, amber `#ffb300`, up `#16c784`, down `#ea3943`, graph `#6747ee`), the monospace
treatment of every numeral and micro-label, uppercase letterspaced headers, and the
`AGENTIC EMS <span>//</span> INDEXER` wordmark. The world stays; the information architecture and the
components are rebuilt.

## Evidence on Hand

- Nine live routes including `/api/agent`, `/api/forecast`, `/api/metrics`, `/api/performance`,
  `/api/search` and three risk routes.
- The real v0.1 five-node LangGraph cycle, running in-process.
- A TimesFM-3 forecast ledger and SQL-computed calibration in the database.
- 31 offline handler tests requiring no server, no database and no network.
- A curated risk roster of 12 chains and 12 protocols.

**Absences future work must not fabricate:** no historical uptime data exists; no per-LLM-call
latency or token counts are persisted; no pool names, symbols or metadata exist anywhere in the
schema (pools are opaque ids with a protocol and a network); there are no users, testimonials or
benchmarks.

## Product Principles

1. **The interface computes nothing.** Every number, timestamp and label comes from a response. If
   the API did not say it, the screen does not show it.
2. **Never require prior knowledge.** Any identifier the user must supply should be discoverable from
   within the console, and the first screen must be useful to someone who has never seen the system.
3. **Absence is a state, not a blank.** Unconfigured, unreachable, still-recording and genuinely-empty
   are four different things and each gets its own honest rendering.
4. **Recording beats implying.** Where the system has not observed something, say so — "recording
   since" is more trustworthy than a chart that starts at nothing and looks like an outage.
5. **Strictness belongs where it protects a claim.** The grounding requirement stays enforced; the
   spurious requirement that produced a raw schema dump in the user's face does not.

## Accessibility & Inclusion

Preserve what the incumbent already does: `:focus-visible` outlines on every control, `aria-live` on
the status strip, `sr-only` labels for icon-only controls, and a `role="img"` with an `aria-label` on
the chart. The dark palette must keep enough contrast — `--tk-fg-faint` on `--tk-panel` is the pair
to watch when new surfaces are added.
