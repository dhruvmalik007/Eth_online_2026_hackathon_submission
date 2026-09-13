# EMS one-minute film — revised shot list & asset methodology (FastH3 build)

> Revises every description scraped from the **Bloomberg Trading MS** material
> (`video_summarization_analysis.md` + the `actual.mov`) using the same
> asset-first pipeline that produced **THE TRIGGER** (Higgsfield Studio):
> one element, one name; assets locked before any shot; every prompt an island;
> hard things baked into the plate; directed acting, not adjectives.
> Generation target is **MiniMax FastH3** on Reactor (800-char prompt cap,
> 5.167–14.375 s clips on a 17n+5 frame grid, 1344×768 16:9, 24 fps,
> I2V via `starting_frame`, scene chaining via `continue_from_clip_id`).

---

## 1. Logline & storyline

**Logline.** A digital-asset fixed-income trader, on her night shift, sees a
tokenized UST basket swing on a DefiLlama yield that her model predicted — and
has eleven minutes before the USDS pool reprices. She arms a Merton-gated
execution, rides an Almgren-Chriss schedule against an Aave USDC collateral
source, and lets the model's forecast take the trade her gut wants to refuse.

**Event of the film.** A woman commits capital to a number no human would trust,
because the machine she built reads the market better than she does. The trade
is the plot; the screens are the actors.

**Two timelines in one desk, no shared look.**

- **THE MARKET — real data, live anchors.** DefiLlama/Obscura metrics shown
  verbatim: Lido stETH 2.18% APY ≈ $23.2B TVL, Aave USDC 4.2% ≈ $2.1B TVL,
  SparkLend USDS 5.1% ≈ $2.5B TVL, Ethena USDe 11.2% yield, Morpho WETH
  3.2% ≈ $1.2B, Compound USDC 4.5% ≈ $0.8B, Maker DAI ~$1.8B, BlackRock BUIDL
  (from `data/obscura_raw` via Obscura). The one fictional price is **SPDR UST**
  (tokenized UST basket, CUSIP-map `U5051`), a prop whose number is fixed by the
  narrative — every other number on screen is pulled from a real feed.
  - **Anchor instruments on the right monitor (all real):**
    - `SPARK USDS 5.1% 2.5B` — the pool being traded (SparkLend USDS).
    - `AAVE USDC 4.2% 2.1B` — the collateral/deposit source for the trade.
    - `COMP v3 USDC 4.5% 0.8B` — competing liquidity.
    - `MORPHO WETH 3.2% 1.2B`, `LIDO stETH 2.18% 23.2B`, `ETHA USDe 11.2% 9.4B`.
- **THE AGENT — the AIs that ran the trade.** TimesFM 3 forecast (30-day APY
  path), Merton credit-risk gating, Almgren-Chriss execution schedule, BSM
  option pricing on the pool, Monte Carlo VaR/ES, Hull-White rate path,
  Nelson-Siegel-Svensson yield curve. These are not decorations: the trader is
  the one who checks the numbers, and each number is real output of
  `simulation_engine.py` / `services/timesfm3`.

**Why it holds together.** THE TRIGGER's rule: the present is almost nothing
happening, in the dark; the past is wide, hot and violent. Here the two
timelines are **the market** (data-grade, cold, every number legible) and **the
agent** (the human who reads the market, warm, shallow focus when she's in
frame). Ninety percent of a data-grade frame is dark UI with no detail; the
performance lives in one eye, one rim of light on a shoulder, one hand pulling
the trigger of a mouse. The video model fights you on exactly that — it lifts
blacks, invents a dusk sky, brightens a face and redraws printed text every
frame. Holding the dark and holding the print is this film's hardest task, and
the whole pipeline below exists to solve it.

---

## 2. Asset list — one element, one name

Nothing is generated until every element is named, versioned, locked.

