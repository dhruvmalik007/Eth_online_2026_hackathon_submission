# Agentic EMS — Native React SDK Rebuild (FastH3)

## Goal

Replace the Python-wrapper FastH3 runner with a **native React app** using the typed
`@reactor-models/fast-h3` SDK, following the open-source `reactor-team/js-sdk/examples/fast-h3`
reference pattern. Define prompts **before** generation, hard-cap every clip at **≤ 15 s**
(target 8–10 s for the demo), and use only the resources the user shared:

- `vanguard_video/reactor-fasth3-promptguide.md` (the FastH3 prompt guide)
- `vanguard_video/reactor-fasth3-schema.md` (the wire schema)
- `vanguard_video/reactor-overview.md` (the FastH3 overview)
- https://docs.reactor.inc/model-api-reference/fast-h3/tutorial (the FastH3 tutorial)
- https://docs.reactor.inc/sdk-reference/typed-model-sdk (typed SDK patterns)
- The existing project assets (`ems_shotlist_fasth3.md`, `reference_frames/`,
  DefiLlama/RWA.xyz data already in `reactor_fast_h3_runner.py`, voice blocks, actor names)
- `bloomberg_video_context/bloomberg_screens/` and
  `bloomberg_video_context/bloomberg_screens/bloomberg_screens_fixed_income/` —
  **screen-structure inspiration only**, no brand naming anywhere on screen or in prompts
- `data/defillama_metrics/` — the scraped DeFiLlama metric snapshot used to ground every
  on-screen number

## What was wrong with the previous approach

| Problem | Cause | Fix in this plan |
|---|---|---|
| ~62,000 credits burned across 7 sessions | `reactor.download_clip(duration, path)` is a **session-recording** download, not a single-clip download | Never call `download_clip` with a duration. Use `requestClip(N)` + `downloadClipAsFile(clip, name)` only when the user clicks **Snap clip** |
| Chained clips silently never built | `continue_from_clip_id` pointed at clips not in the playout queue; we kept polling an empty queue with a live WebRTC session | Use the native `useFastH3()` enqueue loop from the tutorial — chain via `reply.clip.clip_id` after each successful `enqueue` reply |
| Sessions held open while polling | `get_queue` polling while connected burns the session | Lazy connect: the session only opens when the user clicks **Queue episode**; it closes when the browser tab closes |
| No prompt discipline | 800-char cap was enforced in Python at dispatch time (too late) | Validate prompt length **at composer authoring time** (UI shows live char count and refuses to queue if > 800) |
| No hard clip deadline | `seconds` was 5.167–14.375 and not bounded to the user's requirement | Every scene ≤ **15 s** hard cap; default 8 s; composer shows the length and refuses > 15 s |

## Design principles

1. **Prompts first.** Nothing is generated until every prompt is authored, reviewed, and
   validated against the prompt guide rules (scene → camera → soundscape → dialogue with
   speaker tags, ≤ 800 chars, positive-state only, every continuation opens with "Hard cut to …").
2. **Native SDK only.** Use `@reactor-models/fast-h3` — `FastH3Provider`, `useFastH3()`,
   `useFastH3State`, `useFastH3CommandError`, `useFastH3StateUpdate`,
   `useFastH3QueueUpdate`, `<FastH3MainVideoView />`. No Python wrapper, no manual WebRTC,
   no custom scheduler.
3. **Server-side auth only.** The `rk_…` key never reaches the browser. One Next.js route
   mints a 1-hour JWT with `max_sessions: 1`.
4. **Lazy connect.** Nothing connects until there is something to queue.
5. **Capacity gate before enqueue.** Read a fresh `getState()` and refuse to queue if
   `generation_capacity - generation_queued < scenes.length`.
6. **Chain via `reply.clip.clip_id`.** Each continuation's `continue_from_clip_id` is the
   previous clip's id from the `clip_queued` reply — never invented, never guessed.
7. **Metadata echo.** Each scene carries a JSON tag (`{episode, title, scene, scenes}`)
   so the queue panel and now-playing surface can render scene labels.
8. **Screen structures are Agentic-branded**, inspired by the layouts in
   `bloomberg_video_context/bloomberg_screens/` and
   `bloomberg_video_context/bloomberg_screens/bloomberg_screens_fixed_income/` but named
   for what the screen does in the Agentic EMS world. **Never mention a legacy exchange
   vendor by name** in any prompt, dialogue, on-screen label, or scene description.

