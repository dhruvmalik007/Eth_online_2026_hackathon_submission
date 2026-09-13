# Design brief — `LiquidityFlowRoadmap` (income-flow roadmap widget)

**Status:** approved direction · **Mode:** Operate (trading-desk panel) · **Owner:** Agentic EMS design system
**Evidence:** `packages/reactor-video/vanguard_video/roadmap_widget_video_analysis.md` +
`roadmap_widget_manifest.json` (gemini-2.5-flash, first 12 s of `example-ui-workflow-roadmap-widget.mov`).

---

## 1. Job and audience

A trader, risk operator, or analyst on the Agentic EMS desk needs to read a **cash-flow
decomposition** at a glance: where revenue came from, how much survived as profit, and where the
cost lines went. The source video (`00:00–00:12`) shows exactly this as a **Sankey-style income
waterfall**:

> Taker Fees **$98.64M** → Gross Protocol Revenue → **Gross Profit $61.99M (63%)** → Earnings,
> while **Cost of Revenue $36.65M (37%)** fans out into Maker Rebates $20.79M (57%),
> Liquidity Rewards $9.48M (26%), Referral Rewards $2.6M (7%), Taker Rebates $2.73M (7%),
> Holding Rewards $1.06M (3%). Period shown: **Q2 2026**, source-badged **DeFiLlama**.

The visitor's mode is **Operate**: scan the structure in under two seconds, then interrogate a
single node or a single flow for detail. Success = the split between profit and cost, and the shape
of the cost fan-out, is legible before any hover; hover answers "how much, what share, and what does
this line mean".

## 2. Outcome and proof

- **Primary read:** revenue → profit vs cost split, and the cost composition ranking.
- **Proof it is real:** every amount, percentage, label, and the "Q2 2026" period are taken verbatim
  from the video; the DeFiLlama source is preserved as provenance.
- **Product-specific truth:** this is a **P&L/plumbing diagram**, not a time series. The horizontal
  axis is **pipeline order**, not time — the analysis is explicit about this. Do not put a time axis
  on it.

## 3. Selected direction

**Terminal Noir, "P&L as plumbing."** Stay inside the incumbent world; change nothing about the
identity. The one idea this widget contributes: **the waterfall is the hero**, drawn as sharp,
angular data pipes instead of the source's soft organic ribbons.