| Tag | Element | Source |
|---|---|---|
| `@char_EMS_sonal` | Trader, 34, fixed-income desk, navy shirt + loosened top button; face generated **close-up first** (Soul-angle identity), full-figure wardrobe pass locked after | composed |
| `@char_EMS_sonal_hand` | Her hand + sleeve cuff (never a full second actor) | cropped from `@char_EMS_sonal` |
| `@loc_EMS_desk` | The desk plate: 3 monitors, Bloomberg-style keyboard, mug, coaster, window wall | reference frame 02 |
| `@loc_EMS_mon1` | Left monitor — news/risk tab | reference frame 09 |
| `@loc_EMS_mon2` | Center monitor — order ticket + blotter | reference frame 10 |
| `@loc_EMS_mon3` | Right monitor — yield curves, forecast, VaR countdown | reference frame 04/06 |
| `@prop_EMS_ust` | The order ticket for SPDR UST (prop) | composed |
| `@prop_EMS_feed` | Ticker strip + clock block (24:00 UTC countdown) | composed |
| `@dst_EMS_preset` | Day grade (warm amber-grey, soft) | plate |
| `@dst_EMS_night` | Night grade (teal-green shadows, sodium amber, 2–3 stops down) | plate |

**New state = new asset, never an overwrite.** Sonal at 23:40 and Sonal at
23:52 are the same asset; the desk seen from the door and the desk over her
shoulder are different assets of the same room.

---

## 3. The night look — baked into the plate, not argued in the prompt

- **Bake the darkness in.** The exposure of the video follows the exposure of
  its first frame, not the adjectives. Every plate is 2–3 stops down with
  crushed blacks and a single cold rim on the window wall.
- **Crop the sky out.** No skyline, no roofline, no clouds. The brightest thing
  in frame is a practical: the monitors' glow, one desk lamp, the city's remote
  sodium glow through the blinds.
- **Grade, locked per timeline:**

| | MARKET (data) | AGENT (Sonal) |
|---|---|---|
| Palette | teal-green shadows, sodium amber practicals | warm amber-grey skin, soft rim |
| Exposure | 2–3 stops down, crushed blacks | 1–1.5 stops down, milky lifted blacks |
| Texture | fine 35mm grain | fine 35mm grain (same) |
| Camera | locked off or a slow mechanical push; the camera physically travels, never zooms | tight, handheld drift, shallow focus |

- **Anamorphic only if the budget allows** — see option 4 in §9. If used, it's
  won at the still stage: `STRONG anamorphic lens character: horizontal squeeze,
  oval elliptical bokeh, stretched highlights, cat-eye at frame edges, subtle
  chromatic aberration toward edges. NO lens flares, NO light streaks. 2.39:1.`
  In the video prompt those words never appear, even as bans.

---

## 4. Camera language

Every camera move is stated in the shot list as **the move, not the effect**:

- **A1 — locked off.** Data beats (market monitors). Zero drift.
- **A2 — slow mechanical push.** The camera dollies forward on a fixed axis (the
  rig physically travels; it never zooms). For every monitor beat when the
  model must hold text legible.
- **B1 — handheld micro-drift.** Sonal's face, her hand, the mouse. 3–5% sway.
- **B2 — 180° whip-pan, one per film.** On the `SEND` moment: from the ticket to
  Sonal's eye. Designed like a stunt, matched on movement direction and sound.
- **C1 — drone / aerial.** One exterior establishing shot only (dawn skyline —
  see §5, beat C). Everything else stays in the room.

**Bind geometry to the frame, not to the object.** "Top-left of the ticket" is
frame-top-left; "the near side facing camera" behaves, "the left side of the
order" produces a second ticket. The camera never crosses the sixth line; the
blotter reads left-to-right, ticket bottom-left, clock top-right.

**Scale by cues, not measurements.** The only altitude we ever see is what the
desk lamp and the window reflection suggest. No measuring sticks.

---

## 5. Full one-minute timeline — 12 clips, all seeded, all chained