## File layout

```
agentic-ems/                            # NEW Next.js app (scaffolded by create-reactor-app)
├── .env.local                          # REACTOR_API_KEY=rk_…
├── app/
│   ├── api/reactor/token/route.ts     # POST → JWT from Reactor /tokens (expires_after: 3600, max_sessions: 1)
│   ├── api/episode/route.ts           # POST → serve the scene manifest (from prompts.ts)
│   ├── page.tsx                       # renders <AgenticEmsApp /> inside <SetupRequired>
│   ├── SetupRequired.tsx              # shows a clear error if REACTOR_API_KEY is not set
│   ├── AgenticEmsApp.tsx              # <FastH3Provider jwtToken={fetchToken}> + layout
│   ├── lib/
│   │   ├── prompts.ts                 # the SCENE MANIFEST — 4-6 scenes, ≤ 15 s each, authored FIRST
│   │   ├── screens.ts                 # the AGENTIC SCREEN TEMPLATES (see "Agentic screen templates")
│   │   ├── defillama.ts               # typed loader for the scraped DeFiLlama snapshot
│   │   ├── tag.ts                     # EpisodeTag type + makeTag / parseTag helpers
│   │   └── validate.ts                # prompt-length + hard-cut + speaker-tag checks
│   └── components/
│       ├── EpisodeComposer.tsx        # loads manifest, capacity-gates, enqueues chained
│       ├── QueuePanel.tsx             # pure mirror of queue_update
│       ├── NowPlaying.tsx             # pure mirror of state_update + clip_started
│       ├── SnapClip.tsx               # requestClip(N) + downloadClipAsFile
│       ├── CommandError.tsx           # surfaces command_error broadcast
│       ├── StatusBadge.tsx            # connection indicator
│       └── Video.tsx                  # <FastH3MainVideoView /> wrapper
└── package.json
```

---

# Agentic EMS brand + screen templates

## Brand

- **Product name:** `Agentic EMS`
- **Tagline:** `Tokenized Execution Management System`
- **Subtitle:** `Unified DeFi + tokenized TradFi execution, on-chain`
- **UI theme:** dark glassmorphism panels over a near-black floor (`#0A0E14`), monospace
  numerals, high-contrast row highlighting. Tab-bar chrome in `#14181F`; the selected tab
  is highlighted in one accent colour per screen template.
- **Color accents (used consistently across every screen in the film):**
  - `neon cyan #00E5FF` — DeFi lending-pool rows
  - `amber #FFB300` — tokenized TradFi fund rows + the axe flag
  - `violet #8B5CF6` — crypto ETF / structured product rows
  - `crimson #FF3B5C` — risk warnings, VaR breaches, failed compliance
  - `green #22C55E` — compliance badge "PASSED", successful fills
- **Naming rule:** every screen is named by what it *does* in the Agentic EMS world —
  `Agentic Yield Monitor`, `Agentic Risk Desk`, `Agentic Ticket`, `Agentic Floor`,
  `Agentic Chat`, `Agentic TVL Grid`, `Agentic Bond Monitor`, `Agentic Credit Monitor`,
  `Agentic Swap Portal`, `Agentic Search`. No legacy exchange vendor names appear anywhere.

## Reference screens (structure inspiration only)

These are the exact screenshots in `bloomberg_video_context/bloomberg_screens/` and
`bloomberg_video_context/bloomberg_screens/bloomberg_screens_fixed_income/` whose layout
grammar we mimic. We copy the **structure**, never the name:

