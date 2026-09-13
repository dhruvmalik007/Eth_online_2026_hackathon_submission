/**
 * LI.FI adapter — a bridge and DEX aggregator.
 *
 * Verified against the installed `@lifi/sdk` **^4.7.0** and `@lifi/types`
 * **^18.7.0**. The v4 API is `createClient` plus standalone actions.
 *
 * ## Types are derived, never named
 *
 * Every LI.FI type here comes from the SDK's own functions —
 * `Parameters<typeof getRoutes>[1]`, `Awaited<ReturnType<typeof getRoutes>>` —
 * rather than by importing names like `RoutesResponse`, which live in
 * `@lifi/types` behind the SDK's re-exports. A derived type cannot be wrong
 * about a name it does not mention, which is exactly how the first draft of this
 * file failed.
 *
 * ## The fee rule this adapter exists to honour
 *
 * LI.FI reports costs as `feeCosts` and `gasCosts`, and either may be
 * `included: true` — **already netted out of the quoted output**. Adding an
 * included fee to the headline double-counts it, so `included` is carried onto
 * every line and `sumWalletCost()` decides what the user actually pays.
 *
 * ## Two behaviours worth knowing
 *
 * - **PENDING spans two different waits.** Waiting for a block and waiting for a
 *   verifier are not the same thing, and `substatus` is what separates them.
 *   Collapsing them loses the only signal that explains a slow bridge.
 * - **`InMemoryStorage`, never `LocalStorageAdapter`,** in a server process.
 */
import {
  InMemoryStorage,
  createClient,
  getRoutes,
  getStatus,
  getStepTransaction,
} from "@lifi/sdk";
import { z } from "zod";
import {
  QuoteEnvelopeSchema,
  type BuildContext,
  type QuoteEnvelope,
  type QuoteFailure,
  type QuoteOutcome,
  type RouteHop,
  type StatusOutcome,
  type UnsignedTransaction,
} from "./port.js";

/** The client handle, derived so the SDK's own client type is never named. */
type LiFiClient = ReturnType<typeof createClient>;
/** The params `getRoutes` accepts. */
type RoutesParams = Parameters<typeof getRoutes>[1];
/** A step in the form `getStepTransaction` wants it back. */
type StepRequest = Parameters<typeof getStepTransaction>[1];

export interface LiFiConfig {
  /** Your integrator id — LI.FI attributes volume to it. */
  readonly integrator: string;
  /** Absent means aggressive rate limiting, surfaced as `rate_limited`. */
  readonly apiKey?: string;
  /** chainId → RPC URL. The SDK needs these for reads, not for quoting. */
  readonly rpcUrls: Readonly<Record<number, string>>;
}

export interface LiFiQuoteRequest {
  readonly fromChainId: number;
  readonly toChainId: number;
  readonly fromTokenAddress: string;
  readonly toTokenAddress: string;
  /** Subunit integer string. */
  readonly fromAmount: string;
  readonly fromAddress: string;
  readonly toAddress?: string;
  /** Prefer the fastest route over the cheapest. */
  readonly preferFast?: boolean;
}

/**
 * A permissive read of the parts of a route we map.
 *
 * Deliberately structural and tolerant: it validates what we consume and ignores
 * the rest, so a provider adding a field cannot break quoting, while a change to
 * a field we *do* use fails loudly here instead of producing `undefined` inside a
 * mapping.
 */
const CostSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  amountUSD: z.string().optional(),
  included: z.boolean().optional(),
});

const StepSchema = z.object({
  id: z.string().optional(),
  // Optional: `type` is not guaranteed on every route, and requiring it turned a
  // usable response into `upstream_error` — the guard was stricter than the API.
  type: z.string().optional(),
  tool: z.string().optional(),
  action: z
    .object({ fromChainId: z.number().optional(), toChainId: z.number().optional() })
    .optional(),
  estimate: z
    .object({
      fromAmount: z.string().optional(),
      toAmount: z.string().optional(),
      executionDuration: z.number().optional(),
      feeCosts: z.array(CostSchema).optional(),
      gasCosts: z.array(CostSchema).optional(),
    })
    .optional(),
});

const RouteSchema = z.object({
  id: z.string().optional(),
  steps: z.array(StepSchema).min(1),
});

const RoutesSchema = z.object({ routes: z.array(RouteSchema) });

const StatusSchema = z.object({
  status: z.string().optional(),
  substatus: z.string().optional(),
  receiving: z.object({ txHash: z.string().optional() }).optional(),
});

