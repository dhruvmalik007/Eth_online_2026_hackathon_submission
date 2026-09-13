# `@ethonline2026/inferrence`

**Production inference + agent-orchestration microservice for the Agentic EMS.**

> 📋 **Product design roadmap: [`ROADMAP.md`](./ROADMAP.md)** — the full architecture,
> phased task list, release gates and risk register.

It replaces the mock orchestration in `apps/agentic-ems` with the real thing:

- runs the real agent (`packages/langchain`: `runV01` / `DeepGraphAgent`) and the real
  prediction model (`TimesFM-3`),
- isolates untrusted tool/code work in a **sandbox**, following the E2B `runtime`
  architecture (Cloud Run sandboxes / gVisor),
- streams a typed event log over **SSE** that maps 1:1 onto the existing
  `@ethonline2026/ux-workflow` render contract (`AgentStep`, `AgentTraceGroup`, widgets),
- turns agent output into **signable Web3 intents** a user approves on a Ledger via the
  DMK flow, logged against the `CustodyLog` intent vocabulary.

The primary consumer is the Next.js `agentic-ems` app. A terminal CLI
(`scripts/smoke-sse.ts`) exists for testing the stream without a browser.

---

## Status

`INFERENCE_MODE=dry` (the default) is a **working end-to-end service**: it creates
sessions, runs a turn through the orchestrator, exercises a real sandbox, emits the full
event stream, replays it from the journal, and queues a digest-verified signing intent for
human approval — all with no database, no model and no network.

Everything that touches a model, a real sandbox, the database or a Ledger device is an
explicit, task-named `NotImplementedError` rather than a fake. `INFERENCE_MODE=live`
refuses to start until the persistence and sandbox adapters exist — losing a run's audit
trail in an instance-local `Map` would be worse than failing loudly.

---

## Quickstart

```bash
pnpm install
pnpm --filter @ethonline2026/inferrence build

# dry mode, mock agent, local sandbox
pnpm --filter @ethonline2026/inferrence start

# exercise the stream from a terminal (second terminal)
pnpm --filter @ethonline2026/inferrence smoke -- \
  --query "rebalance my USDC into the best 30d yield" --follow
```

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/health` | GET | Per-dependency reachability (DB, sandbox, TimesFM-3, Vertex, custody) |
| `/v1/sessions` | POST | Create a session (`{ agent }`) |
| `/v1/sessions/:id` | GET | Session + its pending intents |
| `/v1/sessions/:id/turns` | POST | **SSE**: run one agent turn (`{ query, mode, pools, protocols, horizonDays, dry, follow }`) |
| `/v1/runs/:id/events` | GET | Replay a run's journal (`?sinceSeq=`) |
| `/v1/sessions/:id/intents/:intentId/approve` | POST | Resolve a HITL approval (`{ outcome, signature?, txHash? }`) |

All routes require an identity. In development the `HeaderAuthenticator` reads `x-user-id`
and is refused in `live` mode.

`turns` responds `text/event-stream` and sets `x-inference-run-id`. Frames are
`id: <seq>` + `data: <InferenceEvent JSON>`. `follow: true` keeps the stream open past the
turn so `approval.resolved` is delivered too; the default closes on `run.completed`.

## Configuration

Every setting has a safe default; see [`.env.example`](./.env.example). The ones that
change behaviour most:

| Variable | Default | Meaning |
|---|---|---|
| `INFERENCE_MODE` | `dry` | `dry` = in-memory stores; `live` = TimescaleDB (not wired yet) |
| `AGENT_IMPL` | `mock` | `mock` = deterministic script; `langchain` = real agent (T3.1) |
| `SANDBOX_PROVIDER` | `local` | `local` = confined process; `cloudrun` = gVisor sandboxes (T4.2) |
| `SANDBOX_EGRESS_ALLOWLIST` | *(empty)* | Empty denies **all** sandbox egress |
| `INFERENCE_MAX_CONCURRENT_RUNS` | `8` | Instance admission bound |
| `TIMESFM3_SERVICE_URL` | — | The self-hosted TimesFM-3 Cloud Run service |

## Verification

```bash
pnpm --filter @ethonline2026/inferrence typecheck
pnpm --filter @ethonline2026/inferrence test   # offline: no DB, model or network
pnpm --filter @ethonline2026/inferrence lint
pnpm --filter @ethonline2026/inferrence build
docker build -f apps/inferrence/Dockerfile -t inferrence:local .
```

## Design notes

- **One composition root.** `src/runtime.ts` is the only place concrete adapters meet. It is
  cached on `globalThis` (a Cloud Run instance is reused across requests) and constructs
  nothing until a request needs it — which is what lets the test suite build a runtime freely.
- **Adapters are injected.** Routes, the orchestrator and the domain logic take their
  collaborators as parameters, so the whole surface is exercisable offline.
- **Degradation is explicit.** A missing sandbox, an unreachable model or an unconfigured
  vector layer is a typed state on `/health`, never a silent empty result.
- **The UI computes nothing.** The event stream carries real evidence, and `step.*` payloads
  are the UI's own `AgentStep` type — asserted at compile time.