| Reference screenshot | Structure we borrow | Becomes in the film |
|---|---|---|
| `bloomberg_screens_fixed_income/…6.23.06 PM.png` — sovereign bond grid | Region-grouped grid (Americas / EMEA / Asia-Pacific), Maturity selector, `Bonds / Spreads / Curves` tabs, columns `Region · RMI · Security · Price · Chg · Yld · Chg Yld · Range (Low/Avg/Now/High) · 3M Chg`, per-row sparklines, `Data Range 3 Months` selector | `Agentic Bond Monitor` |
| `bloomberg_screens_fixed_income/…6.24.50 PM.png` — credit monitor | `Investment Grade / High Yield / Emerging Markets` tabs, a top index row + ETF row with `Spread · Chg · Historical Range Low/High`, a Bond-Sectors table with `OAS · Chg(bps) · T/W · ΔAVAT · NI (MM)` columns, a right-side spread chart with `Cash vs CDX / CDX vs ETF / Cash vs ETF` toggles, a bottom news strip | `Agentic Credit Monitor` |
| `bloomberg_screens_fixed_income/…6.27.27 PM.png` — IRS trading portal | Currency selector, a left rail with curve families (`Outright · Forwards · Curves · Butterflies · Rolls · Basis · ZC Inflation`), a main tenor-ladder grid `Tenor · Bid · Ask · Change` running 2Y → 45Y in mixed month/year steps, a right rail of tenor shortcuts | `Agentic Swap Portal` |
| `bloomberg_screens_fixed_income/…6.27.51 PM.png` + `…6.29.16 PM.png` — command-line function launcher | A type-ahead command bar that accepts natural-language fixed-income queries (`…BONDS MATURING AFTER 2025 ARE INVESTMENT GRADE`, `…RETAIL AMT OUTSTANDING > 500M`), auto-completes to a list of functions tagged by category, plus a Securities shortcut list, and keyboard-navigation hints | `Agentic Search` |
| `BTMM-china-screen.jpg` | Onshore FI overview with `FI Govt Benchmark · CFETS Key Rates · Money Markets · IRS · SHIBOR Fixings · PBoC · Exchange Repos · USD/CNY · RMB IRS` panels plus a bottom function-link strip (`Treasury Monitor / MOFI / NGE / IMG / XLTP / Market Monitor`) | `Agentic Yield Monitor` |
| `-1x-1.webp`, `resize.webp` — executable FX screen | Top-left bid/ask ladder with `Bid Size · Bid · Ask · Ask Size · Time`, a right `Live Stream` time-series, a bottom-left `Session Chart` with a highlighted current-session corridor, a right `Volume Tiers` bucket-pricing panel (5M–10M / 10M–20M / 20M–30M / 30M+) and `Grid` bid/ask tiles | `Agentic TVL Grid` |
| `PORT-screen-example.png`, `portfolio-risk-analysis.jpg` | Light-themed multi-tab portfolio surface: `Risk / Scenario / Stress Test / Reports`, factor decomposition tables, VaR/ES widgets, scenario-shock presets | `Agentic Risk Desk` |
| `position-management--decision-support.png.avif`, `measure-execution-quality.jpg.avif`, `benchmark.jpg.avif` | Position/decision-support widgets, execution-quality dashboards, benchmark-comparison panels | Supporting panels inside `Agentic Risk Desk` + `Agentic Ticket` |
| `images-3.jpeg` — quant desk photo | Wall of chart monitors, a volatility-surface heatmap, a stochastic-calculus paper, a colour-graded mechanical keyboard with green/amber function keys | Yuki's `Agentic Yield Monitor` physical desk |

## Agentic screen templates

Each of the four actor roles drives a different Agentic screen. Every number below comes
from the scraped DeFiLlama snapshot in `data/defillama_metrics/` (generated 2026-09-03)
or the tokenised-ETF dashboard, except the one FICT anchor.

### Screen A — `Agentic Yield Monitor` (quant strategist desk — YUKI)

*Structure from the onshore-FI grid + the multi-panel yield-tile wall + the quant-desk
wall-of-charts photo: a dense panel of coloured APY tiles, one row per pool, ranked by
TVL, with a right-side forecast time-series, a threshold line, and a bottom
metric/function-link strip.*

| Screen region | Content (exact, from scraped DeFiLlama) |
|---|---|
| Top strip | `Agentic Yield Monitor · live snapshot 2026-09-03` + a UTC clock |
| Left column — APY tiles, ranked by TVL descending (from `sections/yields.json`) | `LIDO stETH 2.18% / $23.26B` · `AAVE v3 4.20% / $18.41B` · `MORPHO WETH 3.20% / $9.79B` · `SPARK USDS 5.18% / $6.20B` · `ETHERNA USDe 11.04% / $4.70B` · `COMP v3 4.50%` · `BUIDL 4.85% / $2.00B` (tokenised-ETF dashboard) |
| Panel tabs (structure from the onshore-FI sub-panels) | `Onchain Benchmark` · `Pool Key Rates` · `Money Markets` · `Overnight Fixings` · `Onchain Repos` |
| Right panel — time-series | A 30-day APY forecast path for the selected pool, with a horizontal threshold line at 5.00% — TimesFM 3 forecast output |
| Bottom function-link strip (structure from the reference monitor strip) | `Yield Monitor` · `Onchain Yields` · `Stablecoin Monitor` · `Pool Monitor` · `Cross-chain Grid` |
| Accent rule | DeFi pools glow cyan; tokenized TradFi funds glow amber; crypto ETFs glow violet |

