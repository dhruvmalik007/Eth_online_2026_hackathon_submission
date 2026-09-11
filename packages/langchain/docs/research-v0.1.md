# LangChain v0.1 — Research Round (T3)

> Date: 2026-09-10 · Sources: skills registry (`npx skills find`), Google
> Research blog, Hugging Face, GitHub, live service probes.

## 1. TimesFM-3 (the deployed TSFM)

**Verdict: primary forecasting model, consumed as the deployed GCP microservice.**

- Released Aug 31 2026 (Google Research). 330M params; native **multivariate**
  targets; **past covariates** + **past-future (dynamic) covariates**
  ("lookahead" token strategy); **9 quantiles (q10–q90)**; **non-autoregressive
  single-pass decode** (Contiguous Patch Masking) — one forward pass for the
  whole horizon; 32-step patches; per-series normalization; zero-shot SOTA on
  GIFT-Eval / FEV-Bench / TIME leaderboards.
- Our deployment (`timesfm3-inference`, Cloud Run us-central1, CUDA GPU):
  `timesfm==3.0.1` + `google/timesfm-3.0-pytorch`, context 16384, max horizon
  1024, ~150ms latency, `peft` installed (LoRA-ready), purpose-built
  `/predict/protocol` (DeFiLlama-integrated) and `/finetune/*` endpoints.
  Full contract: `docs/timesfm3-service.md`.
- Implication for the agent: forecasts are **deterministic tool output** — the
  LLM interprets quantile matrices, never invents them. Guardrails (schema,
  monotonicity, scale-sanity, provenance) validate before state.

## 2. Skills verdicts (installed → `.agents/skills/`)

| Skill | Verdict |
|---|---|
| `huggingface/skills@huggingface-best` (official, 1.4K installs) | **Adopt** — model-selection methodology (benchmark leaderboards, device/param budgets) for the model registry's family choice and the fine-tuning track's base-model decisions. |
| `aj-geddes/useful-ai-prompts@time series analysis` (578) | **Adopt as methods reference** — classical decomposition/stationarity/ACF patterns feed the deterministic fallback baseline (`realizedVolFromHourlyCloses`) and the k·σ scale-sanity guardrail math. Not a replacement for TimesFM-3. |
| `nvidia/skills@tao-finetune-huggingface-model`, `huggingface/skills@trl-training` | **Deferred to v0.2** — TRL targets LLM chat fine-tuning; our fine-tuning track is TimesFM-3 LoRA via the container's own `/finetune/*` endpoints (peft installed there). No new dependency needed in v0.1. |

## 3. Time-series store

**TimescaleDB (Postgres extension) selected** — matches the in-repo contracts
(`ux-workflow` observability/fine-tuning panels reference TimescaleDB), gives
hypertables + native time-series SQL windows, and reuses Postgres tooling.
The spoken "Timescale MySQL" is interpreted as TimescaleDB (the repo's own
components name it); no MySQL dependency is introduced.

## 4. Multi-model layer

- Reasoning LLM stays **registry-driven** (`initChatModel`): default
  `google-vertexai:gemini-2.5-flash-lite` + existing fallback chain; other
  families (OpenAI/Anthropic/etc.) plug in via env without code changes.
- Division of labor per the user architecture doc: **LLM = rules parsing,
  synthesis, readjustment reasoning; TimesFM-3 = all numeric forecasting;
  LangGraph = state + orchestration; deepagents = tool-calling harness.**

## 5. Fine-tuning track (v0.2 hook)

`/finetune`, `/finetune/status`, `/finetune/jobs` exist on the container with
peft installed → LoRA fine-tuning of TimesFM-3 on our collected
DeFi/TradFi series is a service-side job, not a package dependency. v0.1
reserves the client paths + a `ModelRegistry` entry; training runs are out of
scope for v0.1.