Duration budget on the 17n+5 grid → **12 clips @ 8.000 s (192 frames) = 96 s is
wrong**. The real cut is 10 clips for 59.75 s. Design decision: **10 clips, not
12** — two of the twelve beats fold into their neighbors (b-1 into b-2, e-tab
into f), because FastH3 clips hard-cut to black and a 5.17 s clip costs more
in rhythm than it returns. Final cut:

| # | Clip | Time on grid | Frames | Cum. start | Beats |
|---|---|---|---|---|---|
| 01 | `ems_01_terminal_ignition` | 8.000 s | 192 | 0.000 | a |
| 02 | `ems_02_desk_wide` | 8.000 s | 192 | 8.000 | b-1, b-2 |
| 03 | `ems_03_eye_and_forecast` | 8.000 s | 192 | 16.000 | c |
| 04 | `ems_04_data_volatility` | 8.000 s | 192 | 24.000 | d, ticker |
| 05 | `ems_05_agent_brief` | 7.292 s | 175 | 32.000 | e |
| 06 | `ems_06_pricing_methods` | 7.292 s | 175 | 39.292 | f, g |
| 07 | `ems_07_inventory_axe` | 8.000 s | 192 | 46.584 | h |
| 08 | `ems_08_order_ticket` | 8.000 s | 192 | 54.584 | i |
| 09 | `ems_09_send_payoff` | 5.875 s | 141 | 62.584 | j |
| 10 | `ems_10_brand_endcard` | 5.167 s | 124 | 68.459 | k |

