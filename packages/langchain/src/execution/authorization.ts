import { z } from 'zod';

/**
 * V0.1 execution authorization — dry-first, scoped, HITL-gated.
 *
 * The v0.1 agent's execution matrix (readjustmentDecisions) is converted
 * into a signed-off execution authorization: a proposal that has passed
 * (a) the deterministic guardrails/risk gate, (b) a backtest score above
 * the acceptance threshold, and (c) trader approval at the HITL interrupt.
 * The LLM proposes; this module validates scope; the wallet contract
 * enforces it. No raw calldata is ever generated or accepted here.
 */

export const ProposalScopeSchema = z.object({
  /** Per-protocol allowance caps the smart account enforces (USD). */
  protocol: z.string().min(1),
  action: z.enum(['WITHDRAW_LIQUIDITY', 'SUPPLY_CAPITAL', 'DEPOSIT_LSD', 'HOLD']),
  /** Allocation from the readjustment matrix (0–100). */
  amountPercentage: z.number().min(0).max(100),
  /** USD notional derived from portfolio size — the cap the scope enforces. */
  notionalUsdCap: z.number().positive(),
  /** Session expiry (epoch seconds) — scope dies with the session. */
  expiresAt: z.number().int().positive(),
});

export type ProposalScope = z.infer<typeof ProposalScopeSchema>;

export const ExecutionAuthorizationSchema = z.object({
  approved: z.boolean(),
  /** 'dry' authorizations produce the judge-verifiable artifact only. */
  mode: z.enum(['dry', 'live']),
  scopes: z.array(ProposalScopeSchema),
  /** Backtest evidence the approval was conditioned on. */
  backtestScore: z.object({
    hitRate: z.number(),
    mape: z.number(),
    pnlVsHodl: z.number(),
  }),
  /** Traceability to the readjustment matrix + projections. */
  citations: z.array(z.string()).min(1),
  rejectedReasons: z.array(z.string()),
});

export type ExecutionAuthorization = z.infer<typeof ExecutionAuthorizationSchema>;

export const BACKTEST_GATE = {
  /** Minimum fraction of steps landing inside the q10–q90 band. */
  minHitRate: 0.7,
  /** Maximum median MAPE tolerated. */
  maxMape: 0.25,
} as const;

/** Deterministic backtest gate — mirrors the tool's verdict logic. */
export function backtestPasses(score: { hitRate: number; mape: number }): boolean {
  return score.hitRate >= BACKTEST_GATE.minHitRate && score.mape <= BACKTEST_GATE.maxMape;
}

/**
 * Convert an approved readjustment matrix into scoped authorizations.
 * Throws (never silently skips) when a scope cannot be derived — a proposal
 * without backtest evidence or with uncited entries must not authorize.
 */
export function authorizeExecution(input: {
  mode: 'dry' | 'live';
  portfolioUsd: number;
  sessionExpiresAt: number;
  decisions: ReadonlyArray<{
    action: string;
    protocol: string;
    amountPercentage: number;
    citations: readonly string[];
  }>;
  backtestScore: { hitRate: number; mape: number; pnlVsHodl: number };
}): ExecutionAuthorization {
  const rejectedReasons: string[] = [];

  if (!backtestPasses(input.backtestScore)) {
    rejectedReasons.push(
      `backtest gate failed (hitRate ${input.backtestScore.hitRate.toFixed(2)} < ${BACKTEST_GATE.minHitRate} or mape ${input.backtestScore.mape.toFixed(2)} > ${BACKTEST_GATE.maxMape})`,
    );
  }
  if (!input.decisions.every((d) => d.citations.length > 0)) {
    rejectedReasons.push('uncited decision present (hallucination guard)');
  }
  const total = input.decisions.reduce((sum, d) => sum + d.amountPercentage, 0);
  if (Math.abs(total - 100) > 1) {
    rejectedReasons.push(`allocations sum to ${total}, expected 100 ± 1`);
  }
  const unknownAction = input.decisions.find((d) =>
    !['WITHDRAW_LIQUIDITY', 'SUPPLY_CAPITAL', 'DEPOSIT_LSD', 'HOLD'].includes(d.action),
  );
  if (unknownAction !== undefined) {
    rejectedReasons.push(`unknown action "${unknownAction.action}"`);
  }

  const approved = rejectedReasons.length === 0;

  const scopes = approved
    ? input.decisions
        .filter((d) => d.action !== 'HOLD')
        .map((d) =>
          ProposalScopeSchema.parse({
            protocol: d.protocol,
            action: d.action,
            amountPercentage: d.amountPercentage,
            notionalUsdCap: (d.amountPercentage / 100) * input.portfolioUsd,
            expiresAt: input.sessionExpiresAt,
          }),
        )
    : [];

  const allCitations = input.decisions.flatMap((d) => d.citations);

  return {
    approved,
    mode: approved ? input.mode : 'dry',
    scopes,
    backtestScore: input.backtestScore,
    citations: [...new Set(allCitations)],
    rejectedReasons,
  };
}
