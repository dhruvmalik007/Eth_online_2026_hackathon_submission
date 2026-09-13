/**
 * `OneInchAquaAdapter` — the flight as the execution service sees it.
 *
 * ## Why the taker encoding is injected rather than written here
 *
 * `takerTraitsAndData` is a 176-bit header plus up to ten variable slices, and it encodes the
 * swap's **direction and slippage bound**. A second implementation of it in TypeScript would be
 * able to disagree with the contract, and the disagreement would surface as a fill that executed
 * the wrong way rather than as an error. The fork scenario proved this the hard way — it uses
 * upstream's Solidity `TakerTraitsLib` — so this adapter takes an {@link AquaFillEncoder} port and
 * leaves the encoding to whoever holds the authoritative one.
 *
 * That is the same choice `packages/bridges` makes for its fee readers: the adapter owns *what* to
 * quote and *when* to fill; the composition root owns the binding.
 *
 * ## Why this implements `ExecutionAdapter` and not `QuoteSource`
 *
 * The plan called for one class implementing both the domain's `ExecutionAdapter` and the port's
 * `QuoteSource`. That is not expressible in TypeScript, and the reason is worth recording:
 *
 * ```
 * ExecutionAdapter.quote(legs: IntentLeg[]): Promise<Quote[]>          // the domain's shape
 * QuoteSource<Req, Quote>.quote(request: Req): Promise<QuoteOutcome>   // the port's shape
 * ```
 *
 * Same method name, incompatible signatures — a class cannot satisfy both without an overload
 * union that would fail at every call site. So the domain interface wins, because that is the one
 * the dashboard and `apps/execution` are written against, and the port-shaped call is exposed as
 * {@link quoteEnvelope}. A caller that needs strict `QuoteSource` conformance wraps the two
 * methods; nobody needs to, and a union signature everybody trips over would be worse.
 *
 * ## Everything is injected
 *
 * No client, no clock, no network in the class itself: the chain context, the quote source, the
 * encoder and the sender all arrive through the constructor. That is what makes the plan-building
 * testable offline — the tests below run the whole adapter against fakes.
 */

import { randomUUID } from "node:crypto";
import type {
  ExecutionAdapter,
  ExecutionPlan,
  ExecutionRecord,
  ExecutionStep,
  IntentLeg,
  Quote,
} from "@ethonline2026/execution-domain";
import { sumWalletCost } from "@ethonline2026/execution-domain";

import type { Address } from "../chains/address.js";
import type { ChainDeployment } from "../chains/chainRegistry.js";
import type { FlightDecision } from "../policy/types.js";
import type { Hex } from "viem";

/** The `takerTraitsAndData` blob, plus the calldata that carries it. */
export interface EncodedFill {
  readonly to: Address;
  readonly data: Hex;
  readonly value: string;
}

/**
 * Encodes a fill.
 *
 * Injected — see the header. `minOut` is the taker's own slippage protection, independent of the
 * maker's band, and is passed through rather than derived so the two protections stay independent.
 */
export interface AquaFillEncoder {
  encodeFill(input: {
    readonly router: Address;
    readonly order: unknown;
    readonly amount: bigint;
    readonly taker: Address;
    readonly recipient: Address;
    readonly minOut: bigint;
    readonly deadline?: number;
  }): EncodedFill;
}

/** Sends a built transaction. Injected so the adapter can be exercised without a chain. */
export interface TxSender {
  send(tx: { readonly chainId: number; readonly to: Address; readonly data: Hex; readonly value: string }): Promise<{
    readonly hash: string;
    readonly explorerUrl?: string;
  }>;
}

/** What a quote needs that the leg does not carry. */
export interface AquaQuotePort {
  quote(input: {
    readonly chainId: number;
    readonly tokenIn: Address;
    readonly tokenOut: Address;
    readonly amountIn: bigint;
    readonly minOut: bigint;
  }): Promise<
    | { readonly ok: true; readonly amountOut: bigint; readonly band: bigint; readonly expiresAt: Date }
    | { readonly ok: false; readonly reason: string; readonly detail: string }
  >;
}

export interface OneInchAquaAdapterConfig {
  /** The chain this adapter is bound to, from the registry. */
  readonly chain: ChainDeployment;
  readonly router: Address;
  readonly quotePort: AquaQuotePort;
  readonly encoder: AquaFillEncoder;
  readonly sender: TxSender;
  /** The address signing fills. */
  readonly taker: Address;
  /** Where the flight's output goes. Defaults to the taker. */
  readonly recipient?: Address;
  /** The maker's order, as the encoder expects it. */
  readonly order: unknown;
}

/** The per-leg intent the adapter needs, layered onto the domain's `IntentLeg`. */
export interface AquaSwapIntent {
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly amountIn: bigint;
  readonly minOut: bigint;
  readonly decision: FlightDecision;
}

export class MissingIntentError extends Error {
  constructor(legId: string) {
    super(
      `No Aqua intent was supplied for leg ${legId}. The adapter prices only legs it has an ` +
        `explicit tokenIn/tokenOut/amountIn for — inferring them from a USD notional would mean ` +
        `inventing a price at the last step before a signature.`,
    );
    this.name = "MissingIntentError";
  }
}

