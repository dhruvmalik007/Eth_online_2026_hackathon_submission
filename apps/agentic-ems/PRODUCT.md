# PRODUCT.md — Agentic EMS landing page

> Provenance: **inferred** from the founder's brief (2026-09-07 session) + verified build
> artifacts in `packages/the-graph` and `packages/langchain`. No human interview was run;
> every claim below traces to those sources. Amend freely.

## Product

**Agentic EMS** — an agentic Execution Management System for on-chain fixed income.
The pitch in one line: *Bloomberg built the terminal that runs traditional fixed income;
nobody has built the one that runs on-chain fixed income — we are building it, and the
agents do the  research , backtesting and executing with real prediction models.*

The landing page is the pitch: a **single-page site** that explains what is being built
for ETHOnline 2026, how it works, what is already live (real subgraph queries shipped in
this repo), and which sponsored prize tracks it targets.

## Audience

1. **Hackathon judges** (The Graph, 1inch, Uniswap Foundation DMs) — must see, in under
   two minutes of scrolling: live Graph data consumption, standardized-schema leverage,
   agentic reasoning over that data, and credible execution plans.
2. **DeFi fixed-income traders** — must recognize their workflow (yields, durations,
   vegas, funding, risk gates) reflected in the product.

## Success criteria

- A judge can name the prize tracks and the qualification mapping without leaving the page.
- Every number shown is real (traced to subgraph block heights recorded in
  `packages/the-graph/PHASE1_TEST_RESULTS.md`); nothing is a made-up placeholder metric.
- The architecture is legible in one diagram (data → agent → risk → execution).
- Terminal Noir aesthetic: near-black, amber/green data accents, monospace numerals —
  reads as a Bloomberg-terminal challenger, not a generic crypto template.

## Scope of this surface

Single page (`app/page.tsx`) composed of sections: hero terminal + ticker, thesis,
architecture (React Flow diagram), live data, prize-track mapping (The Graph 1.1/1.2,
1inch 5.1 Aqua, Uniswap 7.1), Uniswap v4 dynamic fixed income (dual-hook + vega math),
stack grid, demo video, footer. No routing, no CMS, no backend on this surface.

Out of scope: the old FastH3 video-generation tooling (reactor SDK, clip queue, API
routes) — removed; one pitch video is retained in `public/` for the demo section.

## Voice

Quant-desk precise. Short declaratives. Numbers over adjectives. No hype words
("revolutionary", "game-changing" are banned). Bloomberg is the rival, referenced by
name, respectfully.