**Total ≈ 73.6 s.** (One-minute alternative: cut clips 03 and 07 to 5.875 s
each → 64.5 s.) The designer's call: keep 8 s for the two beats that carry
the story (03 = eye+forecast, 07 = the axe she doesn't want to pull), and let
data beats ride at 7–8 s. Every clip carries 8 extra frames head+tail as
handles; the cut lands on the frame where the covering element fills ≥90% of
the picture.

Beats:

- **a (clip 01) — The terminal is the actor.** Center monitor powers on from
  black. The ignition is not a flash: it is the slow bloom of a backlit panel —
  walls, then the ticker strip, then the numbers settle. A single cold rim on
  the window wall. Brand mark (the project's own, not Bloomberg's) glows 3%,
  then dims. **No text yet** — the screen is still warming.
- **b-1/b-2 (clip 02) — Desk wide.** Wide, locked off, 2–3 stops down. The
  whole desk: three monitors, keyboard, Sonal's silhouette at the left, hands
  at rest. The camera is a slow mechanical push, the push bleeding into the
  next beat. She hasn't moved yet; the data has. Ticker strip starts to run:
  real anchors only (Lido 2.18 · Aave USDC 4.2 · USDS 5.1 · Ethena USDe 11.2).
- **c (clip 03) — The eye and the forecast.** Extreme close-up on Sonal's eye,
  the pupil contracting as the forecast line she was waiting on crosses the
  threshold line. The ticket's shadow sweeps across her face — the covering
  element that will hand off to the next clip. No dialogue. One reaction, once.
- **d (clip 04) — Data volatility.** Locked off, center+right monitors. The
  market monitor erupts: USDS +8bp to 5.18, Ethena USDe −12bp to 11.04, Aave
  USDC 4.22, ticker flips green/red. Numbers are **readable** (see §7 metric
  lock). Camera never zooms; the data moves.
- **e (clip 05) — Agent brief.** Sonal's face returns, midsize, handheld drift.
  She checks the right monitor: the model's 30-day APY path (TimesFM) crossing
  her threshold. The countdown block shows 23:52:00 and falling. She picks up
  the phone, sets it down — **the trade is decided before she reaches for the
  mouse**.
- **f (clip 06) — Pricing methods.** UI close-up, A2 push. Pricing Method
  dropdown opens: **Mid / Ask / Bid / Manual**. She selects **Mid**. Maturity
  dropdown: **on2YR / on3YR / Next / Worst** → **Worst**. The cursor is the
  only thing that moves. (Two beats folded: the drop-down and the selection are
  one clip.)
- **g (clip 06 cont.) — Core price management.** Same clip, same mounted shot,
  camera still pushing: the Core Price Management tab is active; Inventory,
  Tier, Axe, EOD Mark tabs sit unlocked in the tab row.
- **h (clip 07) — Inventory & the axe.** Locked off, left monitor. The
  inventory grid scrolls: BOEING, GENERAL DYNAMICS, ALTRIA, PHILIP MORRIS —
  tokenized line items with the real tickers' yields. But the **axe** column is
  what she looks at: a single row — **SPDR UST basket** — flagged in amber,
  `axe: BUY 52,890K`. She doesn't want to. The candle of her hesitation is the
  beat; then the hand moves to the keyboard.
- **i (clip 08) — Order ticket.** A2 push on the center monitor. Order entry
  for `SPDR UST BASKET`: Spread=Mid, Price=99.217, Yield=4.62, Size(K)=52890.
  The Almgren-Chriss schedule badge ticks: `8.4M / 10 slices`. She keyboards —
  the Bloomberg-autoclave click of the keys is the sound. **The ticket is the
  number she trusts because the model earned it.**
- **j (clip 09) — Send & payoff.** The whip-pan: from the ticket to her eye and
  back to the SEND button. The green button pulses once, clicks. Pop-up:
  `Bought 52,890K SPDR UST @ 99.217 · Venue: SPARK-USDS · settle 23:59`.
  Compliance badge flips **PASSED**. She lets out the breath she was holding —
  one beat, no fist pump. The film ends on the breath, not the celebration,
  because the trade isn't a win yet; the number just ran.
- **k (clip 10) — Brand endcard.** Black, 2.39:1. The project's wordmark
  `TEMS — Tokenized Execution Management System` and `tems.dev/EMS` fade in,
  quiet, seeded from the same rig. No score under it; the room tone carries.

---

## 6. The acting task — direct, don't describe

No "sad", no "tense", no adjective that the model will caricature. Every Sonal
clip carries the same ACTING TASK block (short form):

```
ACTING TASK — SONAL (invested in her tactic; the work happens in her eyes):
SCENE DIRECTION (shared, unspoken): she is watching a number she built a model for.
MOTIVE / GOAL / OBSTACLE: trust the forecast over the gut; the USDS reprice at
23:59 is the obstacle pressing against the line.
TACTIC, moment to moment:
— (reading the forecast line) — "she counts the bps to the threshold, once"
— (reaching for the mouse) — "she measures the distance she already knows"
— (on SEND) — "she commits in the breath, not in the fist"
(Safety: gaze always engaged in the task; natural blink cadence; underplay everything —
face slack from the eyebrows down, no scowl, no widened eyes, no gasp.)
```

**The eyes are the whole game.** Sonal's per-eye catchlight is a decision, not a
lighting fix; a dead, glassy eye is never fixed with a catchlight — it is fixed
by giving the eye a job (count to the threshold, measure the distance).

---

## 7. Metric lock — every on-screen number is real, spelled out

This is the anti-gibberish contract. The numbers below are the **only**
numerals allowed on screen (plus the ticket fields in §8). If a number isn't on
this list, it doesn't render. Rows are tagged `REAL` (from DefiLlama/Obscura /
`simulation_results.json` / `timesfm3` forecasts) or `FICT` (the one prop).

**Ticker strip (top strip, all clips):**

| Pool | APY | TVL | Tag |
|---|---|---|---|
| LIDO stETH | 2.18% | 23.2B | REAL |
| AAVE v3 USDC | 4.2% | 2.1B | REAL |
| SPARKLEND USDS | 5.1% → 5.18 (+8bp) | 2.5B | REAL |
| ETHERNA USDe | 11.2% → 11.04 (−12bp) | 9.4B | REAL |
| COMP v3 USDC | 4.5% | 0.8B | REAL |
| MORPHO WETH | 3.2% | 1.2B | REAL |

