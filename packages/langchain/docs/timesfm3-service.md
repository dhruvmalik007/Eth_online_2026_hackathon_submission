# TimesFM-3 Inference Service — Deployed Contract

> Discovered 2026-09-10 via `gcloud` (build `0b14f0f4` + live probes).
> This is the pinned contract for `packages/langchain/src/services/timesfm3/`.

## Service

| | |
|---|---|
| Cloud Run service | `timesfm3-inference` (us-central1) |
| URL | `https://timesfm3-inference-887606357212.us-central1.run.app` |
| Image | `us-central1-docker.pkg.dev/ultimate3dreconstructionstack/timesfm-repo/timesfm3` |
| Build | Cloud Build `0b14f0f4` (2026-09-02, 15m16s, SUCCESS) |
| Base image | `pytorch/pytorch:2.4.0-cuda12.4-cudnn9-runtime`, torch ≥ 2.6 (cu124) |
| Runtime | FastAPI + uvicorn, `--workers 1 --limit-concurrency 4`, keep-alive 300s |
| Device | **CUDA GPU** (health: `device: cuda, gpu_available: true`) |
| Model | `google/timesfm-3.0-pytorch` via `timesfm==3.0.1` (PyPI), snapshot pre-baked |
| Serving deps | transformers 5.16.1, **peft 0.20** (LoRA fine-tuning provisioned), accelerate |

## Model capabilities (`GET /model/info`)

- TimesFM 3.0, 330M params — "Stacked Mixing Transformer with Variate Attention"
- context_length **16384**, max_horizon **1024**
- 9 quantile levels (0.1–0.9, **median at index 4**)
- `multivariate: true`, `covariates: true`

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | liveness + model + device |
| `GET /model/info` | capabilities (above) |
| `GET /metrics` | prometheus |
| `POST /predict` | raw series → forecast |
| `POST /predict/batch` | multi-series |
| `POST /predict/protocol` | **DeFiLlama-integrated**: forecast by protocol slug |
| `POST /finetune` + `GET /finetune/status` + `GET /finetune/jobs` | LoRA fine-tuning jobs |

### `POST /predict` request

```jsonc
{
  "series": number[],                    // required, historical values
  "horizon": 30,                         // 1..1024, default 30
  "past_covariates": number[][] | null,  // [num_cov][context_len]
  "future_covariates": number[][] | null,// [num_cov][context_len + horizon]
  "return_quantiles": true               // default true
}
```

### `POST /predict` response (verified live)

```jsonc
{
  "point_forecast": number[h],   // median path
  "quantiles": number[h][9],     // per-step, levels = quantile_levels (q10..q90, median idx 4)
  "quantile_levels": number[9],
  "horizon": number,
  "model": "timesfm-3.0",
  "latency_ms": 153.7            // observed ~150ms on GPU
}
```

### `POST /predict/protocol` request (DeFiLlama integrated)

```jsonc
{
  "protocol_slug": "morpho",  // e.g. "morpho", "aave-v3"
  "horizon": 30,              // 1..365
  "metric": "tvl"             // "tvl" | "apy" | "volume"
}
```

## Notes for the v0.1 integration

- Quantile mapping to the `ForecastPoint` contract: q10 = index 0, q50 = index 4
  (= `point_forecast`), q90 = index 8.
- `future_covariates` width is `context_len + horizon` (lookahead strategy) —
  the EMS feeds known schedules (fee-tier changes, emissions) here.
- Service is single-worker with concurrency 4: batch per pool per cycle, cache
  by (pool, horizon) — never parallel-spam (standing serial-dispatch rule).
- `/finetune/*` is the v0.2 fine-tuning hook (LoRA on collected series) — out
  of scope for v0.1 tooling but the transport client reserves the paths.
