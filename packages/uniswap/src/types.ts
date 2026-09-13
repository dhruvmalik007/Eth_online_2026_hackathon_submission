/**
 * The one type this package shares with its siblings.
 *
 * ## Why it is duplicated rather than imported
 *
 * `Address` is `0x${string}` — one line. Importing it from `@ethonline2026/oneinch-aqua` would make
 * this package depend on a competing DEX's SDK to obtain a string type, which is the coupling that
 * stops a package from being reused or credited on its own.
 *
 * The duplications are structurally identical, so a value crossing between packages needs no
 * conversion. If a third package needs it, that is the moment to extract a shared types package —
 * not before, because an abstraction shaped by its first consumer is how `Address` ends up carrying
 * a field only one protocol wanted.
 */
export type Address = `0x${string}`;
