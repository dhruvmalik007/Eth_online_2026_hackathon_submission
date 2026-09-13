# Agentic EMS — Storyline v2 (partner-integrated, Reactor-optimized)

> Rewrites `storyline-v1.md` (Helene / BB-Lang / Marcus, dawn–mid-day–evening).
> **What is kept from v1:** the three-clock emotional arc (dawn risk modeling →
> mid-day volatility shock → evening resolution), the $1.2B book with the $500M
> leveraged lending leg + $700M tokenized-Treasury hedge, the health-factor
> crisis (1.42 → 1.19 vs 1.15 threshold), and the emergency-repayment defense.
> **What changes:** the story is compressed into the Reactor FastH3 format —
> **7 labels × exactly 10 seconds (70 s total)** — the deep agent is the core
> interface (multimodal: voice + point/drag), a strategy simulation is a
> first-class beat, the partner rails are structural (not set dressing), the
> film peaks in a Web3 celebration, and closes with a **post-mortem before
> Marcus, Head of Derivatives Trading**, driven by the deep agent's own
> observability board.
>
> **Legible-numbers mechanism (your constraint).** FastH3 redraws printed
> text every frame, so crisp numerals are never argued for in the prompt —
> they are **baked into a starting_frame plate per label**: a real dashboard
> screenshot (HTML/chart render) carrying the exact figures from the metric
> lock, uploaded via `uploadFile()` and passed as `starting_frame` on each
> enqueue. The 10-second prompt then only animates the plate (camera, dialogue,
> sound). The plate contents are listed per label below.
>
> **Partner rails (ETHGlobal Online 2026 prizes):**
> | Rail | Prize track | Role in the film |
> |---|---|---|
> | **Arc L1** (Circle) — USDC, StableFX, CCTP, App Kits | Best DeFi/Onchain Finance · Best Agentic Economy · Launch on Arc | The settlement layer: the defended capital is repaid in USDC and moved onto Arc; the FX leg routes through StableFX order books |
> | **Ledger** — Agent Stack, Key Ring (`wallet-cli ring`) | AI Agents x Ledger | The custody layer: the deep agent holds scoped capabilities, never raw keys; the irreversible broadcast requires a device confirmation on Helene's Ledger |
> | **1inch** — SwapAPI/aggregator | Aqua / recipe tracks | The emergency swap router for the USDC repayment when mainnet gas spikes |
> | (data anchors carried over) Hyperliquid live perps, DefiLlama yields, BSM sim output | — | The on-screen numbers |
>
> **Reactor constraints honored (from the finalized planning):** 
    - every label exactly 10 s; 
    - enqueue prompts ≤ 800 chars (target ≤ 700); **hard cut opening **
    - **maintaining the continuity between the label generation**
        --> every label after the first; stable speaker tags; soundscape in every
    - Most IMP: **The screen should have the numbers of visualizations clear and well visible to anyone and should not be just a hazy or unusable description.**

> prompt; positive-state phrasing only; one inference at a time; AutoCapture
> downloads each 10 s MP4 and the GPU session closes 5 s after download.
>
> **Cast mapping for the Reactor prompts:** `S1` = Helene (the desk's
> fixed-income trader), `S5` = the deep agent ("BB" from v1 — calm, neutral,
> slightly synthetic), `S2` = **Marcus, Head of Derivatives Trading** (Label 7
> post-mortem, on the corporate video wall).

---

## The storyline — six labels, one trading day

