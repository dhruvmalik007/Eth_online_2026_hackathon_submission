/**
 * `MorphoVaultAdapter` — a Morpho vault as an ERC-4626 leg.
 *
 * ## Why this is the small adapter, and why that is the point
 *
 * A Morpho vault is ERC-4626: `asset()`, `deposit(assets, receiver)`,
 * `redeem(shares, receiver, owner)`, `convertToAssets(shares)`. That is a *position*, not an
 * offer book — so it implements `QuoteSource` and `TransactionBuilder` directly and needs
 * none of the offer-book machinery in `offers.ts`.
 *
 * The consequence is the property worth stating: **the vault leg needs no new vocabulary.**
 * A deposit is a `RouteHop` of kind `deposit` and a redemption is `withdraw`, both of which
 * `port.ts` already defines. That is why a whole new venue — a new protocol, a new kind of
 * risk — adds nothing to the shared enums, and why this adapter is ~200 lines rather than a
 * state machine.
 *
 * ## Failure is a value, as everywhere else in the port
 *
 * The interesting case is a vault we cannot exit: ERC-4626 redemption is constrained by the
 * utilisation of the markets beneath it, so `redeem` can fail or return less than
 * `convertToAssets` predicted. That is not an exception, it is
 * `{ok: false, reason: "insufficient_liquidity"}` — a member `QUOTE_FAILURES` already has,
 * which is the second place a new venue reuses existing vocabulary rather than extending it.
 *
 * ## What it deliberately does not do
 *
 * It does not decide *whether* to deposit. That is the flight policy's job, and this adapter
 * is given the decision. It also does not rank vaults against each other on yield — the
 * selection rules live in `morpho/vaults.ts` and are pure, so they stay testable without a
 * client. This file is the binding: quote, and build the transaction.
 */

import { encodeFunctionData, parseAbi } from "viem";
import type { Address } from "../chains/address.js";
import { chooseVault, validateVault, type VaultCandidate, type VaultReader } from "../morpho/vaults.js";
import {
  QuoteEnvelopeSchema,
  type BuildContext,
  type QuoteEnvelope,
  type QuoteFailure,
  type QuoteOutcome,
  type QuoteSource,
  type RouteHop,
  type TransactionBuilder,
  type UnsignedTransaction,
} from "../port.js";

/** The ERC-4626 subset this adapter calls. */
export const MORPHO_VAULT_ABI = parseAbi([
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)",
]);

/** Share decimals assumed for the curated vaults. Morpho vault shares are 18-decimal. */
const SHARE_DECIMALS = 18;

/**
 * A deposit into a vault, or a redemption out of one.
 *
 * A discriminated union on `kind` rather than one struct with optional fields, because the
 * two are not variations of one operation: a deposit names an *asset amount* and may choose
 * its vault, while a redemption names a *share amount* and must state which vault it is
 * leaving, since you cannot redeem from a vault you were not placed in.
 */
export type VaultRequest =
  | {
      readonly kind: "deposit";
      readonly chainId: number;
      /** The stablecoin being deployed. */
      readonly asset: Address;
      readonly assets: bigint;
      /** Who receives the shares. */
      readonly recipient: Address;
      /** Pin the vault instead of letting the adapter choose. */
      readonly vault?: Address;
    }
  | {
      readonly kind: "withdraw";
      readonly chainId: number;
      readonly vault: Address;
      readonly shares: bigint;
      readonly recipient: Address;
      /** The share owner. Defaults to the recipient. */
      readonly owner?: Address;
    };

/** Read a vault's live state, and the registry's expectation for it. */
export interface VaultBinding {
  readonly ref: {
    readonly address: Address;
    readonly name: string;
    readonly asset: Address;
  };
  /** The yield measured from this vault, in bps. Absent when unmeasured. */
  readonly smoothedApyBps?: number;
  /** Whether a redemption of the intended size was simulated to succeed. */
  readonly redeemable: boolean;
}