export class OneInchAquaAdapter implements ExecutionAdapter {
  /** One value, and `SOURCE_IDS` already had it before this package existed. */
  readonly id = "1inch" as const;

  private readonly intents = new Map<string, AquaSwapIntent>();
  private readonly quotes = new Map<string, Quote>();

  constructor(private readonly config: OneInchAquaAdapterConfig) {}

  /** Register the numeric intent for a leg. Required before quoting that leg. */
  withIntent(legId: string, intent: AquaSwapIntent): this {
    this.intents.set(legId, intent);
    return this;
  }

  /** The chain this adapter serves. */
  get chainKey() {
    return this.config.chain.key;
  }

  /**
   * Price every leg we have an intent for.
   *
   * A leg without an intent is skipped rather than guessed at: the domain leg carries
   * `amountUsd`, not token amounts, and converting one to the other needs a price this adapter
   * does not own. Skipping is visible — the built plan will have fewer steps than legs — whereas
   * guessing would be invisible and would reach a signature.
   */
  async quote(legs: IntentLeg[]): Promise<Quote[]> {
    const out: Quote[] = [];

    for (const leg of legs) {
      const intent = this.intents.get(leg.id);
      if (intent === undefined) continue;

      const priced = await this.config.quotePort.quote({
        chainId: this.config.chain.chainId,
        tokenIn: intent.tokenIn,
        tokenOut: intent.tokenOut,
        amountIn: intent.amountIn,
        minOut: intent.minOut,
      });

      if (!priced.ok) {
        // Not a throw: an unquotable leg is a normal outcome, and the domain's `Quote` has no
        // failure field, so the reason travels in a `cost`-tier line labelled as a warning rather
        // than being dropped.
        out.push({
          legId: leg.id,
          provider: "oneinch",
          venue: `SwapVM · ${this.config.chain.name}`,
          fees: [
            {
              id: `aqua:unquotable:${leg.id}`,
              label: `Not quotable: ${priced.reason}`,
              tier: "cost",
              amountUsd: 0,
              provider: "oneinch",
              note: priced.detail,
            },
          ],
          slippageBoundPct: 0,
          priceImpactPct: 0,
          estimatedSeconds: 0,
        });
        continue;
      }

      // Two lines, and the split is the domain's rule: the band is what the taker accepts as a
      // worst-case rate (a `bound`, never summed), and the share of the notional the maker's
      // guard holds back is a `market` effect of the order's own size.
      const quote: Quote = {
        legId: leg.id,
        provider: "oneinch",
        venue: `SwapVM · Aqua · ${this.config.chain.name}`,
        fees: [
          {
            id: `aqua:band:${leg.id}`,
            label: "SwapVM flight band — worst acceptable rate",
            tier: "bound",
            amountUsd: 0,
            bps: Number((intent.minOut * 10_000n) / (priced.amountOut === 0n ? 1n : priced.amountOut)),
            provider: "oneinch",
            note: `maker's band ${priced.band} for ${intent.amountIn} in`,
          },
        ],
        slippageBoundPct: 0,
        priceImpactPct: 0,
        // A single on-chain fill, so this is a block time rather than a route duration.
        estimatedSeconds: 12,
      };
      this.quotes.set(leg.id, quote);
      out.push(quote);
    }

    return out;
  }

  /**
   * Build the plan.
   *
   * One `swap` step per quotable leg, each carrying the fill calldata the encoder produced. The
   * step's `intent` sentence is the ERC-7730-style line the dashboard shows before signing, so it
   * states the amount and the destination rather than naming the protocol.
   */
  async buildPlan(legs: IntentLeg[], quotes: Quote[], mode: "batch" | "per-leg"): Promise<ExecutionPlan> {
    const steps: ExecutionStep[] = [];
    const usedQuotes: Quote[] = [];

    for (const leg of legs) {
      const intent = this.intents.get(leg.id);
      if (intent === undefined) continue;

      const quote = quotes.find((entry) => entry.legId === leg.id);
      if (quote === undefined) continue;
      usedQuotes.push(quote);

      const fill = this.config.encoder.encodeFill({
        router: this.config.router,
        order: this.config.order,
        amount: intent.amountIn,
        taker: this.config.taker,
        recipient: this.config.recipient ?? this.config.taker,
        minOut: intent.minOut,
      });

      steps.push({
        id: randomUUID(),
        legId: leg.id,
        kind: "swap",
        label: `SwapVM flight on ${this.config.chain.name}`,
        intent:
          `Convert ${intent.amountIn} of ${intent.tokenIn} into at least ${intent.minOut} of ` +
          `${intent.tokenOut} through the Aqua-swapped SwapVM order, because ` +
          `${intent.decision.reason}.`,
        tx: { to: fill.to, value: fill.value, data: fill.data, operation: 0 },
        // Nothing has been sent yet; the state machine owns what comes next.
        state: "queued",
      });
    }

    const fees = usedQuotes.flatMap((quote) => quote.fees);

    return {
      id: randomUUID(),
      createdAt: Date.now(),
      legs,
      quotes: usedQuotes,
      steps,
      // A batch digest belongs to the signer (a Safe MultiSend hash, say). This adapter does not
      // sign, so it reports the placeholder the domain requires rather than a fabricated hash.
      batchDigest: "",
      batchIntent: legs.map((leg) => leg.intent).join(" and "),
      totals: {
        notionalUsd: legs.reduce((total, leg) => total + leg.amountUsd, 0),
        // Only `cost` lines, never `bound`: the domain's rule, applied here rather than restated.
        costUsd: sumWalletCost(fees),
        boundUsd: fees.filter((fee) => fee.tier === "bound").reduce((total, fee) => total + fee.amountUsd, 0),
      },
      mode,
      signing: mode === "batch" ? "safe-batch" : "per-leg",
      simulated: false,
    };
  }

