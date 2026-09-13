---
target: the agent task trace component
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-09-12T10-21-23Z
slug: packages-ux-workflow-src-agent-agent-trace-tsx
---
# Critique — agent task trace (expandable reasoning / evidence / result)

Target: `packages/ux-workflow/src/agent/agent-trace.tsx` (+ `agent-step-detail.tsx`, `series-preview.tsx`, `step-glyph.tsx`, `primitives/accordion.tsx`, `primitives/collapsible.tsx`), wired in `apps/agentic-ems/lib/agent-traces.ts`, `components/demo/ChatStage.tsx`, `components/demo/SimulationStage.tsx`.

Method: dual-agent (A: design review · B: detector + browser evidence).

Mode: **Operate** — a desk operator scanning what the agents did.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | `n/5 done` + glyph/pulse is honest, but a step marked `running` already prints its finished verdict; no per-step latency ever appears (`durationMs` is never populated). |
| 2 | Match System / Real World | 3 | Desk vocabulary (α/β/γ, "verdict: acceptable", PolicyGate) is right, but code leaks into evidence cells: `endpoint=gateway.thegraph.com`, `["eth","arb"]`. |
| 3 | User Control and Freedom | 3 | Single-open accordion and collapsible; no expand-all, no copy-trace, no way to pin a drawer while scanning. |
| 4 | Consistency and Standards | 2 | The same fact renders three ways — labelled EVIDENCE, `key=value` args, and raw JSON; provenance shows `graph` in one place and `gateway.thegraph.com` in another. |
| 5 | Error Prevention | 3 | Read-only, raw payload contained, nothing destructive; but no fixture exercises `failed`. |
| 6 | Recognition Rather Than Recall | 2 | Comparing two parallel subagents is impossible — single-open plus a drawer that reflows the siblings away forces memory of the first result. |
| 7 | Flexibility and Efficiency | 2 | Every inspection costs a click plus a re-find; the grid reflow invalidates the scroll position you learned. |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained, no chartjunk; undercut by 9px faint metadata and duplicated blocks. |
| 9 | Recognize / Diagnose / Recover from Errors | 2 | `failed` glyph and the `error` box exist in code but nothing demonstrates them; a failed risk check does not change step state at all. |
| 10 | Help and Documentation | 2 | The only help is the subtitle "expand a step for its reasoning and evidence" — false for generic steps; no legend for ○◐●✕, no α/β/γ gloss. |

**Total: 25/40 — Acceptable (62%).** No `n/a` heuristics; all ten apply to an Operate surface.

## Design Specificity Verdict

**LLM assessment:** This is a well-crafted *generic* agent tool-call trace, not an agentic-trading-desk instrument. Every domain signal (α/β/γ/VaR/HHI, PolicyGate, `gateway.thegraph.com`) lives in fixture strings in `apps/agentic-ems/lib/agent-traces.ts`; the component is prop-shaped for any LLM product (`call`, `argsSummary`, `evidence[]`, `provenance`, `raw`). Strip the strings and the identical component ships unchanged inside a CI pipeline viewer. The two things a desk trace needs — a *drawn* fan-out converging on the risk engine, and instrument/side/notional/gate-outcome per step — are absent; the topology is asserted in prose, never drawn.

**Deterministic scan:** CLI detector (regex pass over the six `.tsx` targets) returned **exit 0, zero findings**. Verified not a no-op: the same entrypoint on a synthetic `.tsx` returned exit 2 with two findings. Computed size/contrast rules are out of scope for the static pass, so the runtime overlay carries that evidence.

**Runtime overlay** (injection succeeded; live-server stopped afterwards): console reported `[impeccable] 95 anti-patterns found`, with 127 finding lines emitted — the two counts disagree, which is a detector miscount, not a page defect. Per-rule: `undersized-ui-text` ×63, `low-contrast` ×21, `tiny-text` ×19, `line-length` ×8, `cramped-padding` ×6, `nested-cards` ×3, `all-caps-body` ×2, and one each of `repeated-container-text`, `pulsing-dot`, `gpt-thin-border-wide-shadow`, `flat-type-hierarchy`, `dark-glow`.

**Agreement between the two assessments (independent):** Assessment A judged the faint 9–10px metadata to fail AA and estimated ≈3.2:1; Assessment B measured `3.2:1 (need 4.5:1) — text #5f6670 on #101214` and `3.1:1 on #14171a`. Same defect, found twice, by different means. A also called the q10–q90 band "effectively invisible"; B's rule list independently flags the surrounding faint text.

## Overall Impression

The component's *concept* is strong and its information architecture is a genuine decision, not decoration. What lets it down is that the fan-out metaphor — its stated reason to exist — collapses the moment you engage with it, and the surface shows a verdict on a step it is still calling "running". Fix those two and this reads as a desk instrument.

## What's Working

- **One status vocabulary across two surfaces.** `step-glyph.tsx` is shared by the chat tool group and the simulation fan-out, so "running" can never look different in two places; the accessible name carries state via an `sr-only` label.
- **An IA rule enforced in code.** `agent-step-detail.tsx` states and applies "checkable, actionable, or attributable — everything else behind the nested disclosure", with RAW PAYLOAD closed by default (verified: no `<pre>` in the DOM until asked).
- **The forecast is made falsifiable.** `SeriesPreview` renders the median path plus a q10–q90 band and a `now` reference so a forecast claim can be read rather than trusted — with no charting library pulled in.

## Priority Issues

