/** Which protocol a position is held in. */
export type ProtocolId = "aave-v3" | "morpho";

/**
 * A position, shaped the way the protocol's own UI presents it.
 *
 * The numbers here are meant to agree with what a user sees after connecting directly to
 * app.aave.com or app.morpho.org, because a card that disagrees with the site it links to is worse
 * than no card: the user cannot tell which one is lying.
 */
export interface ProtocolPosition {
  readonly protocol: ProtocolId;
  readonly chainId: number;
  /** The contract that holds the position: the aToken, or the vault. */
  readonly poolId: string;
  readonly label: string;
  /** Underlying units — the number the protocol shows as the balance. */
  readonly units: number;
  /** Decimals of the underlying (USDC is 6), so a caller can re-render the raw value exactly. */
  readonly decimals: number;
  /** Share balance, for share-based positions (a Morpho vault). Null when the position is not. */
  readonly shares: number | null;
  /** The vault's total underlying — its TVL — when the contract publishes one. */
  readonly totalAssets: number | null;
  /**
   * Supply APY, or null.
   *
   * Deliberately nullable rather than zero. Aave and Morpho publish rates through their own APIs,
   * and reading Aave's `getReserveData` by hand at a fixed struct offset produced a wrong answer
   * (a zero rate and a nonsense aToken address) because the layout is version-specific. Null means
   * "not read", and a caller must not render it as "0%".
   */
  readonly apy: number | null;
  readonly source: "onchain";
}
