# `apps/inferrence` — Product Design Roadmap

> **Status:** scaffold landed (P0–P2 + interfaces). Live model calls, the Cloud Run
> sandbox adapter, the TimescaleDB stores and the real agent event mapping are the
> work items below.
>
> **What this is:** the production inference + agent-orchestration microservice for
> the Agentic EMS. It replaces the mock orchestration in `apps/agentic-ems`.

Legend: ✅ done in the scaffold · 🔶 partially done (port + fake, adapter pending) · ⬜ not started

---

## 1. Why this service exists

Today the demo's "agent" is a keyword matcher. `apps/agentic-ems/components/demo/ChatStage.tsx`
runs `runScript(prompt)`, which lower-cases the prompt, branches on `prompt.includes(...)`,
and pushes pre-written prose on a `setTimeout`. The `AgentStep[]` it renders comes from
fixtures in `apps/agentic-ems/lib/agent-traces.ts`, whose own header says:

> *"the productionised version replaces this one file."*

Nothing in the demo reaches `packages/langchain`, `packages/timeseries`,
`packages/risk-analysis-data-pipeline`, or any Web3 package. Those packages are real
and already work — they are simply unreachable from the UI.

`apps/inferrence` is the missing layer that makes them reachable, with four jobs:

1. **Orchestrate** a real agent run (`runV01` / `DeepGraphAgent`) and stream what it did.
2. **Forecast** with the real model (TimesFM-3) behind a guardrailed port.
3. **Isolate** untrusted tool/code work in a sandbox, following the E2B `runtime` architecture.
4. **Propose** Web3 transactions as signable intents that a human approves on a Ledger (DMK).

---

## 2. Architecture

```
                        ┌──────────────────────────── browser ────────────────────────────┐
                        │  apps/agentic-ems (Next.js 15)                                  │
                        │  ChatStage / SimulationStage / ExecutionDock                    │
                        │  ← InferenceEvent stream via app/api/inference/route.ts (proxy)  │
                        │  ← rendered by @ethonline2026/ux-workflow (AgentTraceGroup…)     │
                        └───────────────▲───────────────────────────┬─────────────────────┘
             SSE (text/event-stream)    │                           │ POST /v1/… (approve)
                                        │                           ▼
┌───────────────────────────────────────┴──────────────────────────────────────────────────┐
│  apps/inferrence  —  Cloud Run service (control plane, Fastify, Node 22, min-instances=0) │
│                                                                                           │
│  api/            POST /v1/sessions · POST /v1/sessions/:id/turns (SSE) · GET /v1/sessions  │
│                  GET /v1/runs/:id/events?sinceSeq · POST /v1/…/intents/:id/approve         │
│  events/         InferenceEvent union  →  seq-numbered, replayable journal                 │
│  orchestrator/   Orchestrator · AgentPort(v01|deep|dry) · eventMapper → AgentStep          │
│  session/        SessionManager · RunRegistry(execution-domain RUN_STATES) · EventJournal   │
│  sandbox/        SandboxProvider ──► CloudRunSandboxProvider (gVisor, egress-deny)          │
│                                     └ LocalProcessSandboxProvider (dev/test, no net)        │
│  models/         ModelRegistry(Vertex role routing, context cache) · ForecastPort(TimesFM3) │
│  tools/          ToolRegistry (langchain factories + execution-placement policy)            │
│  web3/           SigningIntent standard · IntentBuilder · CustodySigningPort                │
│  approvals/      ApprovalQueue (HITL)                                                       │
│  runtime.ts      ONE composition root (globalThis-cached) · credentials → /tmp              │
└──────────────┬───────────────────────┬──────────────────────────┬────────────────────────┘
               │                       │                          │
     TimescaleDB (exec_* tables)   Vertex AI Gemini        timesfm3-inference (Cloud Run GPU)
     Session/Run/Event/Intent      parser/synthesis/tools  /predict · /predict/protocol
```

### 2.1 E2B → our mapping

`e2b-dev/runtime` (Go, Apache-2.0) is the reference architecture. Its structure maps
almost one-to-one:

| E2B component | `apps/inferrence` analogue | Status |
|---|---|---|
| Control-plane REST API (OpenAPI/Gin) | Cloud Run HTTP service, `/v1/*` + SSE | ✅ |
| Per-node orchestrator gRPC `SandboxService` (`Create/List/Delete/Pause/Checkpoint`) | `SandboxProvider` port | ✅ |
| Firecracker microVM per sandbox | Cloud Run sandbox (gVisor, in-instance, ephemeral tmpfs rootfs) | 🔶 |
| `envd` in-VM agent (Connect RPC: process + filesystem) | in-sandbox worker protocol (T4.4) | ⬜ |
| Templates = pre-booted VM snapshots | pre-baked sandbox template + warm pool (T4.5) | ⬜ |
| Snapshot/resume (userfaultfd + COW/NBD) | pause-on-idle + auto-resume; `fork` for parallel specialists | ⬜ |
| Control/data-plane split (data never traverses the API) | events stream from the run, not from session state | ✅ |
| Postgres + Redis + ClickHouse, scale-to-zero | TimescaleDB for durable state; Cloud Run `min-instances=0` | 🔶 |

### 2.2 The event contract is the seam

`src/events/contract.ts` defines one versioned discriminated union. Two properties are
enforced, not merely documented:

- `step.*` payloads **are** `AgentStep` from `@ethonline2026/ux-workflow`. `test/contract.test.ts`
  contains a compile-time assertion, so the day `ux-workflow` adds a required field the
  build breaks instead of the UI silently degrading.
- every event carries a monotonic `seq`, so a dropped connection resumes with
  `?sinceSeq=` (or `Last-Event-ID`) with no gaps and no duplicates.

Event types: `session.started`, `message.delta`, `message.completed`, `step.start`,
`step.update`, `step.completed`, `widget`, `approval.requested`, `approval.resolved`,
`run.completed`, `error`. `widget` carries the same payloads the mock's inline widgets
already render (`forecast`, `risk`, `yields`, `intent`, `execution`, `approvals`).

---

## 3. Locked design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Sandbox substrate | **Cloud Run sandboxes** (gVisor) | Cheapest path to isolated, scale-to-zero agent sessions; gVisor + ephemeral rootfs + egress-deny-by-default covers the requirement without operating KVM nodes. |
| Streaming | **SSE over POST** | The primary consumer is a Next.js app that needs deltas and per-step progress; `text/event-stream` works through a route-handler proxy with zero extra infra, and `seq` gives replay. |
| Primary consumer | **`apps/agentic-ems`** | The CLI (`scripts/smoke-sse.ts`) is for testing. The Next.js app talks over HTTP — it is a separate pnpm workspace root, so no workspace import is possible. |
| Model routing | **Vertex AI Gemini**, role-based (`parser`/`synthesis`/`tools`) | Already the only wired provider in `packages/langchain` (`modelRegistry`); no new provider dependency. |
| TimesFM | **Keep 3.0 now; migrate to 2.5 before production** | See the licence risk in §6. |
| Custody | **Produce intents; never hold a key** | The intent envelope lives in `packages/custody`; the signer is a port (`privy` / `local-key` / `ledger`). The default is `dry`, which proposes and cannot sign. |
| Ledger / Speculos | **Out of scope this pass** | `LedgerSignerAdapter` is kept and adapted to the signer port but unexercised; hardware testing is not on the critical path while a Privy server wallet can sign headlessly. |
| Persistence | `INFERENCE_PERSISTENCE=memory` by default; **no silent fallback** | Split from `INFERENCE_MODE` so "may we broadcast" and "where is state stored" are separate questions. In-memory state is per-instance, so `maxScale` is capped with it. |

---

## 4. Cost & downtime posture

Levers, each with a task that owns it:

- **Scale to zero** — `min-instances=0`, request-based billing, `cpu-throttling=true` (deploy yaml).
- **Concurrency, not instances** — `containerConcurrency: 8`; each instance hosts sandboxes that
  share its CPU/memory, so concurrency is also a sandbox-admission bound.
- **Vertex context caching** — 90% off cached input tokens; the stable system prompt and tool
  definitions must sit at the front of the request (T5.1).
- **Vertex batch/Flex** — ~50% off, async, for nightly forecast/backfill and eval (T5.4).
- **TimesFM serialisation** — the service is `--workers 1 --limit-concurrency 4`; dispatch is
  serialised and cached by `(target, metric, horizon)` (T5.2).
