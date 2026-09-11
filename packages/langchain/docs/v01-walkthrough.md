# LangChain v0.1 — Verification Walkthrough

> Follows the standing two-level discipline: **Level A** = LLM-free module
> verification; **Level B** = full agent trace evaluation. Every command below
> was run and its output verified before being committed (verbatim-execution
> rule). Snippets are exact.

---

## Level A — LLM-free modules (no model calls, no spend)

```bash
cd packages/langchain
pnpm probe:levelA-v01
```

Expected output (verified 2026-09-10):

```
Level-A: v0.1 agent modules (LLM-free)
  ✅ predict: 3 steps, 9-quantile mapped
  ✅ predict: median == point_forecast
  ✅ predict: monotonic + not suspicious
  ✅ predict: provenance recorded
  ✅ guardrail: non-monotonic wire rejected
  ✅ backtest: hit-rate 1.0 inside bands
  ✅ backtest: mape tiny on sane fixture
  ✅ authorization: approved in dry mode
  ✅ authorization: notional capped at 100% × portfolio
  ✅ authorization: citations carried
  ✅ authorization: uncited + failed-gate proposal rejected

Level-A probe PASSED (LLM-free v0.1 modules verified)
```

What this proves without any model call:

1. **TimesFM-3 wire contract** — the client maps the deployed service's
   9-quantile response (`median at index 4`) onto per-step q10/q50/q90 and
   rejects non-monotonic drift with `TimesFM3ValidationError`.
2. **Backtest scoring** — band hit-rate and MAPE compute deterministically.
3. **Execution authorization** — proposals authorize only with backtest
   evidence and citations; scopes carry notional caps (allocation% ×
   portfolio USD) and session expiry.

## Offline suites

```bash
pnpm turbo run build typecheck test \
  --filter=@ethonline2026/graph-fno-indexer \
  --filter=@ethonline2026/langchain-agent \
  --filter=@ethonline2026/timeseries
```

All green: 38 (the-graph) + 95+ (langchain) + 7 (timeseries) tests, including:

- `test/graph/v01Guardrails.test.ts` — hand-computed golden values for
  `quantilesToRisk` and every guardrail (monotonicity, k·σ sanity, citation
  trace-check, amount-sum, risk gate)
- `test/graph/v01Flow.test.ts` — the full 5-node cycle offline: canned
  TimescaleDB window → canned TimesFM-3 forecast → scripted LLM (grounded) →
  HOLD decision; plus the bounded re-plan path (uncited synthesis ⇒ one
  re-plan cycle, `synthesisRuns = 2`)
- `test/services/timesfm3.test.ts` — wire-shape drift (non-monotonic,
  row-count mismatch) rejected with typed errors

## Level B — full agent trace evaluation

```bash
# requires GOOGLE_CLOUD_PROJECT + GATEWAY_API_KEY in .env
pnpm --filter @ethonline2026/langchain-agent probe:levelB
```

Asserts on the tool-call trace (never the prose): zero Graph-backed calls ⇒
hallucination; tool arguments must carry the trader's stated constraints.
The v0.1 graph adds one more Level-B criterion: every numeric claim in the
final report carries a `proj-*` / `c-*` citation id.

## The v0.1 agent cycle (5 nodes, offline-capable)

```
runV01({
  mandate: 'Assess the APY path and propose a reallocation',
  protocols: ['aave-v3', 'uniswap-v4', 'rocket-pool', 'morpho'],
  poolIds:   ['<pool-id-from-the-graph>'],
  horizonDays: 30,
})
```

Data flow per docs/timeseries-model-architecture.md:

| Node | Model | Input → Output |
|---|---|---|
| 1. ingestion | — | corpus + tsdb → Category A rules + Category B vectors |
| 2. ruleParsing | LLM (parser role) | rule text → `ConstraintSchema[]` (zod, 1 re-ask) |
| 3. yieldPrediction | TimesFM-3 | 90-day windows → 14–30d quantile matrices |
| 4. synthesis | LLM (synthesis role) | constraints + projections + pre-computed risk → violations/alpha |
| 5. readjustment | LLM (synthesis role) | synthesis → execution matrix (Σ=100, citations, no calldata) |

Guardrails run client-side (TimesFM shape) and deterministically (citation
trace, amount sum, k·σ scale) — breaches force HOLD + one bounded re-plan
cycle (`synthesisRuns ≤ 2`).
