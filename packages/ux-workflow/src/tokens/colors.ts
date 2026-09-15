/**
 * Terminal Noir design tokens — the single source of truth for the Agentic EMS
 * design language. These mirror the CSS custom properties defined in
 * src/styles/globals.css so any consumer gets the same palette.
 */

export const colors = {
  ink: "var(--tk-ink)",
  panel: "var(--tk-panel)",
  panel2: "var(--tk-panel-2)",
  edge: "var(--tk-edge)",
  edge2: "var(--tk-edge-2)",
  fg: "var(--tk-fg)",
  fgDim: "var(--tk-fg-dim)",
  fgFaint: "var(--tk-fg-faint)",
  amber: "var(--tk-amber)",
  amberDim: "var(--tk-amber-dim)",
  onAmber: "var(--tk-on-amber)",
  up: "var(--tk-up)",
  down: "var(--tk-down)",
  graph: "var(--tk-graph)",
  graphSoft: "var(--tk-graph-soft)",
  oneinch: "var(--tk-oneinch)",
  uniswap: "var(--tk-uniswap)",
} as const;

export type ColorToken = keyof typeof colors;

export const typography = {
  fontSans: "var(--font-sans)",
  fontMono: "var(--font-mono)",
  /**
   * Mono numeral style — the "Bloomberg" signal. Use for ALL numbers,
   * contract IDs, formula output, timestamps, forecast values.
   */
  monoNumeral: "font-mono tabular-nums tracking-tight",
} as const;

export const spacing = {
  compact: { gap: 2, pad: 3 },
  comfortable: { gap: 4, pad: 5 },
} as const;

export const motion = {
  pulseSubtle: "animate-pulse-subtle",
  flashGreen: "animate-flash-green",
  flashRed: "animate-flash-red",
  fadeSlideUp: "animate-fade-slide-up",
  /**
   * Marching dashes along an active edge. Exported because "this is the path currently being taken"
   * is not specific to the desk — the indexer console uses it to show which transition a run is on.
   */
  flowDash: "animate-flow-dash",
  accordionDown: "animate-accordion-down",
  accordionUp: "animate-accordion-up",
  /**
   * A scrim arriving over content that is being replaced.
   *
   * Opacity only, and short: a loading layer says "you cannot act on this yet". Anything with a
   * transform makes it an object that lands, which invites looking at it instead of past it.
   */
  overlayIn: "animate-overlay-in",
  /**
   * Curves and durations, so a caller names the system's timing rather than inventing one.
   *
   * The keyframes above carry their own curves; these are for everything else — hover, focus, press,
   * and any transition a component composes itself. Without them each surface picks its own
   * `ease-out` and `150ms`, and the product stops feeling like one thing.
   */
  ease: {
    out: "var(--tk-ease-out)",
    inOut: "var(--tk-ease-in-out)",
  },
  duration: {
    quick: "var(--tk-dur-quick)",
    base: "var(--tk-dur-base)",
    slow: "var(--tk-dur-slow)",
  },
} as const;