- **Sandbox idle policy** — pause-on-idle, auto-resume, hard TTL (T4.5).
- **Run budget** — per-run token/spend cap and `max-instances` (T3.4, T8.4).
- **Low downtime** — stateless instances; session/run/event state is DB-backed, never
  in-memory in `live`; graceful SIGTERM drain; idempotent runs; replayable streams (T8.5).

---

## 5. Roadmap

### P0 — Foundations & contracts
- ✅ **T0.1 Workspace wiring** — `apps/inferrence` added to `pnpm-workspace.yaml`; `build:inferrence` root script; turbo builds the `^build` graph.
- ✅ **T0.2 Package + toolchain** — `package.json`, `tsconfig.json` (strict, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), `vitest.config.ts`, `eslint.config.js`, `Dockerfile`, `cloudbuild.yaml`, `deploy/cloudrun.service.yaml`, `.env.example`.
- ✅ **T0.3 Event contract** — `events/contract.ts` + `events/emitter.ts`; zod-validated; monotonic `seq`; SSE framing; contract test asserts assignability to `AgentStep`.
- ✅ **T0.4 Error + health contract** — `apps/indexer`-compatible envelope with inference-specific codes (`SANDBOX_UNAVAILABLE`, `MODEL_UNAVAILABLE`, `DATABASE_UNAVAILABLE`, `VECTOR_UNAVAILABLE`, `ILLEGAL_TRANSITION`); `/health` reports per-dependency reachability and never leaks a raw message.
- ✅ **T0.5 Composition root + credentials** — `runtime.ts` cached on `globalThis`, lazy construction, `prepareVertexCredentials()` → `/tmp`, malformed key degrades to ADC.
- ✅ **T0.6 Offline test harness** — injected runtime + fakes; the whole suite runs with no DB, model or network.