**Dialogue reference for YUKI at this screen:** `"Five-eight, plus eight. We cross five by minute three."`

### Screen B — `Agentic Risk Desk` (portfolio/risk manager — DARIUS)

*Structure from the light-themed portfolio-risk panel + the position-management /
decision-support dashboards + the measure-execution-quality dashboard: a dense multi-tab
surface with Risk / Scenario / Stress Test / Reports tabs, factor decomposition tables,
a VaR/ES widget, and a scenario-shock preset row.*

| Screen region | Content |
|---|---|
| Top bar | `Agentic Risk Desk` + book selector (`TOKENIZED UST BOOK` / `DEFI BOOK` / `UNIFIED`) |
| Tabs (unlocked row) | `Risk` · `Scenario` · `Stress Test` · `Reports` · `Merton PD` |
| Left panel — Factor decomposition | Per-position β against the factor set; residual ε column; a colour-coded heat strip |
| Centre panel — VaR / ES widget | `VaR 95%: 0.0002986` · `Expected Shortfall:` · `Liquidity score:` |
| Right panel — Merton structural credit | Per-pool PD (probability of default) column, TVL-based |
| Bottom — Scenario shock presets | `+50 bp parallel` · `−10% equity` · `USDS depeg −5%` · `stETH unwind` |
| Compliance badge | `COMPLIANCE: PASSED` in green `#22C55E` — fixed position, bottom-right corner |

**Dialogue reference for DARIUS at this screen:** `"VaR check — what's the gap?"` · `"Book's flat. Good print."`

### Screen C — `Agentic Ticket` (execution trader — MORGAN)

*Structure from the order-ticket close-ups: a single instrument panel with
Spread / Price / Yield / Size fields, a Pricing Method dropdown, a Maturity-selector
dropdown, an Almgren-Chriss schedule badge, and a large green EXECUTE button.*

| Screen region | Content |
|---|---|
| Instrument header | `SPDR UST BASKET · CUSIP U5051` (the one FICT anchor in the film) |
| Pricing Method dropdown | `Mid / Ask / Bid / Manual` — cursor selects `Mid` |
| Maturity selector | `on2YR / on3YR / Next / Worst` — cursor selects `Worst` |
| Field grid | `Spot 99.217` · `Yield 4.620%` · `Coupon 1.734%` · `Maturity 07/22/27` · `Size (K) 52890` |
| Execution schedule badge (Almgren-Chriss) | `8.4M × 10 slices` — ticking live during the beat |
| Compliance row | `COMPLIANCE: PASSED` under a green badge |
| CTA | A single large green `EXECUTE` button, bottom-right |

**Dialogue reference for MORGAN at this screen:** `"Send it. Mid, worst, full size."` · `"Sent. Compliance green."`

### Screen D — `Agentic Chat` (sales trader — JAMIE)

*Structure from the banker-chat station: a conversation thread with bank counterparties
in the centre, market-data tickers in side panels, a right rail with on-chain status.*

| Screen region | Content |
|---|---|
| Thread (centre) | Coloured chat bubbles, blue/white/yellow, between the desk and a market maker |
| Bubble text | `"SparkLend: 5.18% +8bp"` · `"Morpho Blue: 4.95% −3bp"` · `"Ethena USDe: 11.04%"` |
| Left rail | Pool ticker: `SPARK USDS 5.18% +8bp` · `AAVE v3 4.20%` · `MORPHO WETH 3.20%` |
| Right rail | On-chain status: block height, gas price, mempool depth |
| Keyboard turret | The colour-graded multi-button turret, foreground, hands typing |

**Dialogue reference for JAMIE at this screen:** `"Axe on SPDR. Five-two-eight-nine by K. Want it?"` · `"Market's five wide."`

### Screen E — `Agentic Bond Monitor` (the tokenized-UST fund grid)

*Structure from the sovereign bond grid: a group-based grid with a maturity selector,
`Funds / Spreads / Curves` tabs, columns `Issuer · Token · Price · Chg · APY · Chg APY ·
30d Range (Low/Avg/Now/High) · 30d Chg`, per-row sparklines, and a `Data Range` selector.
In the film this is the tokenized-UST fund grid — the amber rows — with DeFi lending
pools as a second group beneath.*