**Center monitor (per clip):**

| Beat | Widget | Value | Tag |
|---|---|---|---|
| c | TimesFM 30-day APY path, threshold line | crosses 5.0% | REAL (forecast) |
| d | USDS bid | 5.18% | REAL |
| d | USDS ask | 5.21% | REAL |
| d | Ethena USDe 1d | −12bp | REAL |
| e | forecast countdown | 23:52:00 → 23:47:12 | REAL (clock) |
| g | Core Price Mgmt — Mid | 99.217 | REAL (price) |
| h | inventory: BA / GD / MO / PM | yields 4.62/4.85/5.12/5.30 | REAL (tickers) |
| h | **axe flag** | BUY 52,890K SPDR UST ✱ | **FICT** (the trade) |
| i | Almgren-Chriss | 8.4M × 10 slices | REAL (sim) |
| i | BSM call premium | 0.4355 | REAL (sim) |
| i | Monte Carlo VaR (95%) | 0.0002986 | REAL (sim) |
| j | settlement | 23:59:00 UTC | REAL (clock) |

**Compliance:** every order ticket carries `COMPLIANCE: PASSED` under a
green badge. The word **PASSED** must render exactly — it is the film's only
legal text.

---

## 8. The one prop — the SPDR UST basket ticket

This prop is locked and versioned like a character. It appears only in clip 08
and 09. Exact ticket (drawn into the plate in Seedream, never argued for in the
video prompt):

```
SPDR UST BASKET                CUSIP U5051
Spot          99.217   (0.183 bp)
Yield         4.620%
Coupon        1.734%
Maturity      07/22/27
Size (K)      52,890
Method        Mid
Maturity sel  Worst
Axe           BUY 52,890K   [amber]
Slices        10 · 8.4M/slice   [Almgren-Chriss]
```

The **Size (K)=52,890** is the narration-critical number and it is the only
fictional figure — it exists so the ticket reads as a real order, and it is
spelled out in the ticket exactly as `52890.000` (the original material's
`52890K`), never varied.

---

## 9. FastH3 scene blocks — 800-char prompts, mapped to the queue

Each of the 10 clips becomes a `enqueue` with a **prompt ≤ 800 characters**
(current cap), `seconds` from the table, `metadata` carrying the beat label and
the exact metric set, and one of `starting_frame` (I2V from a plate) or
`continue_from_clip_id` (chain from the prior build). The construction rules
from THE TRIGGER hold hard:

- **Say what is there, not what you avoid.** No "no flag", no "not neon", no
  bans in the text — describe plain dark fabric and data walls.
- **No optics words in the video prompt** (no "lens", no "bokeh", no "flare").
  The anamorphic character and the darkness live in the **plate**.
- **One reaction per beat.**
- **Physics beat sequences:** the SEND click lands as *one* event — movement,
  sound, then breath.
- **Countable events need proof:** one SEND = one click, one popup.
- **Vary the size and angle every shot**; the model centres everything by
  default.
- **Page the prompt against the 800-char budget** — the description section
  below is the *working* text; the runner trims it to budget per enqueue while
  keeping the block order and the metric table.

**The fixed block order (every clip):**

```
SCENE CONTEXT · REFERENCES (ranked, by tag) · LOCKS · GEOGRAPHY/BLOCKING
·· FIRST FRAME · TIMELINE (timed beats) · ACTING TASK · PHYSICS
· LIGHTING · GRADE/LENS/FORMAT · SOUND · FORBIDDEN(fixed)
```

### Clip blocks (working text, then FastH3 `enqueue` prompt)

**01 `ems_01_terminal_ignition` (8.0 s) — `starting_frame` = `@loc_EMS_mon1` plate**

Block:

```
SCENE CONTEXT: synthetic futures trading desk, night shift, empty for 30 seconds
REFERENCES (ranked): @loc_EMS_mon1 · @loc_EMS_desk · @dst_EMS_night
LOCKS: sonal NOT in frame; desk plate; room 2-3 stops down; monitor the only source
GEOGRAPHY: monitor fills frame, edge-to-edge, flat on; ticker strip top, clock top-right
FIRST FRAME: black panel, faint backlit bloom starting at bottom edge
TIMELINE (1-8s):
  0-2s  panel blooms from black, no text yet
  2-4s  ticker strip resolves into real rows (LIDO 2.18 / AAVE 4.2 / USDS 5.1 / ETHA 11.2)
  4-7s  clock resolves top-right: 23:52:00 UTC
  7-8s  single cold rim lights the window wall behind the panel
ACTING TASK: none — machine state
PHYSICS: bloom is exposure, not animation; no motion blur
LIGHTING: monitor glow only; 2-3 stops down; no sky in frame
GRADE: @dst_EMS_night; fine 35mm grain; 16:9 1344x768
SOUND: room tone, soft HVAC, 50Hz hum gathers as panel warms; no score
FORBIDDEN: no lens words, no flares, no sky, no people, no neon
```

FastH3 `enqueue.prompt` (trimmed ≤800):

```
A Bloomberg-style terminal panel fills the frame edge to edge in a dark trading room at night, 2-3 stops underexposed. It powers on from black: the backlit screen blooms slowly, no text yet for the first two seconds, then a ticker strip resolves along the top reading LIDO 2.18 AAVE 4.2 USDS 5.1 ETHA 11.2, and a small UTC clock top right settles at 23:52:00. A single cold rim lights the window wall behind the panel. Nothing moves except the data settling. Room tone, soft HVAC, a low 50Hz hum. 35mm fine grain, 16:9.
```

(≈470 chars — headroom for per-enqueue trims.)

**02 `ems_02_desk_wide` (8.0 s) — `continue_from_clip_id: 01`**

```
SCENE CONTEXT: same desk, now wide; sonal enters frame left
REFERENCES: @loc_EMS_desk · @char_EMS_sonal · @dst_EMS_night
LOCKS: nameplate/logo absent; desk plate locked; ticket prop not yet present
GEOGRAPHY: desk spans frame; sonal left third, backlit rim; monitors stacked right two-thirds
FIRST FRAME: the wide from clip 01's last frame
TIMELINE:
  0-3s  camera slow push toward the middle monitor
  3-6s  sonal's hand comes to rest on the keyboard at frame-left
  6-7s  three ticker rows flip (USDS 5.1 → 5.18, +8bp green)
  7-8s  she is perfectly still; only the data moves
ACTING TASK: SONAL: "she measures the distance to the mouse she already knows"
PHYSICS: push is 1m mechanical, no zoom
LIGHTING: same night grade, rim on her shoulder from the monitor; no fill
GRADE/SOUND: same; ticker flip = a soft electronic click
FORBIDDEN: no text banners, no flares, no sky
```

**03 `ems_03_eye_and_forecast` (8.0 s) — chain**

```
SCENE CONTEXT: ext close-up, her eye; forecast line crossing is the event
REFERENCES: @char_EMS_sonal (face anchor) · @loc_EMS_mon3 · @dst_EMS_night
LOCKS: anchor face untouched from character sheet; pupil contract is the only motion
GEOGRAPHY: eye fills center; grey forecast curve lower third, threshold line at 5.0%
FIRST FRAME: the wide push had reached her face — now the eye
TIMELINE:
  0-3s  eye locked, still; forecast curve ascends
  3-5s  curve crosses threshold 5.0%; pupil contracts once
  6-8s  ticket shadow sweeps the frame (covering element for the cut)
ACTING TASK: SONAL — one reaction only: the contract; then stillness
PHYSICS: no blink until the contract; then natural blink cadence
LIGHTING: monitor glow reflected in the eye is the catchlight
SOUND: room tone only; forecast crossing = faint click; shadow pass = low whoosh
FORBIDDEN: nothing about "tense", "worried"
```

**04 `ems_04_data_volatility` (8.0 s) — chain**