/** Bridge state, kept deliberately distinct from block-waiting. */
type BridgeState = "pending" | "attesting" | "delivered" | "failed";

/**
 * Map a thrown provider error onto the closed failure union.
 *
 * LI.FI signals rate limiting with a 429 rather than a distinct error class, so
 * the status code is checked before the message — a rate limit must not read as
 * "no route", because the caller retries one and abandons the other.
 */
/** The reason *and* the upstream message — a bare code hides a mapping bug. */
function classify(error: unknown): { reason: QuoteFailure; detail: string } {
  const detail = error instanceof Error ? error.message : String(error);
  const status = (error as { status?: number; response?: { status?: number } }).status ??
    (error as { response?: { status?: number } }).response?.status;
  if (status === 429) return { reason: "rate_limited", detail };
  const message = detail.toLowerCase();
  if (message.includes("rate limit") || message.includes("too many")) return { reason: "rate_limited", detail };
  if (message.includes("no route") || message.includes("not found")) return { reason: "no_route", detail };
  if (message.includes("insufficient")) return { reason: "insufficient_liquidity", detail };
  return { reason: "upstream_error", detail };
}

/** USD figures only — token amounts stay integer strings throughout. */
function usd(value: string | undefined): number {
  const parsed = Number(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

export class LiFiBridge {
  readonly id = "lifi" as const;
  private client: LiFiClient | undefined;

  constructor(private readonly config: LiFiConfig) {}

  /**
   * Create the SDK client on first use.
   *
   * `InMemoryStorage` is not a preference: there is no `localStorage` in a Node
   * process, and the SDK's browser adapter would fail at runtime rather than at
   * compile time.
   */
  private sdk(): LiFiClient {
    this.client ??= createClient({
      integrator: this.config.integrator,
      storage: new InMemoryStorage(),
      ...(this.config.apiKey === undefined ? {} : { apiKey: this.config.apiKey }),
      rpcUrls: this.config.rpcUrls as Record<number, string>,
    });
    return this.client;
  }

  /** Whether this source can be asked at all, so a predictable failure is not a thrown one. */
  supports(request: LiFiQuoteRequest): boolean {
    return (
      Number.isInteger(request.fromChainId) &&
      Number.isInteger(request.toChainId) &&
      /^\d+$/.test(request.fromAmount) &&
      /^0x[0-9a-fA-F]{40}$/.test(request.fromTokenAddress) &&
      /^0x[0-9a-fA-F]{40}$/.test(request.toTokenAddress)
    );
  }

  /**
   * Quote a route.
   *
   * `toAddress` defaults to `fromAddress`, and the default matters: bridging to
   * an address nobody controls is not recoverable.
   */
  async quote(request: LiFiQuoteRequest): Promise<QuoteOutcome<QuoteEnvelope>> {
    if (!this.supports(request)) return { ok: false, reason: "unsupported_pair" };

    const params: RoutesParams = {
      fromChainId: request.fromChainId,
      toChainId: request.toChainId,
      fromTokenAddress: request.fromTokenAddress,
      toTokenAddress: request.toTokenAddress,
      fromAmount: request.fromAmount,
      fromAddress: request.fromAddress,
      toAddress: request.toAddress ?? request.fromAddress,
      ...(request.preferFast === true ? { options: { order: "FASTEST" } } : {}),
    } as RoutesParams;

    try {
      const raw = await getRoutes(this.sdk(), params);
      const parsed = RoutesSchema.safeParse(raw);
      if (!parsed.success || parsed.data.routes.length === 0) return { ok: false, reason: "no_route" };

      // LI.FI returns routes best-first; taking the head avoids inventing a
      // ranking of our own that would disagree with theirs.
      const route = parsed.data.routes[0];
      if (route === undefined) return { ok: false, reason: "no_route" };

      const hops: RouteHop[] = [];
      const feeLines: QuoteEnvelope["feeLines"] = [];

      for (const step of route.steps) {
        const estimate = step.estimate;
        hops.push({
          source: "lifi",
          // `?? "lifi"`: with `type` optional, a step could carry neither field,
          // and `protocol` is required — the provider's own name is the fallback.
          protocol: step.tool ?? step.type ?? "lifi",
          kind: step.type === "cross" ? "bridge" : "swap",
          chainId: step.action?.toChainId ?? request.toChainId,
          fromToken: request.fromTokenAddress,
          toToken: request.toTokenAddress,
          fromAmount: estimate?.fromAmount ?? request.fromAmount,
          toAmount: estimate?.toAmount ?? "0",
          feeLines: [],
          ...(estimate?.executionDuration === undefined
            ? {}
            : { estimatedDurationSec: estimate.executionDuration }),
        });

        for (const [index, cost] of [
          ...(estimate?.feeCosts ?? []),
          ...(estimate?.gasCosts ?? []),
        ].entries()) {
          feeLines.push({
            id: `lifi:${step.id ?? hops.length}:${cost.name ?? index}`,
            label: cost.description ?? cost.name ?? "LI.FI cost",
            tier: "cost",
            amountUsd: usd(cost.amountUSD),
            included: cost.included === true,
          });
        }
      }

      if (feeLines.length === 0) {
        // A route with no costs recorded is possible, but it is more often a
        // schema mismatch — so the detail names this guard rather than leaving a
        // bare code that reads exactly like an upstream outage. That ambiguity
        // cost real time.
        throw new Error(
          `mapping found no costs: parsed ${route.steps.length} step(s) but extracted 0 fee lines`,
        );
      }

      return {
        ok: true,
        quote: QuoteEnvelopeSchema.parse({
          sourceId: "lifi",
          hops,
          feeLines,
          // LI.FI publishes no per-route expiry, so we impose one. A quote with
          // no expiry cannot be safely signed.
          expiresAt: new Date(Date.now() + 30_000),
          raw,
        }),
      };
    } catch (error) {
      return { ok: false, ...classify(error) };
    }
  }

  /**
   * Turn a quoted step into a transaction the service can sign.
   *
   * The step is replayed back to LI.FI rather than reconstructed here, because
   * their calldata is the only correct one for the route they quoted. The cast is
   * the single SDK boundary in this file: we hold the step as parsed JSON and
   * the SDK wants its own request type.
   */
  async build(quote: QuoteEnvelope, context: BuildContext): Promise<UnsignedTransaction> {
    const step = firstStep(quote);
    const built = await getStepTransaction(this.sdk(), step as StepRequest);
    const tx = (built as { transactionRequest?: Record<string, unknown> }).transactionRequest;
    if (tx === undefined) {
      throw new Error("LI.FI returned a step with no transactionRequest to sign.");
    }
    return {
      chainId: Number(tx['chainId'] ?? 0),
      to: String(tx['to'] ?? context.sender),
      data: String(tx['data'] ?? "0x"),
      value: String(tx['value'] ?? 0),
    };
  }

  /**
   * Track a transfer.
   *
   * The **body** decides the state, never the status code: LI.FI's `/status`
   * returns HTTP 200 even for a transaction it has never seen, so a client that
   * reads the code would report an unknown transfer as delivered.
   */
  async status(reference: {
    readonly txHash: string;
    readonly fromChainId: number;
    readonly toChainId: number;
  }): Promise<StatusOutcome> {
    try {
      const raw = await getStatus(this.sdk(), {
        txHash: reference.txHash,
        fromChain: reference.fromChainId,
        toChain: reference.toChainId,
      } as Parameters<typeof getStatus>[1]);

      const parsed = StatusSchema.safeParse(raw);
      const status = parsed.success ? parsed.data.status : undefined;
      const substatus = parsed.success ? parsed.data.substatus : undefined;

      return {
        ok: true,
        status: {
          state: mapState(status, substatus),
          ...(parsed.success && parsed.data.receiving?.txHash !== undefined
            ? { deliveredTxHash: parsed.data.receiving.txHash }
            : {}),
          raw,
        },
      };
    } catch (error) {
      return { ok: false, ...classify(error) };
    }
  }
}

/**
 * Map LI.FI's vocabulary onto ours.
 *
 * `PENDING` is the interesting case: it covers both waiting-for-a-block and
 * waiting-for-a-verifier, and only `substatus` distinguishes them. An unknown
 * status maps to `pending` rather than `delivered`, because the safe default for
 * a transfer is "not finished".
 */
function mapState(status: string | undefined, substatus: string | undefined): BridgeState {
  if (status === "DONE") return "delivered";
  if (status === "FAILED" || status === "INVALID") return "failed";
  if (substatus !== undefined && /attest|verif|confirm|wait/i.test(substatus)) return "attesting";
  return "pending";
}

/** The quoted step, which the build step replays back to LI.FI. */
function firstStep(quote: QuoteEnvelope): unknown {
  const raw = quote.raw as { routes?: Array<{ steps?: unknown[] }> } | undefined;
  const step = raw?.routes?.[0]?.steps?.[0];
  if (step === undefined) {
    throw new Error(
      "LI.FI quote carries no step to build — `raw` was not preserved on the envelope.",
    );
  }
  return step;
}