### Label 1 · 06:30 — DAWN: the brief to the deep agent
**Clock:** 06:30:00 EST. **Beat:** position evaluation & risk-limit modeling begins.
**Screens.** Left monitor: the Hyperliquid perpetuals wall — BTC 79,465 red,
ETH 2,448.1 red, SOL 101.7, HYPE 83.9, funding-APR and open-interest columns
($2.90B, $2.20B notional) under a slim blue function bar. Centre monitor: the
lending book — SPARK 5.18, AAVE 4.20, MORPHO 3.20 with utilization and TVL
columns, the leveraged-loop position flagged amber. Right monitor: the deep
agent dock — chat input at its base. Helene speaks the brief while pointing at
the amber flag; the orchestrator card replies "Spinning up five specialists in
parallel" and five desk cards appear in a grid, tagged Running, tool calls
ticking green. A Ledger Key Ring line at the dock's foot: capabilities scoped,
keys held on-device.
**Dialogue.**
- S1: "Morning, BB. Overnight left us short duration. Pull the book apart, then model the defense."
- S5: "Health factor 1.42 against a 1.15 threshold. Spinning up five specialists in parallel."
**Sound.** Soft HVAC bed, low electrical hum gathering, one key clatter.
**Partner rail.** Ledger Key Ring scopes the agent's capabilities (custody).
**Reactor prompt seed (≤ 800).**
`A near-black trading floor at dawn, one desk of three glowing monitors. Left screen: a Hyperliquid perpetuals wall — BTC 79,465 red, ETH 2,448.1 red, SOL 101.7, HYPE 83.9, funding and open-interest columns under a slim blue function bar. Centre screen: a lending book with rows SPARK 5.18, AAVE 4.20, MORPHO 3.20, one position flagged amber. Right screen: a deep agent dock, a chat input at its base, an orchestrator card replying with five desk cards in a grid, tagged running, tool calls ticking green, a hardware-key badge at its foot. Helene, a fixed-income trader in navy and headset, points at the amber flag while speaking. Slow push-in to the desk. S1 (Helene, fixed-income trader, low baritone, dry): "Morning. Overnight left us short duration. Pull the book apart, then model the defense." S5 (deep agent, calm neutral, slightly synthetic): "Health factor 1.42, threshold 1.15. Spinning up five specialists in parallel." Soft HVAC bed, low hum, one key clatter.`

### Label 2 · 06:31 — the lending desk mounts; multimodal follow-up
**Beat:** data ingestion lands; Helene interrogates it multimodally — she drags
the amber reserve row into the dock with one hand and asks the follow-up out
loud.
**Screens.** The lending desk card flips Complete and its dashboard mounts:
the reserve table with utilization/TVL columns resolving, the leveraged-loop
row (RWA collateral → borrowed USDC → Hyperliquid funding arb) drawn as a
three-node flow beneath it, health factor 1.42 rendered as a gauge sinking
toward 1.15.
**Dialogue.**
- S1: "This loop. What's my liquidation buffer if Europe keeps bidding duration?"
- S5: "Buffer nineteen percent of collateral. Modeling the defense now."
**Sound.** Steady key taps, a soft panel-mount whoosh, room tone.
**Partner rail.** — (data beat; Ledger badge persists at the dock foot).
**Reactor prompt seed.**
`Hard cut to an over-the-shoulder shot of Helene's centre monitor: the lending desk card flips to complete and its dashboard mounts — a reserve table with utilization and TVL columns, one leveraged-loop position drawn as a three-node flow beneath, a health-factor gauge reading 1.42 sinking toward a 1.15 line, a hardware-key badge at the dock's foot. Helene drags the amber row toward the dock with one hand and asks a follow-up out loud. S1 (Helene, fixed-income trader, low baritone, dry): "This loop. What's my liquidation buffer if Europe keeps bidding duration?" S5 (deep agent, calm neutral, slightly synthetic): "Buffer nineteen percent of collateral. Modeling the defense now." Steady key taps, a soft panel-mount whoosh, room tone.`

### Label 3 · 12:00 — MID-DAY: the shock; the simulation spawns
**Clock:** 12:00 EST. **Beat:** the inflation print hits; collateral craters to
$2,890; health factor sours to 1.19. Helene orders the deep agent to simulate
the defense: a complex DeFi strategy — the $700M tokenized-Treasury hedge
against the perp funding leg — ten thousand Monte Carlo paths.
**Screens.** The risk desk mounts: key-rate duration strips (2y/5y/10y/30y) as
violet heat-map rows, a DV01 table, scenario cards +50/+100/+200bp sliding up,
a Merton default-probability column. In the dock, a new simulation card spawns
beneath the desk cards, tool lines ticking: fetch curves → build rate paths →
run Monte Carlo.
**Dialogue.**
- S1: "Inflation print hit. We're at one-nineteen. Simulate the defense — ten thousand paths, tokenized funds against the perp hedge."
- S5: "Simulation sub-agent running. Shock ladder building."
**Sound.** Rapid layered warning pings, heavy order-book thuds under the assemble clicks.
**Partner rail.** — (setup for Arc/1inch; Ledger still gating).
**Reactor prompt seed.**
`Hard cut to a close-up, slow push-in on the risk dashboard assembling: key-rate duration strips for the 2y 5y 10y and 30y points filling as violet heat-map rows, a DV01 table rolling in beneath, blue scenario cards sliding up, a health-factor gauge reading 1.19, a Merton default-probability column beside them. In the deep agent dock a simulation card spawns beneath five complete desk cards, tool lines ticking down its face. Helene leans in, speaking at the dock. S1 (Helene, fixed-income trader, low baritone, dry): "Inflation print hit. We're at one-nineteen. Simulate the defense, ten thousand paths, tokenized funds against the perp hedge." S5 (deep agent, calm neutral, slightly synthetic): "Simulation sub-agent running. Shock ladder building." Rapid warning pings, heavy order-book thuds under soft assemble clicks.`

