/**
 * The capability port — re-exported from its final home.
 *
 * ## Why this file keeps existing
 *
 * The port has now moved twice, and each move was driven by the same rule: it lives with the layer
 * that owns the abstraction, not with its first consumer.
 *
 * 1. It was defined here when `bridges` was the only venue family.
 * 2. It moved to `packages/oneInch` when a second protocol family arrived, and this file became a
 *    re-export — **no call site changed**, which is what made that a refactor rather than a rewrite.
 * 3. It moved again, to `@ethonline2026/order-execution-layer`, once Uniswap arrived and a third
 *    package needed it. A protocol package importing a competing protocol's package to obtain a
 *    protocol-neutral type is the coupling this move removes.
 *
 * It is a *layer* rather than domain vocabulary: `execution-domain` describes what a leg and a step
 * are, and this describes what a venue can be asked to do. Keeping them apart is why
 * `execution-domain` still has no dependency on any venue.
 *
 * ## Where to add a new venue's vocabulary
 *
 * In `packages/order-execution-layer/src/port.ts`. This file should stay a re-export and never
 * accumulate definitions, or the vocabulary splits across a package boundary again — the exact
 * situation each move resolved.
 */
export * from "@ethonline2026/order-execution-layer/port";