| Screen region | Content |
|---|---|
| Top bar | `Agentic Bond Monitor` · Maturity selector (`1 Year / 2 Year / 5 Year / 10 Year`) · tabs `Funds / Spreads / Curves` |
| Group header 1 — `TOKENIZED UST FUNDS` (amber rows) | `BUIDL 4.85% / $2.00B` · `USDM 4.95% / $0.45B` · `OUSG 4.78% / $0.38B` |
| Group header 2 — `DEFI LENDING POOLS` (cyan rows) | `LIDO stETH 2.18% / $23.26B` · `AAVE v3 4.20% / $18.41B` · `MORPHO WETH 3.20% / $9.79B` · `SPARK USDS 5.18% / $6.20B` · `ETHERNA USDe 11.04% / $4.70B` |
| Columns per row | `Issuer · Token · Price · Chg · APY · Chg APY · 30d Range (Low/Avg/Now/High) · 30d Chg` + a per-row sparkline |
| Data Range selector | `3 Months` |

Used as Morgan's secondary monitor during the wide-desk and ticket beats.

### Screen F — `Agentic Credit Monitor` (the DeFi credit-sector surface)

*Structure from the credit-monitor screenshot: category tabs, a top index row + an
ETF-equivalent row with `Spread · Chg · Historical Range`, a sector table with
`APY · Chg(bps) · TVL · Fees 24h` columns (replacing `OAS · Chg(bps) · T/W · ΔAVAT ·
NI (MM)`), a right-side APY-spread chart with comparison toggles, and a bottom news
strip.*

| Screen region | Content |
|---|---|
| Top tabs | `Stablecoin Pools` · `Lending Markets` · `Liquid Staking` (replacing `Investment Grade / High Yield / Emerging Markets`) |
| Index row (from `sections/stablecoins.json`) | `Aggregate stablecoin supply` + `24h change`, with a `Low / Range / High` historical widget |
| ETF-equivalent row (amber) | `BUIDL` — `APY 4.85%` · `1D Chg` · `Historical Range` |
| Sector table (from `sections/yields.json` + `sections/fees.json`) | Sectors: `Lending` (`AAVE v3 4.20% / $18.41B` · `MORPHO WETH 3.20% / $9.79B` · `SPARK USDS 5.18% / $6.20B` · `COMP v3 4.50%`) · `Liquid Staking` (`LIDO stETH 2.18% / $23.26B`) · `Synthetic Dollars` (`ETHERNA USDe 11.04% / $4.70B`) — columns `APY · Chg(bps) · TVL · Fees 24h` |
| Right chart | 30-day APY spread chart with comparison toggles `Pool vs Benchmark` / `Stable vs Lending` |
| Bottom news strip | Scraped metric-feed headlines — `Lido 24h fees $1.53M` · `Aave 24h fees $1.15M` · `Morpho 24h fees $609K` · 24 h DEX volume |

Used as Darius's secondary monitor and the opening/establishing surface.

### Screen G — `Agentic Swap Portal` (the yield-ladder tenor grid)

*Structure from the IRS trading portal: an asset selector, a left rail of curve families,
a main tenor-ladder grid `Tenor · Bid APY · Ask APY · Change`, and a right rail of tenor
shortcuts. In the film the tenor ladder becomes DeFi fixed-yield maturities — pool
fixed-terms and tokenized-UST bucket APYs.*

| Screen region | Content |
|---|---|
| Top bar | `Agentic Swap Portal` · Asset selector (`USDC` / `USDS` / `stETH`) |
| Left rail (curve families) | `Spot APY` · `Fixed-rate ladder` · `Forward curves` · `Butterflies` · `Rolls` · `Basis (stETH ↔ USDC)` · `Onchain inflation` |
| Main grid (tenor ladder) | `Tenor · Bid APY · Ask APY · Change` — rows `7d / 14d / 1M / 3M / 6M / 12M / 24M` per selected pool |
| Sample row (from `sections/yields.json`) | `3M · 5.16 · 5.20 · +8bp` for SPARK USDS |
| Right rail | Tenor shortcuts `7d / 1M / 3M / 6M / 12M` |
| Accent rule | DeFi rows cyan; tokenized TradFi rows amber |

Used as Yuki's supporting monitor during the forecast-crossing beat.

