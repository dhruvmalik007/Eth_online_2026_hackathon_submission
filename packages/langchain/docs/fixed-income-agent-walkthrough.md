# Walkthrough — Testing The Graph Endpoints & Running Fixed-Income Strategies with the LangChain Agent

> Companion to `archive/fixed-income-strategies-research.md` (DualPool hook research) and
> `PHASE1_TEST_RESULTS.md` (verified endpoints).
> Scope: (1) how to test every subgraph endpoint, (2) how to prove the agent actually
> fetches Graph data and reasons over risk parameters, (3) the math — dual-yield APY and
> **vega for v4 concentrated-LP + dual-hook books** — and (4) how to make the agent
> produce an APR-constrained, risk-minimized strategy as a structured Markdown report.

---

## 0. Architecture Recap — Who Talks to Whom

```
Fixed-income trader (you)
   │  natural-language prompt (APR target, risk budget, size)
   ▼
DeepGraphAgent  (deepagents harness + Vertex AI Gemini)
   │  LangChain tool calls (the agent CHOOSES these; each call hits The Graph)
   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ v4TopPools        → Uniswap v4 subgraph (volume-ordered venues)          │
│ v4HookedPools     → v4 subgraph, hooks_not: zero (DualPool-style books)  │
│ v4PoolHourData    → hourly closes → realized vol σ, fee series           │
│ v4PoolDayData     → daily fees/TVL → feeAPY                              │
│ v4Swaps           → flow direction, order size tolerance                 │
│ getLendingReserves→ Aave V3 subgraph → lending leg r_l (idle capital)   │
│ computeFixedIncomeMetrics / runStressTest → Greeks, VaR, scenarios      │
└──────────────────────────────────────────────────────────────────────────┘
   │
   ▼
gateway.thegraph.com  (GATEWAY_API_KEY auth, decentralized network)
```

Key verified facts (2026-09-07) this walkthrough builds on:

| Fact | Value |
|---|---|
| v4 mainnet subgraph | `DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G` |
| Top venue by volume | USDC/USDT `0x8aa4e11c…` — **$505.5B cumulative**, 953K txs |
| ETH/USDC daily volume | $2.3M / $4.2M / $2.7M (recent days) |
| Top hooked book | USDC/WETH, hook `0x0000000aa232009084bd71a5797d089aa4edfad4`, feeTier **8388608 = dynamic (hook-set)**, $1.93B cumulative |
| Aave V3 ETH supply APY | ~2-6% on stables (live via `Cd2gEDVeqnjBn1hSeqFMitw8Q1iiyV9FYUZkLNRcL87g`) |
| v4 TVL quirk | can go **negative** on flash-heavy pools — always rank by `volumeUSD` |

---

## Part 1 — Testing the Endpoints (3 Escalating Tiers)

### Tier 1: Raw `curl` — does the deployment answer at all?

Fastest possible check against the decentralized network. Substitute your key:

```bash
export GK=7583de8df55d3495c1681e8f6668dc3f   # example — use your own GATEWAY_API_KEY

# 1. Health: block height + indexing errors (works on EVERY subgraph)
curl -s -X POST "https://gateway.thegraph.com/api/$GK/subgraphs/id/DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ _meta { block { number timestamp } hasIndexingErrors deployment } }"}'

# 2. Protocol-level aggregate (v4 PoolManager singleton, same address on all chains)
curl -s -X POST "https://gateway.thegraph.com/api/$GK/subgraphs/id/DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ poolManager(id: \"0x000000000004444c5dc75cb358380d2e3de08a90\") { poolCount txCount totalVolumeUSD } }"}'

# 3. Real venues — VOLUME-ordered (NOT TVL; see Part 3 quirk box)
curl -s -X POST "https://gateway.thegraph.com/api/$GK/subgraphs/id/DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ pools(first: 5, orderBy: volumeUSD, orderDirection: desc) { id token0 { symbol } token1 { symbol } volumeUSD txCount hooks } }"}'

# 4. Hooked books only
curl -s -X POST "https://gateway.thegraph.com/api/$GK/subgraphs/id/DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ pools(first: 5, orderBy: volumeUSD, orderDirection: desc, where: { hooks_not: \"0x0000000000000000000000000000000000000000\" }) { id token0 { symbol } token1 { symbol } hook  volumeUSD feeTier } }"}'

# 5. Lending leg (Aave V3 Ethereum reserves → supply APY in RAY, /1e27 → %)
curl -s -X POST "https://gateway.thegraph.com/api/$GK/subgraphs/id/Cd2gEDVeqnjBn1hSeqFMitw8Q1iiyV9FYUZkLNRcL87g" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ reserves(first: 3, where: { symbolIn: [\"USDC\",\"USDT\"] }) { symbol liquidityRate variableBorrowRate utilizationRate } }"}'
```