export interface MorphoVaultAdapterConfig {
  /** The vaults curated for the active chain. */
  readonly vaults: readonly VaultBinding[];
  /** Reads the chain. Injected, so the selection rules stay offline-testable. */
  readonly reader: VaultReader;
  /** Minutes a built transaction stays valid for. */
  readonly deadlineMinutes?: number;
  /**
   * The share-price movement a depositor accepts between quote and execution, in bps.
   *
   * A **policy input, not a measurement**. It would be tempting to derive it from the share
   * price's premium over 1:1 — but that premium is the yield already earned, so using it as a
   * bound would report 500 bps of "slippage" on a healthy vault and mean nothing. What a
   * depositor actually accepts is a tolerance, so it is configured.
   */
  readonly acceptedSharePriceDriftBps?: number;
}

export class MorphoVaultAdapter implements QuoteSource<VaultRequest, QuoteEnvelope>, TransactionBuilder<QuoteEnvelope> {
  /** One value for the whole Morpho family — vaults, Midnight, Blue. */
  readonly id = "morpho" as const;

  constructor(private readonly config: MorphoVaultAdapterConfig) {}

  /**
   * Whether this adapter can serve the request at all.
   *
   * `supports` exists so a caller can ask before quoting, rather than catching an
   * `unsupported_pair` it could have predicted. The check is deliberately shallow — a vault
   * that exists but is empty is a *quote* failure with a precise reason, not an unsupported
   * request, and collapsing the two would lose the distinction the reason codes exist for.
   */
  supports(request: VaultRequest): boolean {
    if (request.chainId <= 0) return false;
    if (request.kind === "deposit") {
      return request.assets > 0n && this.config.vaults.some((vault) => sameAddress(vault.ref.asset, request.asset));
    }
    return request.shares > 0n && this.config.vaults.some((vault) => sameAddress(vault.ref.address, request.vault));
  }

  /**
   * Quote a deposit or a redemption.
   *
   * Failures come back as reasons, never as throws. The two worth noting:
   *
   * - `insufficient_liquidity` — nothing qualified, which for a deposit means no live vault
   *   holds the requested asset, and for a redemption means the vault cannot be exited.
   * - `unsupported_pair` — the request names a vault or asset this chain has no entry for.
   */
  async quote(request: VaultRequest): Promise<QuoteOutcome<QuoteEnvelope>> {
    if (!this.supports(request)) return { ok: false, reason: "unsupported_pair" };

    return request.kind === "deposit" ? this.quoteDeposit(request) : this.quoteWithdraw(request);
  }