### Screen H — `Agentic Search` (the command bar)

*Structure from the command-line function launcher: a type-ahead command bar that accepts
natural-language fixed-income queries, auto-completes to a list of functions tagged by
category, plus a Securities shortcut list and keyboard-navigation hints.*

| Screen region | Content |
|---|---|
| Command bar | A blinking-cursor input at the top of the Agentic EMS chrome |
| Example typed queries (Agentic equivalents) | `Show all tokenized UST funds APY > 4.5` · `Show DeFi lending pools TVL > $10B` · `Show stablecoin pools with 24h APY change > 5bp` |
| Auto-complete function list | Each suggestion tagged by category (`Yield` / `Risk` / `Execution`) |
| Securities shortcut list | `BUIDL · USDM · OUSG · stETH · USDC · USDS · USDe` with a `CRV: on-chain` style right tag |
| Keyboard hint | `Type the text you want to run. Enter to execute.` |

Used as a brief insert in the ticket/keying beat — the trader types the query, the ticket
pops into focus.

### Screen I — `Agentic TVL Grid` (the unified book)

*Structure from the executable-FX screen: a bucketed grid that shows one book across three
asset classes, with the `Volume Tiers` bucket-pricing panel as the structural template.*

| Bucket (column) | Rows (from scraped DeFiLlama / tokenised-ETF dashboard) |
|---|---|
| **Tokenized TradFi funds** (amber) | `BUIDL 4.85% / $2.00B` · `USDM 4.95% / $0.45B` · `OUSG 4.78% / $0.38B` |
| **DeFi lending pools** (cyan) | `LIDO stETH 2.18% / $23.26B` · `AAVE v3 4.20% / $18.41B` · `MORPHO WETH 3.20% / $9.79B` · `SPARK USDS 5.18% / $6.20B` · `ETHERNA USDe 11.04% / $4.70B` · `COMP v3 4.50%` |
| **Crypto ETF / structured** (violet) | `Tokenised ETF aggregate TVL > $10B` · `Ethereum share 56.87%` · `674,994 RWA holders` |

Header: `Agentic TVL Grid · one book, three asset classes · snapshot 2026-09-03`.

### Screen J — `Agentic Floor` (the wide-desk establishing shot)

*Structure from the wide trading-floor shot: three-monitor desk setups with vertical side
monitors, a dark-themed blotter on the left, a light-themed OMS in the centre, a
dark-themed chart wall on the right, a phone turret on the desk.*

Used in the opening + the wide-floor beat. Two or three traders visible in frame.

### Screen-to-actor map (used by the prompts)

| Actor | Role | Primary screen | Supporting screens |
|---|---|---|---|
| `S1 Morgan` | Execution trader | `Agentic Ticket` | `Agentic Floor`, `Agentic Bond Monitor`, `Agentic TVL Grid` |
| `S2 Jamie` | Sales trader | `Agentic Chat` | `Agentic Floor` |
| `S3 Darius` | Risk / portfolio manager | `Agentic Risk Desk` | `Agentic Credit Monitor`, `Agentic TVL Grid` |
| `S4 Yuki` | Quant / desk strategist | `Agentic Yield Monitor` | `Agentic Swap Portal`, `Agentic Search` |

---

## DeFiLlama data source of truth

The scraper output lives in `data/defillama_metrics/` (generated 2026-09-03). The typed
loader `app/lib/defillama.ts` imports these files and exposes typed records the prompt
builder interpolates into scene descriptions:

| File | Feeds |
|---|---|
| `data/defillama_metrics/sections/yields.json` | Per-pool `tvlUsd` + `apy` — the APY-tile column in `Agentic Yield Monitor`, the DeFi rows in `Agentic Bond Monitor`, the sector table in `Agentic Credit Monitor`, the tenor ladder in `Agentic Swap Portal` |
| `data/defillama_metrics/sections/stablecoins.json` | Per-stablecoin `name / symbol / circulating` — the index row in `Agentic Credit Monitor` (`USDS / USDe / BUIDL / USDY / USYC / RLUSD`) |
| `data/defillama_metrics/sections/fees.json` | Per-protocol `total24h / total7d / total30d / total1y` fees — the bottom news strip (`Lido $1.53M 24h`, `Aave $1.15M 24h`, `Morpho $609K 24h`) |
| `data/defillama_metrics/sections/dexs.json` | 24 h DEX volume — the bottom metric feed |
| `data/defillama_metrics/sections/options.json` + `aggregators.json` | Supporting metric-feed rows |
| `data/defillama_metrics/defillama_metrics_taxonomy.json` | The category taxonomy (`Lending`, `Liquid Staking`, `Dexs`, `Bridge`, `CDP`, `Synthetics`, `Yield`, `RWA Lending`, …) used to group rows in `Agentic Credit Monitor` |
| `data/defillama_raw_protocols.json` | Cross-check of every protocol's `category` field |