**What "pass" looks like:** `_meta.hasIndexingErrors=false`, block timestamp within
~30s of now, and volume figures in the $B scale for the majors. If a query errors with
`Type X has no field Y`, the schema drifted — introspect:
`{ __type(name: "Pool") { fields { name } } }`.

### Tier 2: The package CLIs — do our wrappers resolve the right fields?

```bash
# the-graph package: registry + per-category extraction probe
cd packages/the-graph
pnpm cli health                         # _meta on every configured endpoint
pnpm cli list-protocols                 # registry: name / protocol / network / tier
pnpm cli test-data --category lending   # Aave reserves: TVL + APYs parsed from RAY
pnpm cli test-data --category dex       # Uniswap V3 pools: TVL + volume
pnpm cli test-data --category prediction# Polymarket: conditions + redemption payouts

# langchain package: v4 tool-level probe (no LLM involved)
cd ../langchain
pnpm cli health
pnpm cli analyze        # full risk pipeline through the DeepGraphAgent (LLM)
```

**What "pass" looks like:** categories resolve to the expected subgraph IDs printed in
`list-protocols`, and `test-data` prints parsed human-readable numbers (e.g.
`varBorrowRate=3.50%` — proof the RAY→percent conversion path works).

### Tier 3: `vitest` — regression-proof the endpoints

```bash
pnpm test                                # both packages: unit + live e2e
```

The suite asserts against **live** data (see
`packages/langchain/test/e2e/fixedIncomeTrader.e2e.test.ts`):

```ts
// Volume ordering must return pools with real trading activity ($M+ cumulative)
expect(parseFloat(top.pools[0].volumeUSD)).toBeGreaterThan(1_000_000);
// Hooked pools: non-zero hook address + leaderboard present
expect(hooked.pools[0].hook).not.toBe('0x0000000000000000000000000000000000000000');
expect(hooked.hookLeaderboard.length).toBeGreaterThan(0);
```

---

## Part 2 — Proving the Agent Fetches Graph Data & Reasons Over Risk

There are four escalation levels, from deterministic to fully agentic.

### Level A — Invoke a tool directly (no LLM): deterministic truth

The tool IS the data path. If this works, the agent's data supply works.

```bash
cd packages/langchain
pnpm probe:levelA
```

The probe (`scripts/levelA-tool-probe.ts`) invokes three tools with **no LLM** and asserts
on the results — top venues by volume ($M+ scale), hooked books with non-zero hooks, and
the `calc_vega` golden value (−1.0 pp/vol-pt ⇒ −$100k/yr on $10M):

```
── v4TopPools (volume-ordered, no LLM) ──
  USDC/USDT    volumeUSD=$505,541,275,575  hook=none
── v4HookedPools (top hooked books) ──
  USDC/WETH    hook=0x0000000aa232009084bd71a5797d089aa4edfad4  dynamicFee=true  volumeUSD=$1,934,942,319
── calc_vega (golden: −1.0) ──
  vegaPctPerVolPoint=-1  usdPerVolPoint=-100000
Level A: PASS — tools fetch real Graph data and the math table holds.
```

Record the output (the `PHASE1_TEST_RESULTS.md` numbers) and you can now audit any agent
answer against it.