Translation decisions (from the analysis's own section 8, resolved):

| Source (video) | This widget | Why |
| --- | --- | --- |
| Grey ribbon = initial revenue | **amber** (`--tk-amber`) | amber is already "the signal" in Terminal Noir |
| Green ribbon = profit / earnings | **`up` green** (`#16c784`) | semantic parity with the source |
| Red ribbon = costs / rebates | **`down` red** (`#ea3943`) | semantic parity with the source |
| Curved Sankey ribbons | **orthogonal angular ribbons** (90° elbows) | "flow" → "circuitry"; sharp corners are the signature |
| Light blue/cyan hover card | `border-edge bg-panel` HoverCard | the source's cyan pop is the one thing that breaks the dark world |
| Sans-serif labels | **mono-first**, `tabular-nums` numbers | Terminal Noir type system |
| Static ribbons | **path-isolation on hover + optional marching dashes** | the source already highlights the hovered path; we make it the interaction |
| Rounded card corners | **`rounded-none`** everywhere | sharp-corner rule |

Node bars keep the source's proportional-height encoding; ribbon paths keep proportional width.

## 4. Color coding

All existing tokens; **no new colors**. Reused `Badge` variants: `amber`, `up`, `down`.

| Meaning | Token | Dark value |
| --- | --- | --- |
| Revenue / input / total (Taker Fees, Gross Protocol Revenue) | `amber` | `#ffb300` |
| Profit / earnings (Gross Profit, Earnings) | `up` | `#16c784` |
| Cost / rebate / reward outflows | `down` | `#ea3943` |
| Rail, unmet bars, grid | `edge` / `edge-2` | `#1e2126` / `#2a2e35` |
| Labels | `fg`, `fg-dim`, `fg-faint` | `#e8eaed`, `#9ba1ab`, `#5f6670` |

Ribbon tone follows the **destination** node by default (so the revenue→cost edge is red, as in the
source) and can be overridden per edge.

## 5. Dynamic showcasing (staying on-theme)

1. **Hover path isolation** (the core dynamic): hovering a node or a ribbon raises that element and
   **dims everything not connected to it** to ~15% opacity. This is the source's own highlight
   behaviour, made decisive.
2. **Angular ribbons with elbow routing** — 8-point orthogonal polygons, sharp corners, so the
   diagram reads as circuitry rather than as a floppy Sankey.
3. **Optional marching dashes** (`animate-flow-dash`) along the hovered/active ribbon, gated behind
   `animate` and disabled under `prefers-reduced-motion`.
4. **Staggered entrance** (`animate-fade-slide-up`) column by column on mount, so the waterfall
   "assembles" left→right.
5. **Height encoding** — bar height ∝ value (the source's core encoding), never a decorative size.
6. **Numeric honesty** — every figure in `font-mono tabular-nums`; compact USD formatting
   (`$98.64M`), with the exact value in the hover card.

## 6. The hover card (both nodes and ribbons)

The source hovers **nodes and flow segments** and shows an instant, read-only card adjacent to the
element. We reproduce that with the shadcn **HoverCard** primitive

- `openDelay ~80ms`, `closeDelay ~60ms` so it feels instant but does not flicker when moving from the
  trigger into the card.
- Anchored above the element (`side="top"`, `sideOffset 8`), collision-aware.
- **Node card:** tone `Badge` + label → value (compact, mono) + `pct%` → descriptive sentence →
  optional extra metric rows.
- **Edge card:** `From → To` label → value → optional description.
- Read-only, no controls, dismissed on leave — exactly the source's behaviour.
- Keyboard: the node/ribbon trigger is focusable and opens on focus; `aria-label` describes the node.

## 7. States and ranges

- **Data states:** all lines in the source are settled actuals (no upcoming/projected state). The
  component still models `active` per node (amber pulse) so a live/streaming variant is possible,
  but the default rendering is the settled waterfall.
- **Ranges:** 1 root + up to ~8 nodes and ~9 edges (the source). Design must degrade gracefully at
  3 nodes / 2 edges and hold at 12 nodes.
- **Overflow:** wide diagrams scroll horizontally via `ScrollArea`; the panel keeps its own height.
- **Empty:** a single node with no edges renders as one bar; no crash, no connector.
- **Themes:** both dark (default) and `.light` must stay legible; no hard-coded hex in the component.

## 8. Interaction and layout

- **Topology:** columns = pipeline order, inferred from edges (longest-path from roots) when not
  given explicitly. Nodes stack vertically inside a column, centred.
- **Height:** computed from a single global value→pixel scale so every column's total matches — the
  source's columns all sum to $98.64M, which is what makes the waterfall line up.
- **Affordances:** every node bar and every ribbon is a hover/focus target with a visible hover lift
  (amber ring on nodes, opacity raise on ribbons).
- **Header:** title + period + grand total in `CardAction`; legend row of three `Badge`s so the color
  coding is self-documenting.

## 9. Scope, anti-goals, constraints

- **In:** one presentational, data-driven `LiquidityFlowRoadmap` in `packages/ux-workflow`, built only
  from existing primitives + the new shadcn `HoverCard`; typed props; mock usage example.
  The initial pass deliberately shipped **no app wiring**; that constraint was lifted for the
  portfolio integration — see §12.
- **Out:** no data fetching, no chain calls, no new color tokens, no rounded corners,
  no dark/light-specific hard-coded colors, no time axis.
- **Constraint:** must not add dependencies beyond `@radix-ui/react-hover-card`; must pass
  `tsc --strict` with `noUnusedLocals`; must keep the exact `A → B` hover semantics from the video.

## 10. Data model (as built)

```ts
type LiquidityFlowTone = "revenue" | "profit" | "cost";
type LiquidityFlowAccent =
  | "amber" | "up" | "down" | "graph" | "oneinch" | "uniswap" | "faint";

interface LiquidityFlowNode {
  id: string; label: string; value: number;
  tone?: LiquidityFlowTone;      // semantic color (revenue/profit/cost)
  accent?: LiquidityFlowAccent;  // token color, overrides tone
  badge?: string;                // hover-card badge text (defaults to tone)
  pct?: number; column?: number; subLabel?: string; description?: string;
  metrics?: { label: string; value: string }[];  // extra hover-card rows
}

interface LiquidityFlowEdge {
  from: string; to: string; value: number;
  tone?: LiquidityFlowTone; accent?: LiquidityFlowAccent;
  label?: string; description?: string;
}
```

Two coloring paths, deliberately: `tone` states meaning, `accent` states identity. A P&L
waterfall uses `tone` (amber revenue → green profit, red cost); a **portfolio** uses `accent`
so each position keeps its own categorical color. Neither introduces new tokens — both draw
from the Terminal Noir palette. `legend`/`hint` make the color key self-documenting per use case.

Provenance: the values above are the Q2 2026 figures visible in the first 12 seconds of the
recording; the manifest (`roadmap_widget_manifest.json`) is the machine-readable copy.

---

## 11. Usage

```tsx
import { LiquidityFlowRoadmap } from "@ethonline2026/ux-workflow";

export function IncomeFlowPanel() {
  return (
    <LiquidityFlowRoadmap
      title="Income flow"
      period="Q2 2026"
      unit="USD"
      height={300}
      nodes={[
        { id: "taker-fees", label: "Taker Fees", value: 98.64e6, tone: "revenue", pct: 100 },
        { id: "gross-revenue", label: "Gross Protocol Revenue", value: 98.64e6, tone: "revenue" },
        { id: "gross-profit", label: "Gross Profit", value: 61.99e6, tone: "profit", pct: 63 },
        { id: "cost-of-revenue", label: "Cost of Revenue", value: 36.65e6, tone: "cost", pct: 37 },
        { id: "earnings", label: "Earnings", value: 61.99e6, tone: "profit", pct: 100 },
        { id: "maker-rebates", label: "Maker Rebates (Cost)", value: 20.79e6, tone: "cost", pct: 57 },
        { id: "liquidity-rewards", label: "Liquidity Rewards (Cost)", value: 9.48e6, tone: "cost", pct: 26 },
        { id: "referral-rewards", label: "Referral Rewards (Cost)", value: 2.6e6, tone: "cost", pct: 7 },
        { id: "taker-rebates", label: "Taker Rebates (Cost)", value: 2.73e6, tone: "cost", pct: 7 },
        { id: "holding-rewards", label: "Holding Rewards (Cost)", value: 1.06e6, tone: "cost", pct: 3 },
      ]}
      edges={[
        { from: "taker-fees", to: "gross-revenue", value: 98.64e6 },
        { from: "gross-revenue", to: "gross-profit", value: 61.99e6 },
        { from: "gross-revenue", to: "cost-of-revenue", value: 36.65e6 },
        { from: "gross-profit", to: "earnings", value: 61.99e6 },
        { from: "cost-of-revenue", to: "maker-rebates", value: 20.79e6 },
        { from: "cost-of-revenue", to: "liquidity-rewards", value: 9.48e6 },
        { from: "cost-of-revenue", to: "referral-rewards", value: 2.6e6 },
        { from: "cost-of-revenue", to: "taker-rebates", value: 2.73e6 },
        { from: "cost-of-revenue", to: "holding-rewards", value: 1.06e6 },
      ]}
    />
  );
}
```

`columns` are inferred from the edges, so the node order above does not matter. Pass `column`
explicitly on a node only to force a stage; pass `animate={false}` for a static render.

---

## 12. Agentic EMS integration — `PortfolioFlow`

The portfolio use case lives in the app, not the library: `apps/agentic-ems/components/demo/PortfolioFlow.tsx`
wraps the component and maps `allocationsFor(risk)` (`lib/demo/data.ts`) into a `NAV → 5 strategies`
flow. **No figure is invented in the wrapper** — value, pct, APY, VaR95, risk label, protocols
and the owning agent all come from the existing data module.

The five `StrategyDef.color` values are already Terminal Noir tokens, so the dashboard's existing
color coding carries over 1:1 — no new palette:

| Strategy | `StrategyDef.color` | accent token |
| --- | --- | --- |
| Stablecoin Lending | `#16c784` | `up` |
| Liquid Staking | `#6747ee` | `graph` |
| Prediction Markets | `#ffb300` | `amber` |
| Perpetual Basis | `#12aab5` | `oneinch` |
| Uniswap v4 LP | `#ff007a` | `uniswap` |

The NAV root deliberately uses `faint` (neutral grey) rather than a strategy color, both to match
the source video's grey "input" convention and to avoid colliding with the amber Prediction leg.

**Mounted in two places:**

1. **Dashboard** (`components/demo/Dashboard.tsx`) — a full-width `lg:col-span-12` section directly
   under the KPI row, wired to the existing `selected` state: `activeNodeId={selected}` +
   `onNodeSelect={setSelected}`, so clicking a portfolio leg re-points the forecast chart below.
   `PortfolioFlow` filters the NAV id out of `onNodeSelect`, keeping the consumer's
   `STRATEGIES.find(...)` lookup total.
2. **Chat** (`components/demo/ChatStage.tsx`) — a new `"portfolio-flow"` variant of the `Item`
   union, rendered in the widget map with the standard `ml-9` indent, and pushed by a `runScript`
   branch keyed on `portfolio | allocation | position | flow`, with a matching suggestion chip.

**App-side styling note:** the app's `app/globals.css` does not import the package's stylesheet, so
the motion tokens the component references (`--animate-fade-slide-up`, `--animate-flow-dash`, and
the `flash-*`/`pulse-subtle` set) were mirrored into the app's `@theme inline` block, together with
their `@keyframes` and a `prefers-reduced-motion` guard.