The tokenized TradFi anchors (`BUIDL 4.85% / $2.00B`, `USDM 4.95% / $0.45B`,
`OUSG 4.78% / $0.38B`) come from the tokenised-ETF dashboard reference data already
captured in the project; they appear as `agenticTradfi` constants in
`app/lib/defillama.ts`, marked `source: "RWA.xyz / tokenised-ETF dashboard"`.

The one **FICT** anchor in the whole film is `SPDR UST BASKET / CUSIP U5051 / Spot 99.217 /
Yield 4.620 / Size(K) 52890` — the trade subject. It is the only invented number and is
labelled `FICT` in every prompt and metadata payload. Every other on-screen number comes
from the scraped DeFiLlama snapshot or the tokenised-ETF dashboard.

---

## Phase 1 — Prompts defined first (no generation yet)

Author **5 scenes** in `app/lib/prompts.ts` for the demo. Each follows the dense-lane
structure from the FastH3 prompt guide:

1. **Scene and subject** — fully self-contained, from scratch (subjects, environment, light, palette, style). Name the Agentic screen template the actor is driving.
2. **Camera** — one clear instruction ("Slow push-in from medium to close-up, eye-level, shallow depth of field.")
3. **Soundscape** — 2–3 clauses: ambience bed → music mood (or "no music") → action SFX
4. **Dialogue** — quoted with speaker tags (`S1 (Morgan, low baritone, dry): "..."`) — reuse the same tag per speaker across the episode
5. **Continuation scenes 2–N open with "Hard cut to …"** and re-describe the entire scene

### The 5-scene demo arc (~46 s total, ≤ 15 s per clip)

| # | Beat | Seconds | Screen template | Actor(s) | Camera | Dialogue (verbatim) | Soundscape |
|---|---|---|---|---|---|---|---|
| 1 | Terminal wakes up | 8 | `Agentic Floor` → `Agentic Ticket` | Morgan, Jamie | Slow push-in from wide to the centre monitor | S1: "Book's open. Five-eight on USDS." S2: "Market's five wide." | Soft HVAC, 50 Hz hum, key clatter |
| 2 | Wide floor, risk check | 10 | `Agentic Floor` + `Agentic Risk Desk` + `Agentic Credit Monitor` | Darius, Morgan | Wide, static, eye-level | S3: "VaR check — what's the gap?" S1: "Book holds. Four-two USDC, eleven oh-four USDe." | Turret chatter, key taps, distant phone |
| 3 | Forecast crosses threshold | 8 | `Agentic Yield Monitor` + `Agentic Swap Portal` | Yuki, Morgan | Medium close-up, handheld micro-drift | S4: "Five-eight, plus eight. We cross five by minute three." S1: "Copy." | Forecast tick, quiet room tone |
| 4 | Axe flagged, ticket keyed | 10 | `Agentic Chat` + `Agentic Search` + `Agentic Ticket` | Jamie, Morgan | Over-the-shoulder push-in on the ticket | S2: "Axe on SPDR. Five-two-eight-nine by K. Want it?" S1: "Send it. Mid, worst, full size." | Rapid keys, one soft chime, room tone |
| 5 | Compliance badge flips green | 10 | `Agentic Ticket` + `Agentic Bond Monitor` | Morgan, Darius | Close-up on the green EXECUTE, then hold | S1: "Sent. Compliance green." S3: "Book's flat. Good print." | Chime, breath, room tone |

**Total: ~46 s, ≤ 15 s per clip.** Every continuation opens with "Hard cut to …".

### Prompt-length validation

`app/lib/validate.ts` runs at authoring time and again before dispatch:

- `prompt.length <= 800` (hard cap from the wire)
- `seconds <= 15`
- Every continuation prompt starts with `"Hard cut to "`
- Every dialogue line uses a registered speaker tag (`S1`–`S4`)
- No `"no "` / `"not "` / `"don't "` phrasing (positive-state rule)
- No legacy exchange vendor names anywhere in the prompt
- Every number in the prompt appears in the DeFiLlama scrape or the tokenised-ETF
  dashboard snapshot, or is the single FICT anchor

