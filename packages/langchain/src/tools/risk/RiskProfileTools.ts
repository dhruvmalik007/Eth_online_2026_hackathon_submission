import { tool } from '@langchain/core/tools';
import * as z from 'zod';
import {
  countRiskRelevantProposals,
  rate,
  type RiskProfileReader,
} from '@ethonline2026/risk-analysis-data-pipeline';
import { buildRiskContext } from '../../graph/v01/riskContext.js';

/**
 * Risk-profile tools — thin adapters over the risk-analysis snapshots.
 *
 * These own no logic. Each validates its input, calls one reader method (or the
 * shared derivation), and shapes JSON. Every figure they return came from a
 * published snapshot or from the deterministic derivation, so a downstream
 * citation cannot point at a number the agent invented.
 *
 * The derivation is deliberately *not* reimplemented here: `buildRiskContext` is
 * the same function the v0.1 graph runs before synthesis, so a tool call and a
 * graph cycle cannot produce different parameters for the same chain.
 */

/**
 * The reading returned with a derived adjustment.
 *
 * Kept out of the handler so the tool body stays about data flow, and so the
 * wording can be asserted in a test.
 */
export const ADJUSTMENT_READING =
  'Every factor is deterministic and carries its inputs, so a parameter can be explained ' +
  'rather than asserted. volatilitySource="fallback" means no realized volatility was ' +
  'supplied and the documented constant was used — treat the volatility figure as an ' +
  'assumption, not a measurement. Slugs listed in `unresolved` had no snapshot: that term ' +
  'is absent, not zero.';

export interface RiskToolDeps {
  /**
   * The snapshot reader. Absent means the risk routes are unconfigured, which
   * each tool reports rather than failing — matching how the rest of the agent
   * degrades when an optional dependency is missing.
   */
  readonly reader?: RiskProfileReader | undefined;
}

/** A tool error, shaped so the model sees an actionable message. */
function missing(query: Record<string, unknown>): string {
  return JSON.stringify({
    ...query,
    status: 'risk_snapshots_unavailable',
    detail:
      'No risk snapshot store is configured. Set RISK_GCS_BUCKET (or RISK_LOCAL_DIR); ' +
      'the pipeline writes snapshots every six hours.',
  });
}

/**
 * The chain's macro risk, with the L2Beat evidence behind each dimension.
 *
 * @param deps - The injected reader.
 * @returns The tool set, keyed by purpose.
 */