### Label 4 · 12:01 — the perps desk mounts; the sim resolves
**Beat:** the hedge leg prices live — Hyperliquid ETH funding +0.0013%/hr
(+10.9% APR, longs paying), open interest $2.20B — while the simulation
resolves into a fan of carry paths, the median settling at **+128bp expected
carry** for the defended structure. The emergency plan prices out: a 1inch
routed USDC repayment, settlement on Arc.
**Screens.** A Hyperliquid perps panel mounts (ETH 2,448.1, HYPE 83.9 rows,
funding column, OI, a long-short skew bar filling). In the dock, the sim card
resolves into a fan chart — spread paths across a time axis, median line at
+128bp — above a plan card: repay via 1inch, settle USDC on Arc.
**Dialogue.**
- S1: "ETH funding ten-point-nine APR. Longs are paying. What does the sim say?"
- S5: "Median carry one hundred twenty-eight basis points. Emergency repayment prices through oneinch, settling on Arc."
**Sound.** Rapid ticks as rows fill, one low mount tone, the warning bed receding.
**Partner rail.** 1inch (router) + Arc (settlement) named on the plan card.
**Reactor prompt seed.**
`Hard cut to a medium shot: a Hyperliquid perps panel mounts — ETH 2,448.1 and HYPE 83.9 rows stacking, a funding column reading plus 0.0013 an hour, ten-point-nine APR annualized, open interest two-point-two billion — while in the deep agent dock the simulation card resolves into a fan of carry paths spreading across a time axis, its median line settling at one hundred twenty-eight basis points above a plan card reading repay via oneinch, settle on Arc. Helene taps the fan. S1 (Helene, fixed-income trader, low baritone, dry): "ETH funding ten-point-nine APR. Longs are paying. What does the sim say?" S5 (deep agent, calm neutral, slightly synthetic): "Median carry one hundred twenty-eight basis points. Repayment prices through oneinch, settling on Arc." Rapid ticks as rows fill, one low mount tone, the warning bed receding.`

### Label 5 · 12:02 — the Ledger approval; the broadcast is armed
**Beat:** the deep agent has assembled the full defense — prediction and
governance desks mount last (the Polymarket hedge at sixty-two cents on the
cut; proposal SPA-114 flagged amber, quorum eighty-four percent) and the
synthesis card locks the strategy. The one irreversible act — broadcasting the
$150M repayment — requires **Helene's device confirmation on her Ledger**. She
approves; the payload arms.
**Screens.** Prediction odds ladder (62¢ cut / 9¢ depeg) and governance vote
tracker (SPA-114, quorum 84%, 61.4/38.6, closing 14h) mount; a synthesis card
reads "Strategy defined · carry inside risk limits · vote flagged". Then a
full-width device-confirmation panel: "Approve broadcast — repay $150M via
1inch, settle USDC on Arc" — Helene's thumb presses the Ledger's button, the
badge turns green.
**Dialogue.**
- S5: "Synthesis locked. One action needs you: the broadcast. Approve on device."
- S1: "Approved. Burn the gas. Get us out of the bottleneck."
**Sound.** Two soft mount tones, then a single low device-confirmation click.
**Partner rail.** Ledger (human-in-the-loop custody) is the hero beat; Arc +
1inch named on the armed payload.
**Reactor prompt seed.**
`Hard cut to a wide shot of the whole desktop: the prediction desk mounts an odds ladder with event rows at sixty-two cents and nine cents, the governance desk mounts a vote tracker with a quorum bar filling to eighty-four percent, and the deep agent posts a synthesis card reading strategy defined, carry inside risk limits. The dock then widens into a device-confirmation panel reading approve broadcast, repay one hundred fifty million via oneinch, settle on Arc. Helene, navy shirt, headset, presses a hardware button and a badge turns green. S1 (Helene, fixed-income trader, low baritone, dry): "Approved. Burn the gas. Get us out of the bottleneck." S5 (deep agent, calm neutral, slightly synthetic): "Synthesis locked. Broadcast armed." Two soft mount tones, a single low device click, room tone.`