  /**
   * Send the plan, reporting each step.
   *
   * Returns a disposer, matching the domain interface — and the disposer is meaningful: it sets a
   * cancelled flag the loop checks, so a caller can stop a multi-step send without the adapter
   * having to reach into whatever is emitting. A submit that could not be stopped would be a
   * promise the caller cannot take back.
   */
  submit(plan: ExecutionPlan, onStep: (step: ExecutionStep) => void): () => void {
    let cancelled = false;

    void (async () => {
      // Yield before the first side effect. Without this the loop runs synchronously up to the
      // first `send`, so `submit` would return a disposer that is already too late to stop the
      // first transaction — the one a caller is most likely to want to stop. One microtask is
      // enough: the caller's synchronous `stop()` lands before the loop resumes.
      await Promise.resolve();

      for (const step of plan.steps) {
        if (cancelled) return;

        onStep({ ...step, state: "signing" });
        try {
          const sent = await this.config.sender.send({
            chainId: this.config.chain.chainId,
            to: step.tx.to as Address,
            data: step.tx.data as Hex,
            value: step.tx.value,
          });
          onStep({
            ...step,
            state: "confirmed",
            ...(sent.explorerUrl === undefined
              ? {}
              : { tracking: { srcTxHash: sent.hash, srcExplorerUrl: sent.explorerUrl } }),
          });
        } catch (error) {
          // A failed step is reported, not thrown: the domain's `ExecutionStep` has an `error`
          // field precisely so a trace can be complete rather than truncated at the first bad leg.
          onStep({ ...step, state: "failed", error: error instanceof Error ? error.message : String(error) });
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }

  /**
   * Summarise a finished plan.
   *
   * `status` is derived rather than asserted: a plan with one failure among three is `partial`,
   * and calling it `complete` because the run returned would misreport a trace an operator is
   * about to act on.
   */
  toRecord(plan: ExecutionPlan, steps: ExecutionStep[]): ExecutionRecord {
    const confirmed = steps.filter((step) => step.state === "confirmed").length;
    const failed = steps.filter((step) => step.state === "failed").length;

    return {
      id: plan.id,
      createdAt: plan.createdAt,
      legs: plan.legs.map((leg) => ({
        id: leg.id,
        label: leg.intent,
        // The domain's ChainKey, which this package's ChainKey is a subset of — so this is an
        // identity rather than a translation, which is the whole reason the chain matrix was
        // restricted to these two.
        chain: leg.chain,
        deployedUsd: leg.amountUsd,
        costUsd: 0,
      })),
      stepCount: steps.length,
      confirmedCount: confirmed,
      notionalUsd: plan.totals.notionalUsd,
      costUsd: plan.totals.costUsd,
      status: failed === 0 ? "complete" : confirmed > 0 ? "partial" : "failed",
      simulated: plan.simulated,
      links: steps
        .filter((step) => step.tracking?.srcTxHash !== undefined)
        .map((step) => ({
          label: step.label,
          ...(step.tracking?.srcExplorerUrl === undefined ? {} : { url: step.tracking.srcExplorerUrl }),
          ...(step.tracking?.srcTxHash === undefined ? {} : { hash: step.tracking.srcTxHash }),
        })),
    };
  }

  /**
   * A port-shaped quote, for a caller that wants the capability interface's outcome union.
   *
   * Separate from `quote` because the two are genuinely different contracts — see the header for
   * why they cannot share a name.
   */
  async quoteEnvelope(leg: IntentLeg): Promise<
    | { readonly ok: true; readonly quote: Quote; readonly amountOut: bigint; readonly expiresAt: Date }
    | { readonly ok: false; readonly reason: string; readonly detail: string }
  > {
    const intent = this.intents.get(leg.id);
    if (intent === undefined) throw new MissingIntentError(leg.id);

    const priced = await this.config.quotePort.quote({
      chainId: this.config.chain.chainId,
      tokenIn: intent.tokenIn,
      tokenOut: intent.tokenOut,
      amountIn: intent.amountIn,
      minOut: intent.minOut,
    });
    if (!priced.ok) return { ok: false, reason: priced.reason, detail: priced.detail };

    const [quote] = await this.quote([leg]);
    if (quote === undefined) throw new MissingIntentError(leg.id);
    return { ok: true, quote, amountOut: priced.amountOut, expiresAt: priced.expiresAt };
  }
}