export function createRiskTools(deps: RiskToolDeps) {
  /** What is this chain's macro risk regime? */
  const chainRiskTool = tool(
    async (input: unknown) => {
      const { chain } = input as { chain?: string };
      if (chain === undefined || chain.trim().length === 0) {
        return JSON.stringify({ error: 'chain is required' });
      }
      if (deps.reader === undefined) return missing({ chain });

      try {
        const loaded = await deps.reader.chain(chain);
        if (loaded === null) {
          return JSON.stringify({
            chain,
            status: 'no_snapshot',
            detail: 'No risk snapshot for that chain yet — it may not be in the collected roster.',
          });
        }
        const profile = loaded.value;
        return JSON.stringify(
          {
            chain: profile.slug,
            name: profile.name,
            stage: profile.stage,
            valueSecuredUsd: profile.valueSecuredUsd,
            riskScores: profile.riskScores,
            // The verbatim strings, so a score can be audited against what
            // L2Beat actually published rather than taken on trust.
            dimensions: profile.dimensions,
            fetchedAt: profile.provenance.fetchedAt,
            reading:
              'riskScores are 0–1, higher is safer. Compare `stage` first: a Stage 2 chain ' +
              'is not comparable to a Stage 0 one on score alone. The dimension `raw` strings ' +
              'are L2Beat verbatim and are the evidence for each category.',
          },
          null,
          2,
        );
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'risk_chain_profile',
      description:
        "A chain's macro risk profile: L2Beat Stage, the five decentralisation dimensions with their verbatim source strings, value secured, and 0–1 scores. Use it before deploying a strategy on a chain. Never invent these values.",
      schema: z.object({
        chain: z.string().describe('Chain slug, e.g. base, arbitrum, optimism'),
      }),
    },
  );

  /** Is governance pressure building on a protocol? */
  const governanceRiskTool = tool(
    async (input: unknown) => {
      const { protocol, limit = 10 } = input as { protocol?: string; limit?: number };
      if (protocol === undefined || protocol.trim().length === 0) {
        return JSON.stringify({ error: 'protocol is required' });
      }
      if (deps.reader === undefined) return missing({ protocol });

      try {
        const loaded = await deps.reader.protocol(protocol);
        if (loaded === null) {
          return JSON.stringify({
            protocol,
            status: 'no_snapshot',
            detail: 'No governance snapshot for that protocol yet.',
          });
        }
        const profile = loaded.value;
        const sorted = [...profile.proposals].sort(
          (a, b) => new Date(b.lastPostedAt).getTime() - new Date(a.lastPostedAt).getTime(),
        );
        return JSON.stringify(
          {
            protocol: profile.slug,
            name: profile.name,
            category: profile.category,
            forumUrl: profile.governance.forumUrl,
            platform: profile.governance.platform,
            governanceScores: profile.governanceScores,
            proposalCount: profile.proposals.length,
            openProposals: profile.proposals.filter((p) => p.status === 'open').length,
            // Same predicate the history writer stores, so the tool's figure and
            // the stored series agree.
            riskRelevantProposals: countRiskRelevantProposals(profile.proposals),
            recentProposals: sorted.slice(0, limit).map((p) => ({
              title: p.title,
              stage: p.stage,
              status: p.status,
              url: p.url,
              lastPostedAt: p.lastPostedAt,
            })),
            reading:
              'riskRelevantProposals are those whose titles mention collateral, liquidation, ' +
              'oracle, rate-model or cap parameters — the ones that can move the risk surface. ' +
              'Read the titles before treating a count as sentiment.',
          },
          null,
          2,
        );
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'risk_governance_profile',
      description:
        "A protocol's governance state: proposal counts, open proposals, risk-relevant proposals, activity/participation scores, and the forum URL the data came from. Use it to judge whether a parameter change could be coming.",
      schema: z.object({
        protocol: z.string().describe('Protocol slug, e.g. aave, morpho, uniswap'),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe('How many recent proposals to include (default 10)'),
      }),
    },
  );

  /** The derived Black-Scholes/Merton parameters for a chain. */
  const riskAdjustmentTool = tool(
    async (input: unknown) => {
      const { chain, protocol, marketMakers, volatility, baseRate } = input as {
        chain?: string;
        protocol?: string;
        marketMakers?: string[];
        volatility?: number;
        baseRate?: number;
      };
      if (chain === undefined || chain.trim().length === 0) {
        return JSON.stringify({ error: 'chain is required' });
      }
      if (deps.reader === undefined) return missing({ chain });

      try {
        const loaded = await deps.reader.chain(chain);
        if (loaded === null) {
          return JSON.stringify({ chain, status: 'no_snapshot' });
        }

        const context = await buildRiskContext({
          chain: loaded.value,
          protocols: protocol === undefined ? [] : [protocol],
          ...(marketMakers === undefined ? {} : { marketMakers }),
          readers: deps.reader,
          ...(volatility === undefined ? {} : { realizedVolatility: rate(volatility) }),
          ...(baseRate === undefined ? {} : { baseRiskFreeRate: rate(baseRate) }),
        });

        return JSON.stringify({ ...context, reading: ADJUSTMENT_READING }, null, 2);
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'risk_adjustment',
      description:
        'The derived Black-Scholes/Merton parameters for a chain — volatility, risk-free rate, collateral haircut, probability-of-default load and liquidity score — each with the inputs that produced it. Cite the returned `id` when a decision depends on these. These are computed deterministically; never derive or adjust them yourself.',
      schema: z.object({
        chain: z.string().describe('Chain slug the strategy is deployed on'),
        protocol: z.string().optional().describe('Protocol slug to include its governance term'),
        marketMakers: z
          .array(z.string())
          .optional()
          .describe('Market-maker slugs whose depth feeds the liquidity score'),
        volatility: z
          .number()
          .nonnegative()
          .optional()
          .describe('Measured realized volatility as a decimal (e.g. 0.8). Omit to use the documented fallback.'),
        baseRate: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('Base risk-free rate as a decimal (default 0.05)'),
      }),
    },
  );

  return { chainRiskTool, governanceRiskTool, riskAdjustmentTool };
}