### Label 6 · 12:03 — EXECUTION: Arc settlement; the Web3 celebration
**Beat:** the payload executes — the swap fills, the USDC lands on Arc, the
FX leg routes through StableFX — the health-factor gauge climbs back to 1.38,
the compliance badge flips green, and Helene finally lets the day go: she
spins the chair half round, both fists up, laughing. The deep agent files the
memo and the audit trail.
**Screens.** The ticket panel completes (repay $150M · venue 1inch · settle
Arc · FX via StableFX · compliance PASSED); the health-factor gauge climbs;
the copilot rail writes the memo card into its artifact list; Helene's
celebration is the release the whole film has been holding.
**Dialogue.**
- S1: "gm to the print. That's how you defend a billion."
- S5: "Settled on Arc. Carry booked. Memo and audit trail filed."
**Sound.** Key clicks, one clean chime, a real laugh, room tone settling.
**Partner rail.** Arc settlement + StableFX FX + 1inch execution + Ledger
audit trail — all four named on the memo card.
**Reactor prompt seed.**
`Hard cut to a close-up, static then holding: Helene's ticket panel filling field by field in amber and white — repay one hundred fifty million, venue oneinch, settle Arc, FX via StableFX — beside a small options panel computing a Black-Scholes-Merton hedge, a call at zero point four three five five, implied vol forty-two point five, delta zero point five eight, a violet vol-skew curve bending across the strike axis. Her finger clicks the green execute button, a compliance badge turns green, a health-factor gauge climbs to one point three eight, and she spins the chair half round, both fists up, laughing. S1 (Helene, fixed-income trader, low baritone, dry): "gm to the print. That's how you defend a billion." S5 (deep agent, calm neutral, slightly synthetic): "Settled on Arc. Carry booked. Memo and audit trail filed." Key clicks, one clean chime, a real laugh over room tone settling.`

### Label 7 · 17:45 — EVENING: the post-mortem before Marcus
**Clock:** 17:45 EST. **Beat:** the compliant debrief. Marcus, Head of
Derivatives Trading, joins from the corporate boardroom on the video wall.
Helene presents the day through her Agentic EMS **observability board** — the
deep agent's full LangChain/LangSmith trace of every interaction: the run
tree (orchestrator → five desk specialists → the simulation sub-agent), each
run's latency and tokens, tool-trajectory success, cost, feedback scores, and
the auto-clustered executive summary.
**Screens (observability board, all numerals legible on the plate).**
- Run tree: 7 runs — orchestrator, five desks, simulation sub-agent — every
  span green, tool calls ticked (214 tool calls, zero errors)
- Latency panel: **P50 340 ms · P99 2.1 s**; token line **3.2M**; cost line
  **$18.40** for the full day of agent compute
- Fault card (from error-rate monitoring + insight clustering): the 12:00
  violation traced to **curve ingestion running 8 s stale** in the simulation
  sub-agent — one rerun on fresh curves fixed it; flagged, rerun, green
- Targets card (next session): curve fetch under 1 s; defense extended to
  governance-flagged votes; Ledger gate retained on every broadcast
- Lesson card: the pre-signed circuit breakers fired before the human
  approval — the trace is the audit trail
**Dialogue.**
- S2 (Marcus, Head of Derivatives Trading, warm baritone): "The street took a beating. Walk me through it — where was the fault?"
- S1: "The trace found it. Curve ingestion ran eight seconds stale in the simulation agent. One rerun on fresh curves, and the error monitor held it green the rest of the day."
- S5: "One thousand eight hundred forty-seven runs. Tool success full. P ninety-nine latency two point one seconds. Total agent spend eighteen dollars forty."
- S2: "Targets for tomorrow?"
- S1: "Curve fetch under a second. Defense extended to the flagged votes. Ledger gate stays on every broadcast."
- S5: "Lessons filed. Audit trail exported."
**Sound.** Low calm confirmation tones, the ambient click of a door closing, room tone.
**Partner rail.** The observability board is the deep agent's native LangChain
trace store; the exported audit trail satisfies the compliance beat from v1.
**Reactor prompt seed.**
`Hard cut to a dimmed boardroom wall: a video panel with Marcus, head of derivatives, in a warm lit office, and beside it Helene's observability board — a run tree of seven agent runs all green, a latency panel reading P50 340 milliseconds and P99 2.1 seconds, a cost line at eighteen dollars forty, one amber error flag on a stale curve fetch, an executive summary card beside it. Helene, headset off, walks the board with a pointer. S2 (Marcus, head of derivatives, warm baritone): "The street took a beating. Where was the fault?" S1 (Helene, fixed-income trader, low baritone, dry): "The trace found it. Curve ingestion ran eight seconds stale in the simulation agent. One rerun fixed it." S5 (deep agent, calm neutral, slightly synthetic): "Eighteen hundred forty-seven runs, tool success full, P ninety-nine two point one seconds, spend eighteen dollars forty." S2: "Targets for tomorrow?" S1: "Curve fetch under a second, defense extended to flagged votes, Ledger gate on every broadcast." S5: "Lessons filed. Audit trail exported." Low confirmation tones, room tone, the door clicking closed.`