### P1 — Session & durable state
- 🔶 **T1.1 SessionManager/Store** — port + `InMemorySessionStore` done; **TimescaleDB adapter over `SessionRepository` pending** (`createStores` throws in `live` until it exists).
- ✅ **T1.2 RunRegistry** — over the shared `execution-domain` state machine; `assertTransition` fires before any write; illegal moves map to 409 `ILLEGAL_TRANSITION`.
- 🔶 **T1.3 EventJournal** — port + in-memory ring done; **`exec_events` hypertable writer pending** (180-day retention already exists in `packages/timeseries`).
- 🔶 **T1.4 Auth/tenant scoping** — `Authenticator` port + `HeaderAuthenticator`; `assertDeployable` refuses `live` + header auth. **Privy token verification pending** (the seam is `apps/execution`'s existing pattern).

### P2 — HTTP control plane + SSE
- ✅ **T2.1 Fastify app** — `buildApp({runtime, authenticator})`, error handler, graceful shutdown.
- ✅ **T2.2 `POST /v1/sessions`** — 201 `{session}`.
- ✅ **T2.3 `POST /v1/sessions/:id/turns` → SSE** — `text/event-stream`, `x-inference-run-id`, heartbeats, `follow` flag, abort on client disconnect.
- ✅ **T2.4 Read routes** — `GET /v1/sessions/:id`, `GET /v1/runs/:id/events?sinceSeq=`, `GET /health`.
- 🔶 **T2.5 Backpressure + limits** — run limiter, bounded replay tail, output caps, `no-store`; **per-session max duration and byte-bounded buffers pending**.
- ⬜ **T2.6 Next.js proxy + client** — `apps/agentic-ems/app/api/inference/route.ts` streaming proxy + `lib/inference/{stream.ts,useInferenceStream.ts}` parsing frames into `AgentStep[]` + widget state.

### P3 — Real agent orchestration
- ⬜ **T3.1 AgentPort over `packages/langchain`** — wrap `runV01`, `buildV01Deps`, `DeepGraphAgent`, `dry`. (`LangchainAgentPort` exists and deliberately fails loudly today.)
- ✅ **T3.2 Mode router** — `v01` | `deep` | `dry`, same vocabulary as `apps/indexer`'s `POST /api/agent`; `dry` performs zero model calls.
- 🔶 **T3.3 Event mapper** — `buildAgentStep` + `compactArgs` done, with the rule "omit rather than synthesise"; **LangGraph node/deepagent tool-call → `AgentStep` mapping pending** (this is the single most important task in the roadmap).
- ⬜ **T3.4 Guardrails** — model-fallback chain reuse, per-attempt timeout, tool allowlist, per-run token/spend cap, secret redaction (`redactSecrets` exists and is applied to error text).

### P4 — Sandbox runtime (Cloud Run sandboxes, E2B-shaped)
- ✅ **T4.1 `SandboxProvider` port** — `create/exec/read/write/list/pause/resume/fork/destroy/healthy`, mirroring `SandboxService`; typed `SandboxNotFoundError`/`SandboxCapacityError`/`SandboxPathError`.
- 🔶 **T4.2 `CloudRunSandboxProvider`** — the adapter, the preview-API pin and egress policy are declared; **every method is an explicit `NotImplementedError` naming this task** until the preview API is wired and integration-tested on a live project.
- ✅ **T4.3 `LocalProcessSandboxProvider`** — confined root, wall-clock timeout, output caps, capacity bound, path-escape rejection; covered by `test/sandbox.test.ts` and used by the mock agent's sandbox round-trip.
- ⬜ **T4.4 In-sandbox worker ("envd" analogue)** — localhost JSON-RPC `exec/spawn/kill/read/write/list/stat`, `X-Access-Token` handshake, ordered stdout/stderr streaming.
- ⬜ **T4.5 Lifecycle policy** — one sandbox per session, pause-on-idle, auto-resume, warm pool from a pre-baked template, hard TTL, `fork` for parallel specialists.
- ⬜ **T4.6 Admission & accounting** — `maxSandboxes` per instance, CPU/mem admission, per-sandbox duration metrics.

### P5 — Models
- 🔶 **T5.1 ModelRegistry** — role→model routing + `/health` reporting done; **Vertex client construction, context caching and cache-hit surfacing pending**.
- 🔶 **T5.2 ForecastPort** — port + guardrail semantics documented; **`TimesFM3Client` adapter, serial dispatch and `(pool, metric, horizon)` cache pending**.
- ⬜ **T5.3 EmbeddingPort** — `VertexEmbeddingService` + `VectorRepository.searchTemporal` for retrieval evidence; `VECTOR_UNAVAILABLE` must degrade explicitly.
- ⬜ **T5.4 Batch/Flex path** — async Vertex batch for nightly forecast/backfill and eval; identical output shapes to the online path.
- ⬜ **T5.5 ⚠️ TimesFM 2.5 / licence migration (release gate)** — retarget to `google/timesfm-2.5` (Apache-2.0) or BigQuery `AI.FORECAST`; re-validate the 9-quantile mapping (median idx 4) and the guardrails. **Blocks production.**

### P6 — Tools & data
- ✅ **T6.1 ToolRegistry + placement policy** — `TOOL_GROUPS` is data: every group declares which `packages/langchain` factory provides it, whether it runs `in-process` or `sandbox`, and which modes may use it. Adapter construction pending.
- ⬜ **T6.2 Data ports** — The Graph (`@ethonline2026/graph-fno-indexer`), DefiLlama, `createRiskProfileReader`; degrade to typed states, never silent empties.
- ✅ **T6.3 Execution placement policy** — the sandbox surface is the minimum needed (`sandboxTools()` returns exactly one group), asserted by review rather than by hope.

### P7 — Web3 signing intents & approval
- ✅ **T7.1 ★ The signing-intent standard now lives in `packages/custody`** — `SigningIntentSchema` (version, ids, CAIP-2 chain, account, kind, scheme, ERC-7730-style `display`, `authorized {legs, calldata, nonce}`, `policy`, `provenance` incl. `langsmithTraceId`, sha256 `digest`) with a deterministic canonical digest and `verifySigningIntent`. Custody keeps its documented invariant of importing no other EMS package — the authorised payload is custody's own `SafeLeg[]`, not `execution-domain`'s `ExecutionStep`. This service re-exports it rather than defining a second one. *(Supersedes the earlier plan to put it in `execution-domain`.)*
- ✅ **T7.2 SafeClient.proposeIntent** — composes the proposal, the EIP-712 payload and the envelope in one call, so what is displayed, hashed and signed cannot drift. `buildSigningIntent` normalises through the schema **before** hashing (hashing the pre-parse draft produced an unreproducible digest — the scaffold bug is fixed and covered by tests).
- ✅ **T7.3 Signer port + Privy server wallet** — `SafeTypedDataSigner` (`kind: privy | local-key | ledger`) replaces the previously hard-coded Ledger-only union, so `SafeClient` can sign with any owner. `PrivyWalletSigner` signs EIP-712 via `@privy-io/node` (`wallets().ethereum().signTypedData`), `LocalKeySigner` is the gated dev/test path, and **`LedgerSignerAdapter` was adapted to the same port rather than deleted**. **Verified in production**: a deployed turn produces a real `safeTxHash` + `execTransaction` calldata, approving with no supplied signature makes the service sign with the Privy wallet, the signature recovers to the configured owner, and the run reaches `signed`.
- ✅ **T7.4 ApprovalQueue + HITL resume** — custody verifies the digest; a signature produced elsewhere is verified against the intent's own payload, and a signature from a different key is **rejected** (asserted in `e2e:signing`). Approvals are keyed by run, since custody stays app-agnostic. The signature is obtained *before* the approval is consumed, so a signing failure leaves the intent open instead of burning it.
- ⬜ **T7.5 Bridge/Arc ports** — `LiFiBridge` / `LayerZeroBridge` / `CircleCctpBridge` + `createArcClient` for quotes, `lzSend` options, CCTP attestation, ERC-8183 jobs.
- ⬜ **T7.6 CLI approval surface** — `scripts/smoke-sse.ts` runs a turn and prints the intent; **`--approve` wired to a real signer pending**.
- ⬜ **T7.7 `PolicyGate` before the custodian** — enforced locally today; a Privy **default-deny policy allowing `eth_signTypedData_v4`**, scoped by `ethereum_typed_data_domain` / `ethereum_typed_data_message`, is the server-side hard stop to author.

### P8 — Deployment, cost, observability
- ✅ **T8.1 Cloud Run deploy, gen1 — live and verified.** `inferrence` runs on **gen1** in `us-central1` (min 0, max 1, private, dedicated SA), built by `gcloud builds submit` because `--source .` cannot use a subdirectory Dockerfile. A deployed turn produces a real intent and a **real Privy signature** over the intent's own typed data, and the run reaches `signed`.
- 🔶 **T8.2 Secrets** — Secret Manager holds the LangSmith key and the Privy pair, referenced from the pipeline by name; the service-account key still materialises to `/tmp`.
- ✅ **T8.3 LangSmith traces + per-operation metrics — verified against the deployed service.** The production trace tree shows `custody.proposeIntent` tagged `chain=eip155:11155111` alongside the per-step runs, with feedback attached. Flush happens **before the SSE response closes**, because Cloud Run throttles CPU the moment it closes and a batch flushed afterwards is dropped.
- 🔶 **T8.4 Cost guardrails** — `max-instances` capped, `min-instances=0`, SSE closed on `run.completed`. Note the deployed revision currently runs **`--no-cpu-throttling`** (instance-based billing), applied while diagnosing the RPC stall; it is not required now that the RPC timeout is in place and should be reverted to request-based billing.
- ⬜ **T8.5 Low-downtime rollout** — rollout + rollback runbook; SIGTERM drain already flushes traces.
- 🔶 **T8.6 Build speed** — layer order fixed (manifests → install → packages → app) and a stable `:cache` tag added to `--cache-from`. The remaining cost is **image transfer**: the runtime image is ~1.5 GB, dominated by heavyweight production deps. A lean runtime needs a lockfile-aware prune (see the Dockerfile note), not file deletion.

### P8b — Sandbox separation (forced by gen1)
- 🔶 **RemoteSandboxProvider** — `SandboxProvider` over HTTP to the gen2 `sandbox-runner`, because **Cloud Run sandboxes require gen2 and the control plane is gen1**. Output is batched rather than streamed (incremental output needs T4.4). **Pending: the `apps/sandbox-runner` service itself.**
- ⬜ **T8b.2** `apps/sandbox-runner` (gen2) owning the Cloud Run sandbox API behind the same port.

### P9 — Next.js integration & mock retirement
- ⬜ **T9.1** Replace `apps/agentic-ems/lib/agent-traces.ts` with the stream adapter.
- ⬜ **T9.2** Replace `ChatStage.runScript()`'s keyword matcher with the real SSE stream.
- ⬜ **T9.3** Replace `lib/execution/adapter.ts::createSimulatedAdapter` with the live `ExecutionAdapter` (the interface already exists).
- ⬜ **T9.4** Replace `lib/execution/intent.ts::parseIntent`'s regex placeholder with the model tool-call emitting `IntentLeg[]`.
- ⬜ **T9.5** Retire `SimulationStage.tsx`'s `TOTAL_MS = 90_000` phase machine in favour of real run events; keep the renderers.
- ⬜ **T9.6** Keep fixtures only under a `demo:` flag; assert no fixture leaks into a live run.

**Suggested order:** T3.3 → T3.1 → T2.6 → T9.1/T9.2 (first real end-to-end) → T1.1/T1.3 → T4.2/T4.4/T4.5 → T5.2 → T7.1 → T7.3/T7.4 → T7.5 → T8.x → T5.5.

---

## 6. Release gates (must pass before "production")

1. **Licence-clean forecasts (T5.5).** TimesFM 3.0 pretrained weights are
   `timesfm-non-commercial-license-v1.0` — *"commercial or production use of the default
   pretrained weights is not permitted."* TimesFM 2.5 weights are Apache-2.0. Shipping 3.0
   to production is a licence violation.
2. **Sandbox adapter pinned and integration-tested (T4.2/T4.4).** Cloud Run sandboxes are
   Public Preview; the whole preview surface lives in one file, and it must be exercised
   against a live project, not just typechecked.
3. **No secret or raw transaction byte leaks.** No key material, SQL or connection string in
   any error envelope or event; `PolicyGate` and spend caps enforced server-side; `failed`
   runs are typed, never generic 500s.
4. **Every mock path retired or explicitly flagged (T9.1–T9.6).** No fixture may flow into a
   live run.
5. **Cost per completed run measured** on a soak test, under budget (T8.3/T8.4).

---

## 7. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| TimesFM 3.0 non-commercial weights | Blocks production | Gate 1 / T5.5: 2.5 Apache-2.0 or BigQuery `AI.FORECAST` |
| Cloud Run sandboxes Public Preview | Adapter churn | Everything behind `SandboxProvider`; `LocalProcess` fallback; version pinning (T4.2) |
| Ledger is WebHID-in-browser / node-hid-in-CLI | Split approval UX | T7.6; document both; the device screen is the only trusted display |
| Model cost / quota exhaustion | Budget + 429s | T3.4 + T5.1 + T8.4; batch; context caching |
| Contract drift UI ↔ service | Broken renders | One zod event contract; compile-time `AgentStep` assertion |
| TimescaleDB connection limits (free tier) | Connection exhaustion | `globalThis` pool cache + `TIMESERIES_DB_MAX_CONNECTIONS` (existing pattern) |
| Sandbox escape / egress | Security | gVisor + ephemeral rootfs + egress deny-by-default + no secrets mounted |
| No `packages/ledgers`; no intent standard existed in the repo | Ambiguous scope | Resolved: the envelope lives in `packages/custody` (T7.1), which keeps custody free of EMS imports |
| In-memory state in `live` mode | Lost audit trail | `createStores` throws in `live` instead of falling back silently |
| **viem's built-in chain RPC silently stalls from Cloud Run.** `createPublicClient` without an explicit URL uses viem's default (`11155111.rpc.thirdweb.com`), which answers cheap calls — so `/health` reported healthy — but hangs the heavier Safe-proposal path | A run stalls with **no error at all**; the SSE stream emits 19 events and then only heartbeats | Set `ETHEREUM_SEPOLIA_RPC_URL` explicitly, add a transport `timeout`, and **report the RPC host on `/health`** so the endpoint is never invisible again. Localised only by running the same image locally (5 s) vs Cloud Run (90 s) |
| **Secret Manager values created from a pipe include a trailing newline** | Privy rejects the app secret; the authorization key fails to decode — an unlogged 500 | Store with `tr -d '\n'`; compare local vs stored by **hash**, not by byte count (104 vs 105 is easy to miss) |
| **`--cache-from` with a versioned tag never hits** — `docker pull :v0.6.0` finds nothing, so every build was cold | Wasted ~9 min per deploy | A **stable `:cache` tag** as the cache source, pushed alongside the release tag |
| **`--cache-from` cannot reuse multi-stage intermediate layers** — only the final image's layers are pullable, so reordering alone does not make `deps`/`packages` stages cacheable across builds | The install layer is still rebuilt | Partially mitigated by the pull-cache step; the complete fix is buildx with `--cache-to type=registry,mode=max` |
| **A scrubbed 500 logged nothing.** The error handler returned a generic `INTERNAL` without recording the cause | Undebuggable production failures — exactly how the trailing-newline bug presented | `request.log.error({ err }, …)` before the wire response; a real defect found while debugging |
| **The Ledger DMK cannot be loaded by plain Node** — its ESM build does a directory import, so `node dist/src/main.js` crashed with `ERR_UNSUPPORTED_DIR_IMPORT` the moment custody was imported at runtime (the test suite passed under `tsx`, which tolerates it) | The service fails to boot; the Cloud Run deploy would have failed | Custody exposes `@ethonline2026/custody/ledger` and keeps DMK off the root barrel; `SafeClient` imports it type-only. Caught by booting the **built** artefact, not just by running tests |
| **Safe's `createTransaction` defaults `onlyCalls: true`** and throws on any DELEGATECALL leg — and `onlyCalls` sits beside `transactions`, not inside `options` | Batched v4 / MultiSend intents could not be built at all | `SafeClient` derives the flag from the legs. Found by running the custody e2e against a real chain, which is exactly why that e2e exists |
| Privy policies are default-deny and Safe smart-wallet creation is browser-only | No headless signing until dashboard work is done | Checklist printed by `scripts/e2e-privy.ts --check`; the Safe is created via `deploymentRequest()` with the server-wallet EOA as owner at threshold 1 |

---

## 8. Verification

**Offline (the scaffold's guarantee — no DB, model or network):**

```bash
pnpm install
pnpm --filter @ethonline2026/inferrence typecheck
pnpm --filter @ethonline2026/inferrence test
pnpm --filter @ethonline2026/inferrence lint
pnpm --filter @ethonline2026/inferrence build
```

Covered: every event variant round-trips; `step.*` is assignable to `AgentStep`; SSE
framing and replay; monotonic/gapless `seq`; emitter ordering, fan-out, bounded tail and
closed-run refusal; session lifecycle + tenant scoping; run-state machine guard
(`ranked → confirmed` rejected); sandbox create/write/exec/read/list/pause/destroy, path
escape, capacity, timeout; signing-intent determinism, key-order independence, tamper
detection; approval queue requiring a device signature and rejecting double resolution;
the full turn (`session.started → … → run.completed`, ending `awaiting_user`, one intent
queued, one real sandbox round-trip); journal replay; capacity bound; typed failure for
an unwired agent; the whole HTTP surface through `app.inject` including the SSE body.

**CLI (secondary consumer):**

```bash
pnpm --filter @ethonline2026/inferrence start          # terminal 1
pnpm --filter @ethonline2026/inferrence smoke -- --query "rebalance into the best 30d yield" --follow
```

**Live (opt-in, gated):**

```bash
INFERENCE_MODE=live SANDBOX_PROVIDER=cloudrun pnpm --filter @ethonline2026/inferrence test
docker build -f apps/inferrence/Dockerfile -t inferrence:local .
gcloud builds submit --config apps/inferrence/cloudbuild.yaml --substitutions=_IMAGE=…
```

**Next.js integration (T2.6):**

```bash
pnpm --filter agentic-ems dev   # INFERENCE_SERVICE_URL=http://localhost:8080
```

Expected: a chat turn renders a live `AgentTraceGroup` with real reasoning/evidence, a
`ForecastChart` from TimesFM-3, and — on an execution query — an `IntentReview` bound to a
`SigningIntent` whose `digest` matches the `CustodyLog` entry.

---

## 9. Current status

**Deployed and working end to end on Cloud Run (gen1).** A turn produces a real Safe proposal — real
`safeTxHash`, real `execTransaction` calldata — through `packages/custody`; approving it *without* a
signature makes the service sign with its **Privy server wallet**, the signature is verified to
recover to the configured owner, and the run advances to `signed`. LangSmith traces from the
deployed revision land in the EU project with per-operation children, tags and feedback.

Verified: 46 inferrence tests + 69 custody tests, typecheck/lint/build, a local Docker image that
boots and serves `/health`, and a `docker run` of the *same production image* completing the
proposal in 5 s.

What remains: the gen2 `sandbox-runner` (`SANDBOX_PROVIDER=remote`), TimescaleDB persistence
(`INFERENCE_PERSISTENCE=timescale`), wiring the real `runV01`/deepagents agent in place of the mock,
the Bridge/Arc tool ports, and the build-size prune noted in the Dockerfile.
