import type { Address } from "viem";

/**
 * A position this workspace has actually opened.
 *
 * Every address here was taken from one of our own transactions rather than from documentation —
 * the aToken and the vault are contracts we already called, so the registry cannot drift from what
 * we executed.
 */
export type KnownPosition =
  | {
      readonly protocol: "aave-v3";
      readonly chainId: number;
      readonly label: string;
      readonly aToken: Address;
      readonly decimals: number;
    }
  | {
      readonly protocol: "morpho";
      readonly chainId: number;
      readonly label: string;
      readonly vault: Address;
      readonly decimals: number;
      readonly shareDecimals: number;
    };

export const POLYGON_KNOWN_POSITIONS: readonly KnownPosition[] = [
  {
    protocol: "aave-v3",
    chainId: 137,
    label: "Aave V3 · USDC",
    aToken: "0xA4D94019934D8333Ef880ABFFbF2FDd611C762BD",
    decimals: 6,
  },
  {
    protocol: "morpho",
    chainId: 137,
    label: "Morpho · MEV Capital USDC",
    vault: "0xF2532428472a4CbDF27f20Ca39E81DA6DEb420b5",
    decimals: 6,
    shareDecimals: 18,
  },
];