  /**
   * Build the transaction a quote describes.
   *
   * The vault and asset come from `quote.raw` rather than being re-derived, because the quote
   * is the thing that was priced. Re-choosing a vault here would let the built transaction
   * settle somewhere the quote never described — the classic shape of this bug, and the reason
   * `raw` is mandatory on the envelope.
   */
  async build(quote: QuoteEnvelope, context: BuildContext): Promise<UnsignedTransaction> {
    const raw = quote.raw as
      | { readonly kind: "deposit"; readonly vault: Address; readonly assets: string; readonly recipient: Address }
      | { readonly kind: "withdraw"; readonly vault: Address; readonly shares: string; readonly recipient: Address; readonly owner: Address }
      | undefined;

    if (raw === undefined) {
      throw new Error(
        "Morpho vault quote carries no `raw` payload to build from — the envelope was not produced by this adapter.",
      );
    }

    const data =
      raw.kind === "deposit"
        ? encodeFunctionData({
            abi: MORPHO_VAULT_ABI,
            functionName: "deposit",
            args: [BigInt(raw.assets), raw.recipient],
          })
        : encodeFunctionData({
            abi: MORPHO_VAULT_ABI,
            functionName: "redeem",
            args: [BigInt(raw.shares), raw.recipient, raw.owner],
          });

    return {
      chainId: quote.hops[0]?.chainId ?? 0,
      to: raw.vault,
      data,
      // A vault leg never sends value: the gas token is not the asset being deployed.
      value: "0",
    };
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private async quoteDeposit(
    request: Extract<VaultRequest, { kind: "deposit" }>,
  ): Promise<QuoteOutcome<QuoteEnvelope>> {
    // Candidates restricted to the requested asset. A vault holding the wrong stablecoin is
    // not a worse destination, it is not a destination — the same distinction `validateVault`
    // enforces, applied one step earlier so the ranking never sees it.
    const candidates: VaultCandidate[] = [];

    for (const binding of this.config.vaults) {
      if (!sameAddress(binding.ref.asset, request.asset)) continue;
      if (request.vault !== undefined && !sameAddress(binding.ref.address, request.vault)) continue;

      const readings = await this.config.reader.read(binding.ref.address, SHARE_DECIMALS);
      const validity = validateVault(readings, { address: binding.ref.address, asset: binding.ref.asset });

      candidates.push({
        ref: {
          address: binding.ref.address,
          name: binding.ref.name,
          asset: binding.ref.asset,
          observedTotalAssetsUsdc: 0,
          observedApyPct: 0,
          source: "runtime binding",
        },
        validity,
        redeemable: binding.redeemable,
        ...(binding.smoothedApyBps === undefined ? {} : { smoothedApyBps: binding.smoothedApyBps }),
      });
    }

    const choice = chooseVault(candidates);
    if (choice.chosen === null || !choice.chosen.validity.ok) {
      const reason = choice.rejected.find((entry) => entry.reason !== "lower_yield")?.reason;
      return {
        ok: false,
        reason: mapRejection(reason),
        detail:
          choice.rejected.length === 0
            ? `no vault holds ${request.asset} on chain ${request.chainId}`
            : choice.rejected.map((entry) => `${entry.reason}: ${entry.detail}`).join("; "),
      };
    }

    const readings = choice.chosen.validity.readings;
    const shares = sharesForAssets(request.assets, readings.oneShareToAssets);
    if (shares === 0n) {
      return {
        ok: false,
        reason: "insufficient_liquidity",
        detail: `${request.assets} of ${request.asset} rounds to zero shares in ${choice.chosen.ref.name}`,
      };
    }

    const hop: RouteHop = {
      source: "morpho",
      protocol: "morpho-vault-v2",
      // The existing vocabulary, reused rather than extended — the whole point of this adapter.
      kind: "deposit",
      chainId: request.chainId,
      fromToken: request.asset,
      toToken: choice.chosen.ref.address,
      fromAmount: request.assets.toString(),
      toAmount: shares.toString(),
      feeLines: vaultFeeLines({
        chainId: request.chainId,
        vault: choice.chosen.ref.name,
        // A vault has no swap slippage. What a depositor accepts is the *share price* moving
        // between quote and execution, which is a bound and therefore never summed.
        acceptedDriftBps: this.config.acceptedSharePriceDriftBps ?? 10,
      }),
    };

    return {
      ok: true,
      quote: QuoteEnvelopeSchema.parse({
        sourceId: this.id,
        hops: [hop],
        feeLines: hop.feeLines,
        expiresAt: this.expiry(),
        raw: {
          kind: "deposit",
          vault: choice.chosen.ref.address,
          assets: request.assets.toString(),
          recipient: request.recipient,
        },
      }),
    };
  }

  private async quoteWithdraw(
    request: Extract<VaultRequest, { kind: "withdraw" }>,
  ): Promise<QuoteOutcome<QuoteEnvelope>> {
    const binding = this.config.vaults.find((vault) => sameAddress(vault.ref.address, request.vault));
    if (binding === undefined) {
      return {
        ok: false,
        reason: "unsupported_pair",
        detail: `${request.vault} is not a vault curated for chain ${request.chainId}`,
      };
    }

    const readings = await this.config.reader.read(binding.ref.address, SHARE_DECIMALS);
    const validity = validateVault(readings, { address: binding.ref.address, asset: binding.ref.asset });
    if (!validity.ok) {
      return { ok: false, reason: mapRejection(validity.reason), detail: validity.detail };
    }

    if (request.shares > validity.readings.totalSupply) {
      // A redemption larger than the vault's whole supply cannot settle. Saying so here is
      // cheaper than an on-chain revert, and the reason is the same one the port already uses.
      return {
        ok: false,
        reason: "insufficient_liquidity",
        detail: `${request.shares} shares exceeds the vault's total supply of ${validity.readings.totalSupply}`,
      };
    }

    const assets = assetsForShares(request.shares, validity.readings.oneShareToAssets);

    const hop: RouteHop = {
      source: "morpho",
      protocol: "morpho-vault-v2",
      kind: "withdraw",
      chainId: request.chainId,
      fromToken: binding.ref.address,
      toToken: binding.ref.asset,
      fromAmount: request.shares.toString(),
      toAmount: assets.toString(),
      feeLines: vaultFeeLines({
        chainId: request.chainId,
        vault: binding.ref.name,
        acceptedDriftBps: this.config.acceptedSharePriceDriftBps ?? 10,
      }),
    };

    return {
      ok: true,
      quote: QuoteEnvelopeSchema.parse({
        sourceId: this.id,
        hops: [hop],
        feeLines: hop.feeLines,
        expiresAt: this.expiry(),
        raw: {
          kind: "withdraw",
          vault: binding.ref.address,
          shares: request.shares.toString(),
          recipient: request.recipient,
          owner: request.owner ?? request.recipient,
        },
      }),
    };
  }

  private expiry(): Date {
    return new Date(Date.now() + (this.config.deadlineMinutes ?? 5) * 60_000);
  }
}

/**
 * The vault leg's fee lines.
 *
 * One `bound` line and no `cost` line, which is not an omission. A deposit costs gas, but this
 * adapter does not know the gas price and inventing one would produce a number that looks like
 * a charge and is not — so gas is left for the signer, which is the only party that knows it.
 * What *is* priced here is the share-price movement a depositor implicitly accepts, and by the
 * domain's rule that is a `bound`: never summed into the headline.
 */
function vaultFeeLines(input: {
  readonly chainId: number;
  readonly vault: string;
  readonly acceptedDriftBps: number;
}): RouteHop["feeLines"] {
  return [
    {
      id: `morpho:share-price:${input.vault}`,
      label: `Accepted share-price movement in ${input.vault}`,
      tier: "bound",
      // Expressed in bps rather than dollars: the leg's notional is not known here, and
      // converting without it would require an asset price we do not have.
      amountUsd: 0,
      bps: input.acceptedDriftBps,
      // `direct` because a vault deposit is not routed through an aggregator.
      provider: "direct",
      note: "A bound, not a charge. Vault shares do not slip the way a swap does; this is the tolerance the depositor accepts.",
    },
  ];
}

/** Shares minted for an asset amount, rounded down — a vault's own convention. */
function sharesForAssets(assets: bigint, oneShareToAssets: bigint): bigint {
  if (oneShareToAssets === 0n) return 0n;
  return (assets * 10n ** BigInt(SHARE_DECIMALS)) / oneShareToAssets;
}

/** Assets returned for a share amount, rounded down. */
function assetsForShares(shares: bigint, oneShareToAssets: bigint): bigint {
  return (shares * oneShareToAssets) / 10n ** BigInt(SHARE_DECIMALS);
}

/**
 * Map a vault rejection onto the port's closed failure set.
 *
 * Every rejection has a home, which is the other half of the claim that a new venue needs no
 * new vocabulary: `VAULT_REJECTIONS` is finer-grained than `QUOTE_FAILURES` because it exists
 * to explain a decision, and coarser here because this is the wire format.
 */
function mapRejection(reason: string | undefined): QuoteFailure {
  switch (reason) {
    case "not_redeemable":
      return "insufficient_liquidity";
    case "no_yield_reading":
      return "no_route";
    case "empty":
    case "no_share_value":
      return "insufficient_liquidity";
    default:
      // Includes `asset_mismatch`, `decimals_mismatch` and `implausible_yield`: all of them mean
      // the vault we were given is not one this adapter can price.
      return "unsupported_pair";
  }
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