## Phase 2 — Native React app scaffold

1. `npx create-reactor-app agentic-ems --model=reactor/fast-h3` — scaffolds the typed-SDK
   Next.js app with auth already wired (per the docs "Fastest path to a working app").
2. Replace the generated boilerplate with the file layout above.
3. `app/api/reactor/token/route.ts` — copy verbatim from the tutorial:
   ```ts
   const res = await fetch("https://api.reactor.inc/tokens", {
     method: "POST",
     headers: {
       "Reactor-API-Key": process.env.REACTOR_API_KEY!,
       "Content-Type": "application/json",
     },
     body: JSON.stringify({
       expires_after: 3600,
       authorization_details: [{
         type: "session",
         resources: { models: { match: ["reactor/fast-h3"] } },
         max_sessions: 1,
       }],
     }),
   });
   ```
   Marked `no-store` so a dropped-then-refetched cache entry never 403s.
4. `AgenticEmsApp.tsx` — memoized token resolver that coalesces parallel fetches and
   refreshes with a 60 s skew; **no `autoConnect`** on the provider.
5. `EpisodeComposer.tsx` — the queueEpisode action, copied from the tutorial pattern:
   - `if (status !== "ready") await connect();`
   - `const state = await getState();` capacity-gate against a fresh snapshot
   - `if (!state.autoplay) await setAutoplay({ enabled: true });`
   - For each scene: `enqueue({ prompt, metadata: makeTag(...), seconds, ...(previousClipId ? { continue_from_clip_id: previousClipId } : {}) })`
   - Thread `previousClipId = reply.clip.clip_id`
   - If `!reply`, stop and surface `CommandError`
6. **No Python runner** — the file `reactor_fast_h3_runner.py` stays in the repo as a
   reference but is no longer invoked.

## Phase 3 — Demo playback & recording

1. `pnpm install && pnpm dev` in `agentic-ems/`
2. Open `http://localhost:3000` — the composer loads the 5-scene manifest from `prompts.ts`
3. Click **Queue episode** — connects, capacity-gates, enqueues all 5 chained scenes
4. Autoplay rolls the playout queue seamlessly — the `Hard cut to …` prompts keep the chain sharp
5. Click **Snap clip** — `requestClip(15)` + `downloadClipAsFile(clip, "agentic-ems-demo.mp4")`
   downloads the last ≤ 15 s of the live stream as an MP4 (the only recording path — this
   replaces the broken `download_clip(duration)` from the Python runner)

## Phase 4 — Verification

- [ ] `pnpm dev` runs with no build errors
- [ ] `REACTOR_API_KEY` is read server-side only (never in client code); grep the client bundle for `rk_`
- [ ] The composer shows 5 scenes with live char counts, all ≤ 800
- [ ] Every continuation scene starts with "Hard cut to "
- [ ] Every scene is ≤ 15 s
- [ ] Every scene names the Agentic screen template (no legacy vendor names)
- [ ] Every number in the prompt matches the scraped DeFiLlama snapshot or the tokenised-ETF dashboard, except the one FICT anchor
- [ ] Click **Queue episode** → 5 `clip_queued` replies, each with a distinct `clip_id`
- [ ] `previousClipId` chains correctly — verify in the metadata echo
- [ ] Autoplay rolls the playout queue end-to-end
- [ ] Snap clip downloads an MP4 ≤ 15 s
- [ ] No Python process touches Reactor during the demo
- [ ] Credits spent = sum of scene lengths × ~70 credits/sec (~3,200 credits for the 46 s demo)

## Explicit non-goals

- No Python wrapper, no `reactor_fast_h3_runner.py` invocation, no async scheduling
- No custom WebRTC wiring — the native SDK handles it
- No more than 5 scenes and no more than 15 s per scene in this demo
- No Veo 3 / Seedance / other models — FastH3 only
- No new visual assets — reuse the existing reference frames only if a scene needs a
  `starting_frame`; otherwise open from text
- No legacy exchange vendor naming anywhere — the screen layouts are Agentic-branded
  re-imaginings of the structures in `bloomberg_video_context/bloomberg_screens/` and
  `bloomberg_video_context/bloomberg_screens/bloomberg_screens_fixed_income/`