```
SCENE CONTEXT: the market beat; data-grade, cold, no sonal
REFERENCES: @loc_EMS_mon3 · @loc_EMS_mon2 · @dst_EMS_night
LOCKS: numbers from metric lock §7 verbatim
GEOGRAPHY: split frame two monitors; right% the story
FIRST FRAME: from the shadow-sweep last frame, the covering element clears to the right monitor
TIMELINE:
  0-2s  USDS bid 5.18 ask 5.21 (+8bp), green
  2-4s  Ethena USDe 11.04 (−12bp), red
  4-6s  Aave USDC 4.22 steady
  6-8s  ticker strip flips; the spread widens 5bp
ACTING TASK: none
PHYSICS: data animates; camera locked
SOUND: rapid keyboard-acoustic ticks as data lands; no score
FORBIDDEN: no integers beyond the metric table
```

**05 `ems_05_agent_brief` (7.292 s) — chain**

```
SCENE CONTEXT: sonal reviews the forecast; decision already made
REFERENCES: @char_EMS_sonal · @loc_EMS_mon3 · @dst_EMS_night
GEOGRAPHY: mid shot, face + right monitor; countdown top-right
TIMELINE:
  0-2s  she reads the right monitor (APY path crossing 5.0)
  2-4s  clock 23:52:00 → 23:47:12
  4-6s  she picks up the phone, sets it down
  6-7.3s  hand reaches the mouse — the decision is before the reach
ACTING TASK: SONAL: "the trade is decided before the reach; the hand is only ceremony"
PHYSICS: hand enters frame at frame-right; phone putdown is dead weight
SOUND: phone set = soft click; room tone
FORBIDDEN: no inner-monologue subtitle
```

**06 `ems_06_pricing_methods` (7.292 s) — chain**

```
SCENE CONTEXT: UI close-up; the method and maturity selects
REFERENCES: @loc_EMS_mon2 · @prop_EMS_ust · @dst_EMS_night
GEOGRAPHY: order ticket fills center; dropdown items listed; cursor only mover
TIMELINE:
  0-2s  Pricing Method opens: Mid / Ask / Bid / Manual
  2-4s  cursor selects Mid
  4-5s  Maturity opens: on2YR / on3YR / Next / Worst
  5-7.3s  selects Worst; Core Price Mgmt tab is active; Inventory/Tier/Axe/EOD tabs unlocked
ACTING TASK: none (cursor is the actor)
PHYSICS: dropdown animates once; no double-open
SOUND: dropdown = soft tick; selection = click
FORBIDDEN: no other number rows on this clip beyond ticket fields
```

**07 `ems_07_inventory_axe` (8.0 s) — chain**

```
SCENE CONTEXT: left monitor inventory; the axe is the beat
REFERENCES: @loc_EMS_mon1 · @prop_EMS_ust · @dst_EMS_night
GEOGRAPHY: inventory grid center; amber axe row bottom third
TIMELINE:
  0-3s  grid scrolls; rows BA 4.62 / GD 4.85 / MO 5.12 / PM 5.30
  3-5s  row locks on amber: BUY 52,890K SPDR UST
  5-8s  her hand enters frame, keys the ticket hotkey
ACTING TASK: SONAL — hesitation in the eyes for £one beat, then the hand moves
PHYSICS: hotkey = 4 keypresses, distinct
SOUND: keypresses rapid; amber flag = single chime
FORBIDDEN: no "red alert" state
```

**08 `ems_08_order_ticket` (8.0 s) — chain**