- **[P0] Fan-out collapses on expand.** Opening any of the four parallel cells detaches the other three: they reflow to a row *below* the full-width drawer, orphaning the opened cell above it. Cause: `AccordionItem className="contents"` interleaves each cell (col-span-1) with its own drawer (col-span-full) inside one `grid-cols-4`, so the drawer auto-places into the next grid row. **Why it matters:** the 4-across row is the only thing communicating "four subagents in parallel"; expanding destroys it exactly when the user engages. **Fix:** pin the fan drawer to a fixed late grid row so it always opens below the fan (`gridRowStart`), and use `gap-x` only so the empty implicit rows add no phantom gap. **Command:** `layout`. — *Fixed in this pass.*
- **[P1] The running state already knows the answer.** During `0/5 done`, `risk-engine.decompose` shows `◐ running` while its collapsed row prints "verdict: acceptable — proposal may proceed"; all five steps show `◐ running` simultaneously although the four data agents are meant to precede the engine. **Why it matters:** a status indicator that says "running" beside a finished outcome is a trust failure on a high-stakes surface. **Fix:** add a `queued` state for downstream steps, hold `result.summary` until `done`, and show "awaiting 4 payloads" while running. **Command:** `clarify`.
- **[P1] A failed risk gate is invisible at scan level.** `AgentStepCheck.pass` only swaps a check for a ✕ *inside* the drawer; nothing derives step or group state from it, so a breached gate renders as a green ● done step with a green verdict. **Why it matters:** for a fixed-income desk the one thing the trace must escalate is a breached gate; silence is the most expensive failure mode. **Fix:** derive a `breach`/`warn` state from failed checks, escalate the glyph and group header, surface the failing check in the collapsed row. **Command:** `harden`.
- **[P1] Duplication.** The drawer opens by reprinting the trigger line verbatim; the RESULT metric tiles repeat the six cells of the RiskWidget ~20px below; labels self-duplicate ("VaR VaR95", "HHI Concentration (HHI)"); and the specialist drawer printed `SOURCE timesfm-3` twice. **Why it matters:** it doubles the reading load of the densest moment and makes the user check whether the two blocks disagree. **Fix:** drop the drawer header, let the RiskWidget own factor values, and suppress the step PROVENANCE section when the series already carries its citation. **Command:** `distill`. — *The duplicated `SOURCE` was fixed in this pass.*
- **[P2] Legibility floor fails for exactly the metadata that makes the trace credible.** `--tk-fg-faint: #5f6670` at 9–10px (subtitle, section headings, every evidence label, series footer) measures 3.2:1 — below AA. The q10–q90 band was drawn at `opacity 0.13` and was effectively invisible. **Why it matters:** judges on a projector lose the provenance and uncertainty evidence the whole story rests on. **Fix:** raise the faint token to ≈`#8b93a0`, set a 10px floor for anything carrying a number, and give the band a visible fill plus an edge stroke. **Command:** `colorize`. — *The band was fixed in this pass; the token is a design-system-wide change and remains open.*

## Persona Red Flags

- **Alex (quant, verifies numbers):** opens `risk-engine.decompose` and finds the same six factors already read in the RiskWidget, with self-referential labels ("β Beta", "VaR VaR95"), then hits `["eth","arb"]` raw JSON in an evidence cell where the collapsed row said `chains=eth,arb`. Cannot compare the timeseries 168h-vol evidence against the DeFiLlama pool counts: opening one moved the other three. Tries to read latency — `Duration` is permanently empty because `durationMs` is never populated.
- **Sam (risk/ops, scans for exceptions):** the four collapsed cells show only a name and a green ●, so spotting the one that did something odd means opening all five rows; the gate results they care about are two clicks deep and would be red *inside* the drawer while the step stays green. Reads "verdict: acceptable" on a row still marked `running` and stops trusting the status column.
- **Jordan (judge, 2-minute credibility pass):** the subtitle promises "reasoning and evidence"; expands a generic step and finds no reasoning at all, just a bare slug (`SOURCE graph`) — so the demo's strongest claim is demonstrable on only one of the five steps they might click.

## Minor Observations

- `Duration` is dead in this demo: `durationMs` is never set, so no step shows how long it took even though the component is built for it.
- The 5-specialist fan wraps 4 + 1 in `sm:grid-cols-4`; the fifth sits alone on a second row, reading as an afterthought.
- Heading order starts at h3: each step is an `h3` while the group title "Agent tasks" is a `<p>`, so a screen-reader user gets five sibling headings with no group label.
- Chevrons sit mid-row in the fan, so `DEFILAMA AGENT ⌄ TIMESERIES KEEPER ⌄` reads as if each chevron belongs to the *following* name.
- The group header says "5 tools" for a set of `task(subagent=…)` calls plus a decompose step — a step count labelled a tool count.
- In the simulation stage the trace lives in a fixed 640px scroll box; expanding a specialist pushes PROVENANCE out of view.
- The typewriter gates the trace: it cannot appear until the agent's prose finishes typing (~2s).

## Questions to Consider

1. If the domain specificity lives only in fixture strings, what would this look like if it *knew* what a carry leg was — instrument, side, notional, the gate it passed — so an unrelated product could not use it unchanged?
2. For an operator asking "is my book OK?", why is the reassuring artefact (four green gate checks) one disclosure level down while the ambient RiskWidget reprints the same factors immediately below?
3. Should an in-flight run ever expose its verdict — and what would it take for the collapsed rows to honestly say "started, outcome unknown"?
