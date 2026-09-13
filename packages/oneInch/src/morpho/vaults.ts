/**
 * Morpho vaults as an ERC-4626 destination.
 *
 * ## The problem this file solves
 *
 * A "Morpho vault" is deployed *by* a factory, so there is no canonical address to
 * hardcode. The protocol's own API lists thousands of them, and the list is not
 * safe to consume directly. A `totalAssets`-ordered query over USDC vaults on the
 * four phase-1 chains returns, in the top handful:
 *
 * - vaults holding **zero** assets (test deployments, abandoned vaults);
 * - entries named `Test`, `usdc staging`, `Duplicated Key`, `Not Gauntlet`;
 * - vaults reporting an APY of **297,995%** — a number that is obviously a data
 *   or decimal error, and one that a naive "pick the best yield" rule would
 *   immediately select.
 *
 * So a vault is something we **curate and then verify**, never something we
 * discover. Curation lives in the chain registry; verification lives here, and it
 * is the only reason a vault may be used as a destination.
 *
 * ## Pure core, injected edge
 *
 * {@link validateVault} and {@link chooseVault} are pure and take no client, so
 * the rules are testable against fixtures with no network. Reading the chain is a
 * port ({@link VaultReader}) with one viem implementation. That is the same split
 * `packages/bridges` uses for its fee readers, for the same reason.
 */

import { parseAbi, type PublicClient } from "viem";
import type { Address } from "../chains/address.js";
import type { MorphoVaultRef } from "../chains/chainRegistry.js";

/** The subset of ERC-4626 this package reads. Deliberately minimal. */
export const ERC4626_ABI = parseAbi([
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
]);

/**
 * A smoothed APY above this is treated as a data error, not an opportunity.
 *
 * 50% on a stablecoin vault is not a yield; it is a decimal slip, a reward token
 * mispriced as the underlying, or a vault mid-incident. The real API returns
 * 297,995% for several vaults, so this bound is load-bearing rather than
 * defensive padding: without it, the highest-yield rule selects garbage.
 */
export const MAX_PLAUSIBLE_APY_BPS = 5_000;

/** What a read of a vault returned. `null` fields mean the call reverted. */
export interface VaultReadings {
  readonly address: Address;
  readonly asset: Address;
  readonly shareDecimals: number;
  readonly totalAssets: bigint;
  readonly totalSupply: bigint;
  /** `convertToAssets(10 ** shareDecimals)` — the value of one whole share. */
  readonly oneShareToAssets: bigint;
}

/**
 * Why a vault is not usable as a destination.
 *
 * A closed set, matching the `QUOTE_FAILURES` discipline in `packages/bridges`:
 * the caller can act on a reason, and the dashboard can explain a hold instead
 * of reporting "no vault".
 */
export const VAULT_REJECTIONS = [
  /** `EXTCODESIZE == 0` — nothing at the address. */
  "no_code",
  /** `asset()` is not the stablecoin we intend to deposit. */
  "asset_mismatch",
  /** `asset()` reverted or is the zero address. */
  "asset_unreadable",
  /** `totalAssets() == 0` — a drained, deprecated or test vault. */
  "empty",
  /** A share is worth nothing, so a deposit would mint shares with no claim. */
  "no_share_value",
  /** `shareDecimals` disagrees with the curated expectation. */
  "decimals_mismatch",
  /** A redeem of the intended size failed to simulate. */
  "not_redeemable",
  /** No trailing-mean yield has been measured yet, so it cannot be ranked. */
  "no_yield_reading",
  /** The measured yield is above {@link MAX_PLAUSIBLE_APY_BPS} — a data error. */
  "implausible_yield",
  /** Valid, but a better candidate won. */
  "lower_yield",
] as const;
export type VaultRejection = (typeof VAULT_REJECTIONS)[number];

export type VaultValidity =
  | { readonly ok: true; readonly readings: VaultReadings }
  | { readonly ok: false; readonly reason: VaultRejection; readonly detail: string };

/**
 * Judge a vault against what we expect it to be.
 *
 * Pure. The expectation comes from the curated {@link MorphoVaultRef}, so this
 * catches the mistake that matters most: a vault that is live, liquid and
 * well-yielding but holds the **wrong asset**. A USDT vault is not a worse USDC
 * vault — it is not a USDC vault, and depositing into it silently changes the
 * portfolio's currency exposure.
 */
export function validateVault(
  readings: VaultReadings | null,
  expected: { readonly address: Address; readonly asset: Address; readonly shareDecimals?: number },
): VaultValidity {
  if (readings === null) {
    return {
      ok: false,
      reason: "no_code",
      detail: `no ERC-4626 vault responded at ${expected.address}`,
    };
  }

  if (readings.asset === "0x0000000000000000000000000000000000000000") {
    return { ok: false, reason: "asset_unreadable", detail: "asset() returned the zero address" };
  }
  if (readings.asset.toLowerCase() !== expected.asset.toLowerCase()) {
    return {
      ok: false,
      reason: "asset_mismatch",
      detail: `vault holds ${readings.asset}, expected ${expected.asset}`,
    };
  }
  if (expected.shareDecimals !== undefined && readings.shareDecimals !== expected.shareDecimals) {
    return {
      ok: false,
      reason: "decimals_mismatch",
      detail: `share decimals ${readings.shareDecimals}, expected ${expected.shareDecimals}`,
    };
  }
  if (readings.totalAssets === 0n) {
    // The check that removes most of what the API returns. A zero-asset vault is
    // not a destination that is merely empty: depositing into it is unbounded
    // share-price risk, because there is no existing share value to anchor to.
    return { ok: false, reason: "empty", detail: "totalAssets() is 0 — drained, deprecated or a test deployment" };
  }
  if (readings.oneShareToAssets === 0n) {
    return { ok: false, reason: "no_share_value", detail: "one share converts to zero assets" };
  }

  return { ok: true, readings };
}