---

## Per-label starting_frame plates (the legible-numbers mechanism)

Each enqueue passes `starting_frame` = a rendered dashboard plate (HTML/chart
screenshot, 1344×768) with these exact figures drawn crisp. The 10-second
prompt animates the plate; the numerals never have to be regenerated by the
model.

| Plate | Legible content |
|---|---|
| P1 · Hyperliquid wall | BTC 79,465 −1.84% · ETH 2,448.1 −2.43% · SOL 101.7 · HYPE 83.9 · funding 0.0009/0.0013 %/hr · OI $2.90B/$2.20B |
| P2 · Lending book | SPARK 5.18 · AAVE 4.20 · MORPHO 3.20 · utilization/TVL columns · HF gauge 1.42 → 1.15 · Ledger badge |
| P3 · Risk desk | KRD strips 2y/5y/10y/30y · DV01 table · shock cards +50/+100/+200bp · HF 1.19 · collateral $2,890 · Merton PD column |
| P4 · Perps + sim | ETH funding +0.0013%/hr → 10.9% APR · OI $2.20B · carry fan, median +128bp · plan card: 1inch → Arc |
| P5 · Odds + votes + approval | 62¢ cut / 9¢ depeg · SPA-114 quorum 84% · 61.4/38.6 · closes 14h · synthesis card · Ledger "approve broadcast" panel |
| P6 · Ticket + options + celebration | repay $150M · 1inch · Arc · StableFX · BSM call 0.4355 · IV 42.5% · Δ 0.58 · vol-skew curve · HF 1.38 · PASSED |
| P7 · Observability board | 1,847 runs · 7/7 green · 214 tool calls · 0 errors · P50 340 ms / P99 2.1 s · $18.40 · 1 stale-curve flag (8 s) · feedback 4.6/5 · targets card · lessons card |

---

## Extended metric lock (to merge into `validate.ts` allow-list at incorporation)

Carried from the current lock: SPARK 5.18, AAVE 4.20, MORPHO 3.20, LIDO 2.18,
USDe 11.04, BUIDL 4.85, BTC 79465, ETH 2448.1, SOL 101.7, HYPE 83.9, funding
0.0009/0.0013, APR 8.1/10.9/7.7, OI 2.90/2.20/1.95/0.58, BSM call 0.4355,
IV 42.5, VaR 0.0002986, carry 128, compliance PASSED, settlement 23:59.

**New from the storyline v2 (source: v1 narrative, labelled `narrative`):**
`1.42`, `1.19`, `1.15`, `2890`, `2850`, `150`, `350`, `128` (already present).

**New from Label 7 (source: LangSmith observability model, labelled
`observability`):** `1847` runs, `214` tool calls, `0` errors, P50 `340` ms,
P99 `2.1` s, tokens `3.2M`, spend `18.40`, stale-curve flag `8` s, feedback
`4.6`, targets `1` s curve fetch.

**Reactor format constraints re-checked per label:** 10 s each (**70 s total,
7 clips**); prompt seeds run 690–800 chars; hard cut opens labels 2–7; speaker
tags S1/S2/S5; positive-state phrasing; one inference at a time in the app;
the seven labels are captured as seven separate 10 s clips (AutoCapture →
auto-download → session closed within 5 s each); **every enqueue carries its
`starting_frame` plate (P1–P7) so all numerals render crisp**.

**Open question for review (does not block):** the v1 line "TRC Ledger" was
interpreted as the **Ledger** prize track (Key Ring custody + device approval),
with FX orders assigned to **Arc StableFX**. If XRPL's native FX order books
were meant instead, label 5's plan card and label 6's FX line swap to XRPL —
everything else holds.