> **Why not `pnpm tsx -e '<inline>'`?** `tsx -e` evaluates the string as CJS (no file
> context, so the package's `"type": "module"` does not apply) and esbuild rejects
> top-level `await` in CJS. If you need a one-off inline, wrap it in an async IIFE:
>
> ```bash
> pnpm tsx -e '(async () => {
>   const { createUniswapV4Tools } = await import("./src/tools/uniswapv4/UniswapV4Tools.js");
>   const { loadEnv } = await import("./src/config/env.js");
>   const { tools } = createUniswapV4Tools({ gatewayApiKey: process.env.GATEWAY_API_KEY, subgraphId: loadEnv().UNISWAP_V4_SUBGRAPH_ID });
>   console.log(await tools.find(t => t.name === "v4TopPools").invoke({ first: 3 }));
> })().catch(e => { console.error(e); process.exit(1); });'
> ```
>
> A real `.ts` file inside a `type: module` package is transformed as ESM — which is why
> the committed probe script is the canonical form.

### Level B — Inspect the agent's tool-call trace

`agent.invoke()` returns the full message history. Every Graph hit appears as a
`tool_call` message; every response as a `tool` message. Assert on the trace, not the prose:

```bash
cd packages/langchain
pnpm probe:levelB        # agent invocation + trace evaluation (needs LangSmith env, see Level C)
```

The probe (`scripts/levelB-trace-probe.ts`) runs a real agent query and asserts on the
returned message history — not the prose:

```
── Trace evaluation ──
  latency: 7.8s
  tool calls: 1 (v4TopPools)
    → v4TopPools {"first":2}
Level B: PASS — the agent fetched Graph data via real tool calls (trace-verified).
```

If `toolCalls` is empty but the answer looks confident → the agent hallucinated. This is
the single most important assertion in the whole walkthrough.

Known pitfall (fixed in `DeepGraphAgent.initialize`): the default model must be a
**directly constructed `ChatVertexAI`** (`model: VERTEX_AI_MODEL`, `temperature`,
`maxRetries: 6`) — NOT a `'google-genai:…'` string (that provider package is not
installed → `initChatModel` throws "Unable to import @langchain/google-genai"), and NOT a
bare `google-vertexai:` string without retries (transient Vertex 429/5xx reject with a
non-standard error object → the cryptic `Cannot read properties of undefined (reading
'message')`). If you pass a string config, the provider prefix must match an installed
package.

### Level C — LangSmith tracing (EU region) + the `langsmith` CLI

Install the skills + CLI (per `.agents/skills/langsmith-trace`):

```bash
npx skills add langchain-ai/langsmith-skills --skill '*' --yes          # skills (local)
curl -sSL https://raw.githubusercontent.com/langchain-ai/langsmith-cli/main/scripts/install.sh | sh
```

For LangChain OSS apps tracing is **automatic** once these env vars are set
(`packages/langchain/.env`):

```bash
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com   # ⚠️ EU accounts: US endpoint → 403 Forbidden
LANGSMITH_ORG_ID=<org-uuid>
LANGSMITH_WORKSPACE_ID=<workspace-uuid>
LANGSMITH_API_KEY=lsv2_pt_…
# LANGSMITH_PROJECT=…  (leave unset to auto-create on first trace)
```

Hard-won debugging notes (both bit us):
- **403 Forbidden with a valid key = wrong region.** EU keys against
  `api.smith.langchain.com` (US) 403 on every endpoint, including `GET /api/v1/workspaces/`.
  Set `LANGSMITH_ENDPOINT` to the EU host.
- **The CLI needs the same region/workspace**: export `LANGSMITH_ENDPOINT` +
  `LANGSMITH_WORKSPACE_ID` (and pass `--api-key`) before `langsmith …` commands.

Verify the trace landed (Level C):

```bash
export LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com
export LANGSMITH_WORKSPACE_ID=<workspace-uuid>

langsmith project list --api-key $LANGSMITH_API_KEY
langsmith trace list --project ethonline2026-fixed-income --limit 1 --show-hierarchy --api-key $LANGSMITH_API_KEY
```

Expected hierarchy — full agent tree with every LLM call and Graph-backed tool call:

```
LangGraph (chain)
├── model_request (chain)
│   ├── ChatVertexAI (llm)
├── tools (chain)
│   └── v4TopPools (tool)        ← the Graph hit, visible in the dashboard
└── tools (chain)
    └── subgraphHealth (tool)
```

Or the full UI at `https://eu.smith.langchain.com` → project → trace.

### Level D — The live e2e (already in-repo, extend it per strategy)

`pnpm test` runs `fixedIncomeTrader.e2e.test.ts`: a real Vertex AI agent must (1) load
the v4 client, (2) return $M+ volume pools with hooked-pool leaderboard, (3) reason
end-to-end about a $25M stablecoin deployment. Pattern to copy for every new strategy:
**assert on data provenance first, prose second.**

### Risk-parameter queries — how to check "did it reason over MY risk params?"

Encode the trader's parameters in the prompt, then assert they surface in the tool
schema inputs. Example: "APR ≥ 6%, vega budget 0.5% of notional per vol point, $10M
size". The agent must call `v4PoolHourData` (to get σ) and the strategy tool with
`minApr: 6`. In the trace: `tc.function.arguments` is a JSON string —
`JSON.parse(tc.function.arguments).minApr === 6`. If the agent ignores a constraint,
tighten the system prompt (Part 4.3) — models drift, so keep this assertion in the e2e.

---

## Part 3 — The Math: Dual-Yield APY & Vega for v4 Dual-Hook Books

This is the quantitative core. It mirrors the DualPool hook mechanics from the research
note: idle capital is swept to a lending vault (Spark-style), so an LP earns
**trading fees + lending yield**, and pays **rebalancing cost** (LVR) that scales with
volatility². Vega falls straight out of that decomposition.

### 3.0 Notation (per pool *i*, per trader position of notional N_i)

| Symbol | Meaning | Source (tool) |
|---|---|---|
| `σ_i` | annualized realized vol of pair i | `v4PoolHourData` → log-returns of hourly closes, `σ = √(24·365·var(r))` |
| `L_i` | capital-efficiency (range leverage) of the LP position | trader input (L=1 full range; ±5% stable band ≈ 20-50) |
| `f_i` | annualized fee yield of pool i | `v4PoolDayData`: `f_i = (feesUSD_24h / tvlUSD) · 365` |
| `w_i` | idle fraction swept to the hook's lending vault | hook config; unhooked pool ⇒ w=0 |
| `r_i` | lending APY on the idle leg (Aave V3 / Spark) | `getLendingReserves` (RAY/1e27 → %) |
| `g_i` | gas + ops drag (USD/yr / N_i) | trader estimate |

### 3.1 Dual-yield APY (the fixed-income engine of the hook)

$$
\text{APY}_i \;=\; \underbrace{(1-w_i)\,f_i(\sigma_i)}_{\text{trading fees on active capital}} \;+\; \underbrace{w_i\, r_i}_{\text{lending yield on idle capital}} \;-\; \underbrace{\tfrac{L_i^2\,\sigma_i^2}{8}}_{\text{LVR: rebalancing cost}} \;-\; g_i
$$

Two empirically important refinements:

1. **Fee-yield vol sensitivity.** Volume — hence fees — co-moves with vol:
   `f_i(σ) ≈ k_i · σ` (fit `k_i = d f_i / d σ` by regressing the last 30 daily
   `feesUSD/tvlUSD` against daily realized vol — both available from `v4PoolDayData`).
   Substituting gives a *net* vega below that can be positive for quiet books.
2. **The LVR term.** Milionis–Moallemi–Roughgarden: a full-range LP loses
   `σ²/8` per year vs. just holding the fee-accruing rebalanced portfolio; a
   concentrated position with capital efficiency L multiplies that by `L²`
   (same exposure with less inventory ⇒ same fees on N but quadratic rebalancing cost).
   **This is the fixed-income "credit spread" of an LP book** — the predictable
   bleed you are being paid to bear.

> **Quirk box — why volume, never TVL, ranks v4 books.** `totalValueLockedUSD` on the
> v4 subgraph can be *negative* (flash accounting) and TVL ordering surfaces
> vault-receipt pools (ETH/1xETH, $2.3T "TVL", zero volume, no hourly series). Rank by
> `volumeUSD`; require a nonzero `poolHourData` series before trusting σ.

### 3.2 Vega — the formula you asked for

Vega is the sensitivity of the strategy's annualized yield (or P&L) to volatility.
Differentiate 3.1 (with `f = k·σ`) with respect to σ:

$$
\boxed{\;\mathcal{V}_i \;=\; \frac{\partial\,\text{APY}_i}{\partial\,\sigma_i}
\;=\; k_i \;-\; \frac{L_i^2\,\sigma_i}{4}\;}
\qquad\text{(per unit of }\sigma\text{; multiply by }10^{-2}\text{ per vol point)}
$$

Dollar vega on notional N_i (what a trader quotes):

$$
\text{Vega}^{\$}_i \;=\; N_i\cdot\mathcal{V}_i\cdot 10^{-2}
\quad\text{[USD per +1 percentage point of annualized vol]}
$$

Interpretation & worked example (USDC/WETH hooked book, σ=0.40, L=4, k=0.6):

- LVR cost today: `L²σ²/8 = 16·0.16/8 = 0.32` → **32%/yr** rebalancing bleed — you must
  be paid `f + w·r > 32%` or the book is negative-carry.
- Vega: `k − L²σ/4 = 0.6 − 16·0.4/4 = 0.6 − 1.6 = −1.0`
  → each **+1 vol point** costs **1.0% of notional per year**
  (`N=$10M ⇒ −$100k/yr per vol point`). The `k` term is why hooked stable books
  (σ≈0.02) are nearly vega-flat while ETH books are strongly short-vol.
- Second order (volga): `∂²APY/∂σ² = −L²/4 < 0` — bleed accelerates quadratically in σ;
  this is what `runStressTest`'s vol scenarios exploit.

Sanity check via the σ² term directly: at σ=40%, APY ≈ −32%+fees; at σ=41%:
LVR = 16·0.1681/8 = 33.62% → Δ = −1.62pp ≈ vega × Δσ = 1.0 × 1.6pp ✓ (the small gap is
the convexity term — expected).

### 3.3 Strategy construction — APR target, vega budget, min-risk books

Trader requirement: *"APR ≥ A*, *vega budget B* (pp of notional per vol point), minimize risk."*

Per-book **Fixed-Income Efficiency Ratio** (yield per unit of vol bleed):

$$
\eta_i \;=\; \frac{\text{APY}_i}{\text{LVR}_i} \;=\; \frac{8\,\text{APY}_i}{L_i^2\,\sigma_i^2}, \qquad \mathcal{V}_i \le B
$$

Allocation (closed form, no solver needed — the agent can compute it inline):

1. Filter: `APY_i ≥ A` **and** `|𝒱_i| ≤ B` **and** σ-series exists **and** volume ≥ $1M.
2. Weight inversely to vega-burden: `ũ_i = APY_i / (L_i²σ_i²/8) = η_i`, `w_i = ũ_i / Σ ũ_j`.
   (Inverse-variance-flavored: the least vol-fragile books get the most capital — exactly
   "keep risk as low as possible".)
3. Report achieved `APY_portfolio = Σ w_i·APY_i`, `Vega_portfolio = Σ w_i·𝒱_i`, and the
   concentration `max w_i` (flag > 50%).
4. Stress: re-run APY_i at σ×1.5 and σ×2 (`runStressTest` scenarios) — the portfolio
   must stay ≥ 0 net APY in the σ×1.5 case to be called "fixed income".

For the dual-hook composition specifically: the lending leg `r_i` is fetched live from
the Aave V3 subgraph (`getLendingReserves`, network = pool's chain); a hook→vault map in
config lets you substitute Spark's rate when a book sweeps to Spark rather than Aave —
the math is unchanged, only `r_i`'s source.

---

## Part 4 — Implementation: Making the Agent Do All of This

### 4.0 Quant architecture — two complementary strategies (LangChain Greeks reference pattern)

The reference pattern for option Greeks in LangChain (pre-compute and inject vs. expose
the library as tools) maps onto this codebase as follows:

**Strategy 1 — pre-computed pipeline** (used when the inputs are known):
`v4FixedIncomeStrategy` executes the whole quant chain in TypeScript *before* the model
sees anything — subgraph fetches → σ, feeAPY, k, LVR, vega, η → allocation. The agent
receives exact numbers as tool output; its job is strategic reasoning and report
writing, never arithmetic. This is "calculate the Greeks first, then pass the raw
values to LangChain".

**Strategy 2 — math function table** (used for open-ended questions like "what happens
to vega if σ rises to 60%?" or "recompute with L=10"): the quant library is exposed as
individual verifiable `calc_*` tools. The model extracts parameters from the
conversation, calls the tool, and reads the exact result. The tool — never the model —
computes. This is "transform the calculation library into a LangChain Tool".

Both strategies wrap the **same** pure library (`fixedIncomeMath.ts`) — one source of
truth, zero numeric hallucination. Library attribution: `fixedIncomeMath.ts` is the
TypeScript analog of the `black-scholes` package for LP-specific greeks (no off-the-shelf
options library covers LVR/dual-yield vega); `mathjs` is the dependency for stat
extensions — with one verified caveat recorded in the code: mathjs 14's
`variance(x, 'biased')` normalizes by n+1, not n, so the population second moment the
LVR derivation requires is computed explicitly. (Black-Scholes d1/d2 math joins the
table when options land — SUBGRAPH_SPEC.md Phase 6.)

### 4.1 The math function table (`src/tools/mathTools.ts`) — formulas as verifiable tool calls

**The agent never does arithmetic.** Every formula from Part 3 is registered as a
deterministic LangChain tool (zod-typed arguments, pure TypeScript implementation in
`fixedIncomeMath.ts`, golden-tested in `test/tools/fixedIncomeMath.test.ts` and
`test/tools/mathTools.test.ts`). The LLM supplies *arguments only*; the numbers in the
final Markdown are reproducible from the tool-call trace (Part 2, Level B).

**Units contract** (the tools convert at the boundary — the model never does unit
arithmetic): APY inputs/outputs in **percent** (`feeApyPct: 18` = 18%/yr), σ in
**decimal** (`0.4` = 40%), `idleFraction` in 0..1, vega output in **percentage points
per +1 vol point** plus USD per vol point when a notional is given. The fee-vol slope
`k` is never an LLM input — `feeVolScaling: true` derives it internally as
`k = feeAPY/σ` (static fees = `false`).

| Tool (in the function table) | Formula | Inputs (units) | Golden check |
|---|---|---|---|
| `calc_realized_vol` | `σ = √(var(log-returns)) · √(24·365)` | hourly closes | alternating ±10% closes ⇒ `ln(1.1)·√8760` |
| `calc_fee_apy` | `f% = fees24h/TVL · 365 · 100` | fees24h, TVL (USD) | 1176.65/14.008M ⇒ 3.0659%; negative-TVL guard ⇒ 0 |
| `calc_lvr` | `LVR% = 100·L²σ²/8` | σ (dec), L | σ=40%, L=4 ⇒ 32%/yr |
| `calc_net_apy` | `netAPY% = (1−w)f% + w·r% − 100·L²σ²/8 − g%` | σ (dec), APYs (%), w, feeVolScaling | 70%@18% + 30%@5% − 2% ⇒ **12.1%** |
| `calc_vega` | `𝒱 = k − L²σ/4`, volga `−L²/4` | σ (dec), L, feeAPY%, notional | σ=40%, L=4, fee 24% vol-scaled ⇒ **−1.0** ⇒ −$100k/yr on $10M |
| `calc_efficiency_ratio` | `η = netAPY / LVR` | per-book metrics | 12.1/2 ⇒ 6.05 |
| `calc_allocation` | weights ∝ η, filtered by minApr + vegaBudget | legs + constraints (percent) | weights sum to 1; exclusions carry reasons |

This is the standard LangChain tool pattern (`tool(fn, { name, description, schema })`
from `@langchain/core/tools`, zod schemas, `snake_case` names): the model decides *when*
to call, the function body computes *deterministically*. Because the table lives in the
system prompt as a contract ("you are forbidden from doing arithmetic in your head"),
any figure in the report that lacks a `calc_*` tool call behind it is detectably wrong
in review.

### 4.1b The strategy tool (`v4FixedIncomeStrategy`)

Implemented in `src/tools/V4FixedIncomeStrategyTool.ts` and registered in
`DeepGraphAgent.createMultiCategoryTools()`. Inputs: `minApr`, `vegaBudget`, `sizeUSD`,
`leverage` per book class, `idleFractionHooked`, `feeSlopeMode`. It: pulls volume-ranked
v4 pools + hooked pools → 14d fee series + 168h closes per finalist → Aave V3 lending
leg → computes σ, f, LVR, **vega (3.2)**, η via the same `fixedIncomeMath.ts` functions
→ filters by APR/vega → allocates → returns structured JSON with weights, Greeks,
exclusions, and provenance (deployment IDs + block numbers).

### 4.2 The dual-hook wiring

`DeepGraphAgent` passes `hook→vault` config (`HOOK_VAULT_MAP` in the tool) so a
DualPool-style book's idle leg reads the correct lending market. Unhooked pools are
still eligible but with `w=0` — pure fee books, which the strategy reports label
"fee-only (no lending leg)".

### 4.3 The Markdown contract (system prompt)

The agent's system prompt ends with a hard output contract:

```text
FINAL REPORT FORMAT (always Markdown, always in this order):
1. **Executive Summary** — 3 bullets: achieved APR vs target, portfolio vega vs budget, worst-case stress verdict.
2. **Market Scan** — table of books considered, with volumeUSD, TVL, hook address, dynamic-fee flag, and the tool call that produced each row.
3. **Strategy Construction** — allocation table: pool id, weight %, fee APY, lending APY (w·r), LVR, net APY, vega per vol point.
4. **Risk Report** — portfolio vega, volga note, concentration flags, VaR(95/99) from computeFixedIncomeMetrics.
5. **Stress Scenarios** — σ×1.5 and σ×2 rows from runStressTest; verdict PASS/FAIL for "fixed income" status.
6. **Execution Plan** — per book: entry range for L, size, expected gas, monitoring triggers (σ > trigger ⇒ reduce L).
7. **Data Provenance** — subgraph deployment ids, block numbers from every _meta, tool-call count.
8. **Caveats** — anything not verified on-chain (e.g., Spark rates proxied by Aave), the negative-TVL quirk, no sovereign guarantee.
Never invent numbers: every figure must trace to a tool result in this conversation. If a required datum is missing, run another tool — do not estimate silently.
```

Because the tool returns JSON with provenance and the prompt forbids untraced figures,
the Markdown is auditable row-by-row against Part 2's trace.

---

## Part 5 — The Conversation, End to End

### 5.1 Your prompt (the trader side)

```text
You are trading for a fixed-income book. Build a Uniswap v4 LP strategy:
- Notional: $10,000,000 USDC-side
- Required APR: ≥ 6% net
- Vega budget: ≤ 0.5% of notional per +1 vol point (portfolio level)
- Only prominent books: cumulative volume ≥ $1B or 24h volume ≥ $5M
- Prefer dual-hook books (idle capital swept to lending) — but include fee-only books if they pass the APR test
- Use range leverage L=1 for ETH books (full range), L=20 for stable/stable books
Minimize risk subject to the APR target. Show vega per book. Report as Markdown per the contract.
```

### 5.2 What the agent should do (the trace you verify)

```
1. v4TopPools { first: 20 }                      → venues, $-scale check
2. v4HookedPools { first: 20 }                   → dual-hook candidates + leaderboard
3. v4PoolDayData { poolId: 0x21c67e…, days: 30 } → feeAPY = fees/TVL·365 (per finalist)
4. v4PoolHourData { poolId: …, hours: 168 }      → σ from hourly closes (per finalist)
5. getLendingReserves { network: 'ethereum' }    → r (Aave USDC supply APY)
6. v4FixedIncomeStrategy { minApr: 6, vegaBudget: 0.5, sizeUSD: 10_000_000, … }
7. computeFixedIncomeMetrics / runStressTest     → VaR + σ×1.5, σ×2 scenarios
```

### 5.3 The shape of the expected answer (abridged)

```markdown
## Executive Summary
- **Achieved net APR: 7.1%** vs 6.0% target ✓ (weighted across 3 books)
- **Portfolio vega: −0.38%/vol-pt** vs −0.50% budget ✓ (short-vol but inside budget)
- **Stress verdict: PASS** — σ×1.5 keeps net APY ≥ 0 on 2 of 3 books; ETH book capped at 15%.

## Market Scan
| Book | Pair | Hook | 24h Vol | Cum Vol | feeAPY | σ | Tool |
|---|---|---|---|---|---|---|---|
| 0x8aa4e11c… | USDC/USDT | none | $9.5B | $505B | 0.9% | 0.4% | v4TopPools |
| 0xe500210c… | USDC/WETH | 0x0000000aa232… (dyn fee) | $3.1M | $1.93B | 18.2% | 38% | v4HookedPools |
| 0x21c67e77… | ETH/USDC | none | $2.4M | $11.9B | 6.1% | 41% | v4PoolDayData |

## Strategy Construction
| Book | Weight | Fee APY | Lending leg (w·r) | LVR (L²σ²/8) | Net APY | Vega/pp |
|---|---|---|---|---|---|---|
| USDC/USDT (L=20) | 70% | 0.9% | 70%×0.9%×… | 0.02% | 3.4% | −0.01% |
| USDC/WETH hook (L=1, w=0.3) | 15% | 18.2% | 0.3×2.1% | 0.8% | 12.1% | −0.31% |
| ETH/USDC (L=1) | 15% | 6.1% | — | 2.1% | 4.0% | −0.06% |

## Risk Report
Portfolio vega −0.38%/vol-pt · VaR95 $212k · concentration flag: none (max 70% stable book is by design)…

## Data Provenance
v4 deployment DiYPVd… block 25,924,1xx · Aave V3 Cd2gED… block 25,924,1xx · 11 tool calls.
```

(Numbers illustrative; the agent's must match its own tool outputs — that is what the
provenance section and Level-B assertions enforce.)

### 5.4 Feeding the result back into the risk engine

The strategy tool's JSON mirrors `FixedIncomeMetrics` (`alpha, beta, vega, theta, gamma,
duration, convexity, sharpeRatio, var95, var99`), so the same allocation can be pushed
straight into the EMS risk gates (`SYSTEM_DESIGN.md` §7 pre-trade checks) without
re-derivation.

---

## Part 6 — Test Checklist (copy into a PR description)

- [ ] `curl` health on all 5 endpoints: `hasIndexingErrors=false`, fresh block (Tier 1)
- [ ] `pnpm cli list-protocols` resolves lending/dex/prediction to correct subgraph IDs (Tier 2)
- [ ] `pnpm cli test-data --category lending|dex|prediction` prints parsed numbers (Tier 2)
- [ ] Direct tool invoke returns USDC/USDT ≥ $1B volume (Level A)
- [ ] Agent trace contains the expected tool names for the query asked (Level B)
- [ ] `LANGCHAIN_VERBOSE=true` shows every GraphQL request (Level C)
- [ ] e2e: volume-ordered top pool ≥ $1M; hooked pool present with non-zero hook; leaderboard ≥ 1 (Level D)
- [ ] Vega golden values: `V = k − L²σ/4` for (σ=0.2, L=1, k=0) ⇒ −0.05; (σ=0.4, L=4, k=0.6) ⇒ −1.0
- [ ] Strategy filter: pools failing APR or vega budget never appear in the allocation table
- [ ] Weights sum to 1 ± 1e-9; achieved APR ≥ target or the report says so explicitly
- [ ] Provenance section lists deployment IDs + block numbers for every source

---

*Sources: [Uniswap v4 hooks docs](https://developers.uniswap.org/docs/get-started/concepts/hooks), [DualPool hook announcement](https://blog.uniswap.org/dualpool-hook-is-now-live), [v4 subgraph queries](https://developers.uniswap.org/docs/ecosystem/subgraphs/concepts/v4/queries), LVR: Milionis, Moallemi, Roughgarden (2022), "Automated Market Making and Loss-Versus-Rebalancing".*