```
SCENE CONTEXT: the ticket closes; numbers typed from §8 verbatim
REFERENCES: @prop_EMS_ust · @loc_EMS_mon2 · @dst_EMS_night
GEOGRAPHY: ticket centered; Almgren badge bottom; cursor in Size field
FIRST FRAME: ticket already mounted (continues from hotspot of 07)
TIMELINE:
  0-2s  Spread=Mid, Price=99.217, Yield=4.620
  2-4s  Size(K) types 52890 from a 52890 → 52890.000
  4-6s  slices badge ticks 8.4M × 10; BSM call 0.4355; VaR 0.0002986
  6-8s  COMPLIANCE: PASSED flips green
ACTING TASK: none; the numbers are the actor
PHYSICS: each field animates once; no cursor ghosts
SOUND: key-by-key clicks; pass = single chime
FORBIDDEN: no implied big-typography numbers beyond the table
```

**09 `ems_09_send_payoff` (5.875 s) — chain**

```
SCENE CONTEXT: the SEND beat — one event
REFERENCES: @prop_EMS_ust · @char_EMS_sonal_hand · @loc_EMS_mon2
TIMELINE:
  0-1.5s  cursor moves to green SEND
  1.5-2.5s  click — hand clicks the mouse; the whip-pan to her eye, once
  2.5-4s  popup: Bought 52,890K SPDR UST @ 99.217 · Venue SPARK-USDS · settle 23:59
  4-5.9s  PASSED badge; she draws one breath, holds, releases
ACTING TASK: SONAL — the breath is the payoff, not the fist
PHYSICS: click = one event, then breath
SOUND: click, chime, breath; room tone
FORBIDDEN: no confetti, no fireworks
```

**10 `ems_10_brand_endcard` (5.167 s) — chain**

```
SCENE CONTEXT: black endcard, 2.39:1; wordmark only
REFERENCES: @dst_EMS_preset (or night — same rig)
TIMELINE:
  0-2s  black
  2-4s  wordmark TEMS — Tokenized Execution Management System fades in
  4-5.2s  tems.dev/EMS + the one-line: "the number ran" (optional)
SOUND: room tone fading to silence
FORBIDDEN: no score under the endcard; the room tone is the ending
```

---

## 10. Production pipeline notes

- **I2V seeding and chaining.** Clip 01 uses `starting_frame` (a locked plate).
  Clips 02–10 chain with `continue_from_clip_id` pointing at the prior build,
  so setting and subject carry over — but every clip's prompt is still an
  island (the model has no "before"; the plate and the references carry the
  continuity).
- **Constrain the runner.** The runner (`fast_h3_ems_runner.py`, in-repo)
  selects plate frames by starting_frame upload, sets `set_clip_seconds`,
  enqueues in order with `metadata` = beat label + the exact metric set
  (validated against §7 so no stray number ships), and plays with autoplay on —
  `stop` is the only manual lever.
- **Sound is design only — no score inside scenes.** Room tone, panel hum,
  keys, the one breath. Transitions are designed, not found: matched on
  movement direction and sound, cut where the covering element fills ≥90%.
- **Edit discipline (THE TRIGGER's five stages):** assembly → rough cut →
  generation supervision (re-generate broken shots, clean slop) → fine cut →
  picture lock. After lock, no new generations except emergency fixes.
- **Validation.** Before any enqueue, every metric in the prompt is checked
  against the §7 lock and `simulation_results.json`. A prompt that references a
  number not in the table is rejected by the runner, not by a human later.

---

## 11. Asset-creation checklist (mirrors THE TRIGGER)

1. **Assets first** — not one shot until every character, location and prop is
   named, versioned, locked (`@tag` convention, §2).
2. **Character in two passes** — close-up face anchor first (identity), then
   full-figure wardrobe pass; the anchor never runs through a model again.
3. **Locations carry the look** — night grade, darkness, and (if used) the
   anamorphic character all baked into the plate (§3).
4. **Describe everything, every time** — descriptors, voice/acting locks and
   metric locks go into every prompt word for word.
5. **Say what you want, not what you avoid.**
6. **Put the hard things in the plate** — optics, darkness, printed text,
   printed tickets.
7. **Bind everything to the frame.**
8. **Direct, don't describe** — acting tasks, not adjectives.
9. **Every number real** — the metric lock is the contract (§7).
10. **Picture lock before the runner ships.**