/**
 * A candidate after reading and judging, before ranking.
 *
 * `smoothedApyBps` is the **trailing mean** of the vault's realised growth, not a
 * spot rate. That distinction is the whole reason a vault suits a flight rule:
 * a vault's instantaneous APY moves with utilisation and reward accrual, so a
 * spot reading would have the policy rebalancing on noise. A trailing mean moves
 * only when the underlying actually does.
 */
export interface VaultCandidate {
  readonly ref: MorphoVaultRef;
  readonly validity: VaultValidity;
  readonly smoothedApyBps?: number;
  readonly redeemable: boolean;
}

export interface VaultChoice {
  /** The destination, or `null` when nothing qualified. */
  readonly chosen: VaultCandidate | null;
  /** Every candidate that did not win, and why. Ordered as supplied. */
  readonly rejected: readonly { readonly address: Address; readonly reason: VaultRejection; readonly detail: string }[];
}

/**
 * Pick the destination vault.
 *
 * Deterministic, and the tie-break is deliberate: equal yield is resolved by
 * address so two runs over the same state reach the same vault. A policy that
 * reorders on a tie would produce a different `ExecutionPlan` for identical
 * inputs, which makes the evidence unreproducible and the ordering untestable.
 *
 * Returning `null` is a normal outcome, not a failure. Per the flight rule, a
 * flight with nowhere to land still executes — the stablecoin stays in the
 * wallet and the vault leg holds — so this must be a value the caller can act on
 * rather than an exception that aborts the swap.
 */
export function chooseVault(candidates: readonly VaultCandidate[]): VaultChoice {
  const rejected: { address: Address; reason: VaultRejection; detail: string }[] = [];
  const eligible: VaultCandidate[] = [];

  for (const candidate of candidates) {
    const { ref } = candidate;

    if (!candidate.validity.ok) {
      rejected.push({ address: ref.address, reason: candidate.validity.reason, detail: candidate.validity.detail });
      continue;
    }
    if (!candidate.redeemable) {
      // Excluded rather than down-ranked. A vault we cannot exit is not a worse
      // destination; it is a *trap*, and a flight into it would be a one-way trip.
      rejected.push({
        address: ref.address,
        reason: "not_redeemable",
        detail: "a redeem of the intended size did not simulate successfully",
      });
      continue;
    }
    if (candidate.smoothedApyBps === undefined) {
      rejected.push({
        address: ref.address,
        reason: "no_yield_reading",
        detail: "no trailing-mean yield measured yet, so it cannot be ranked against the others",
      });
      continue;
    }
    if (candidate.smoothedApyBps > MAX_PLAUSIBLE_APY_BPS) {
      rejected.push({
        address: ref.address,
        reason: "implausible_yield",
        detail: `${candidate.smoothedApyBps} bps exceeds the ${MAX_PLAUSIBLE_APY_BPS} bps plausibility bound`,
      });
      continue;
    }

    eligible.push(candidate);
  }

  if (eligible.length === 0) return { chosen: null, rejected };

  const ranked = [...eligible].sort((a, b) => {
    const byYield = (b.smoothedApyBps ?? 0) - (a.smoothedApyBps ?? 0);
    if (byYield !== 0) return byYield;
    // Lower address wins a tie: arbitrary, but stable and reproducible.
    return a.ref.address.toLowerCase().localeCompare(b.ref.address.toLowerCase());
  });

  const chosen = ranked[0];
  if (chosen === undefined) return { chosen: null, rejected };

  for (const loser of ranked.slice(1)) {
    rejected.push({
      address: loser.ref.address,
      reason: "lower_yield",
      detail: `${loser.smoothedApyBps} bps vs the chosen ${chosen.smoothedApyBps} bps`,
    });
  }

  return { chosen, rejected };
}

/**
 * Read a vault on-chain.
 *
 * A port, so the selection rules above never need a client. `read` returns
 * `null` on any revert rather than throwing, because "this vault is not a vault"
 * is an expected outcome of reading a curated list and not an exceptional one —
 * the same reason `packages/bridges` returns `QuoteOutcome` instead of throwing.
 */
export interface VaultReader {
  read(address: Address, shareDecimals: number): Promise<VaultReadings | null>;
}

/** The viem binding. The composition root constructs it, as with the bridges. */
export function onchainVaultReader(client: PublicClient): VaultReader {
  return {
    async read(address, shareDecimals) {
      try {
        const [asset, totalAssets, totalSupply, decimals, oneShareToAssets] = await Promise.all([
          client.readContract({ address, abi: ERC4626_ABI, functionName: "asset" }),
          client.readContract({ address, abi: ERC4626_ABI, functionName: "totalAssets" }),
          client.readContract({ address, abi: ERC4626_ABI, functionName: "totalSupply" }),
          client.readContract({ address, abi: ERC4626_ABI, functionName: "decimals" }),
          client.readContract({
            address,
            abi: ERC4626_ABI,
            functionName: "convertToAssets",
            args: [10n ** BigInt(shareDecimals)],
          }),
        ]);

        return {
          address,
          asset: asset as Address,
          shareDecimals: Number(decimals),
          totalAssets: totalAssets as bigint,
          totalSupply: totalSupply as bigint,
          oneShareToAssets: oneShareToAssets as bigint,
        };
      } catch {
        return null;
      }
    },
  };
}
