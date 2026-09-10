import { END, START, StateGraph } from '@langchain/langgraph';
import { z } from 'zod';
import type { TimeseriesClient } from '@ethonline2026/timeseries';
import type { TimesFM3Client } from '../../services/timesfm3/index.js';
import { loadProtocolRules } from './corpus.js';
import { assessRisk } from './guardrails.js';
import { parseProtocolRules, type StructuredLlm } from './ruleParser.js';
import { generateReadjustment, synthesize } from './synthesis.js';
import {
  V01Annotation,
  YieldProjectionSchema,
  type V01State,
  type YieldProjection,
} from './schemas.js';

/**
 * V0.1 agent — the 5-node LangGraph state machine from
 * docs/timeseries-model-architecture.md:
 *
 *   1. Protocol Ingestion (deterministic Category A/B split)
 *   2. Legal & Rule Parsing   (LLM, structured output)
 *   3. Temporal Yield Prediction (TimesFM-3, deterministic)
 *   4. Quant Synthesis        (LLM over pre-computed risk)
 *   5. Readjustment Engine    (LLM → deterministic execution matrix)
 *
 * Cyclical: node 5's deterministic risk gate can force one re-plan cycle
 * (bounded by replanCount) back through synthesis; the LLM never signs,
 * never builds calldata, never executes.
 */

export interface V01Deps {
  /** Rule-parser role (model registry resolves the family per env). */
  readonly parserLlm: StructuredLlm;
  /** Synthesis/readjustment role. */
  readonly synthesisLlm: StructuredLlm;
  readonly timesfm3: TimesFM3Client;
  readonly tsdb: TimeseriesClient;
  /** Forecast horizon in days (default 30). */
  readonly horizonDays?: number;
}

const IngestInputSchema = z.object({
  mandate: z.string().min(1),
  protocols: z.array(z.string()).min(1),
  poolIds: z.array(z.string()).min(1),
  horizonDays: z.number().int().positive().max(365).default(30),
});

export type V01Input = z.infer<typeof IngestInputSchema>;

export function buildV01Graph(deps: V01Deps) {
  const graph = new StateGraph(V01Annotation)
    // ── node 1: Protocol Data Ingestion (deterministic split) ──────────────
    .addNode('ingestion', (state: V01State) => {
      const rules = loadProtocolRules(state.sectors);
      const missing = state.sectors.filter(
        (s) => !rules.some((r) => r.sector === s || r.protocol === s),
      );
      return {
        rawProtocolRules: rules,
        audit: [
          ...state.audit,
          {
            at: new Date().toISOString(),
            node: 'ingestion',
            detail: `ingested ${rules.length} rule docs (sectors: ${state.sectors.join(', ')})${
              missing.length > 0 ? `; missing rules for: ${missing.join(', ')}` : ''
            }`,
          },
        ],
      };
    })
    // ── node 2: Legal & Rule Parsing (LLM structured output) ───────────────
    .addNode('ruleParsing', async (state: V01State) => {
      try {
        const constraints = await parseProtocolRules({
          docs: state.rawProtocolRules,
          llm: deps.parserLlm,
        });
        return {
          protocolConstraints: constraints,
          audit: [
            ...state.audit,
            {
              at: new Date().toISOString(),
              node: 'ruleParsing',
              detail: `parsed ${constraints.length} constraints with source provenance`,
            },
          ],
        };
      } catch (err) {
        // typed failure — unparseable rules never become guessed constraints
        return {
          protocolConstraints: [],
          audit: [
            ...state.audit,
            {
              at: new Date().toISOString(),
              node: 'ruleParsing',
              detail: `constraints_unavailable: ${(err as Error).message}`,
            },
          ],
        };
      }
    })
    // ── node 3: Temporal Yield Prediction (TimesFM-3, deterministic) ───────
    .addNode('yieldPrediction', async (state: V01State) => {
      const horizonDays = deps.horizonDays ?? 30;
      const projections: YieldProjection[] = [];
      const audit: V01State['audit'] = [];

      for (const poolId of state.poolIds) {
        const since = new Date(Date.now() - 90 * 86_400_000);
        const window = await deps.tsdb.getMetricWindow(poolId, 'apy', since);
        if (window.values.length < 8) {
          audit.push({
            at: new Date().toISOString(),
            node: 'yieldPrediction',
            detail: `${poolId}: insufficient history (${window.values.length} pts) — skipped`,
          });
          continue;
        }
        const diffs: number[] = window.values.slice(1).map((v, i) => Math.abs(v - window.values[i]!));
        const forecast = await deps.timesfm3.predict({
          series: [...window.values],
          horizon: horizonDays,
          pastCovariates: [diffs],
          returnQuantiles: true,
        });
        const last = window.values[window.values.length - 1]!;
        const suspicious =
          !forecast.flags.quantileMonotonic ||
          forecast.steps.some((s) => Math.abs(s.q50 - last) > 10 * 0.05 * Math.max(last, 1e-9));
        projections.push(
          YieldProjectionSchema.parse({
            id: `proj-${poolId}-apy`,
            poolId,
            target: 'apy',
            horizonDays,
            steps: forecast.steps.map((s) => ({ day: s.index + 1, q10: s.q10, q50: s.q50, q90: s.q90 })),
            model: forecast.model,
            inputsHash: `${poolId}:apy:${window.values.length}pts:${horizonDays}d`,
            suspicious,
          }),
        );
        audit.push({
          at: new Date().toISOString(),
          node: 'yieldPrediction',
          detail: `${poolId}: ${forecast.horizon}-step forecast (model=${forecast.model}, latency=${Math.round(forecast.latencyMs)}ms, suspicious=${suspicious})`,
        });
      }

      return { yieldProjections: projections, audit: [...state.audit, ...audit] };
    })
    // ── node 4: Quant Synthesis (LLM over pre-computed risk) ───────────────
    .addNode('synthesis', async (state: V01State) => {
      const synthesis = await synthesize({
        constraints: state.protocolConstraints,
        projections: state.yieldProjections,
        llm: deps.synthesisLlm,
      });
      return {
        synthesisPayload: synthesis,
        synthesisRuns: state.synthesisRuns + 1,
        audit: [
          ...state.audit,
          {
            at: new Date().toISOString(),
            node: 'synthesis',
            detail: `${synthesis.violations.length} violations, ${synthesis.alpha.length} alpha entries`,
          },
        ],
      };
    })
    // ── node 5: Readjustment Engine + deterministic risk gate ──────────────
    .addNode('readjustment', async (state: V01State) => {
      if (state.synthesisPayload === undefined) {
        return {
          readjustmentDecisions: [],
          riskAssessment: { replanNeeded: false, reasons: ['synthesis unavailable — HOLD'], suspiciousProjections: [] },
          audit: [...state.audit, { at: new Date().toISOString(), node: 'readjustment', detail: 'HOLD (synthesis unavailable)' }],
        };
      }
      const decisions = await generateReadjustment({
        synthesis: state.synthesisPayload,
        llm: deps.synthesisLlm,
      });
      const riskAssessment = assessRisk({
        projections: state.yieldProjections,
        synthesis: state.synthesisPayload,
        decisions,
      });
      return {
        readjustmentDecisions: decisions,
        riskAssessment,
        audit: [
          ...state.audit,
          {
            at: new Date().toISOString(),
            node: 'readjustment',
            detail: `${decisions.length} decisions; guardrails: ${riskAssessment.reasons.join('; ') || 'clean'}${riskAssessment.replanNeeded ? ' → re-plan' : ''}`,
          },
        ],
      };
    })
    .addEdge(START, 'ingestion')
    .addEdge('ingestion', 'ruleParsing')
    .addEdge('ruleParsing', 'yieldPrediction')
    .addEdge('yieldPrediction', 'synthesis')
    .addEdge('synthesis', 'readjustment')
    // Cyclical: forced HOLD + one bounded re-plan cycle back through synthesis
    // (synthesisRuns is incremented by the synthesis node; ≤ 2 cycles total)
    .addConditionalEdges('readjustment', (state: V01State) =>
      state.riskAssessment.replanNeeded && state.synthesisRuns < 2
        ? 'synthesis'
        : END,
    );

  return graph.compile();
}

// ── runner (input validation + graph invocation) ─────────────────────────────

export async function runV01(
  deps: V01Deps,
  input: V01Input,
): Promise<V01State> {
  const parsed = IngestInputSchema.parse(input);
  const graph = buildV01Graph(deps);
  const finalState = await graph.invoke({
    mandate: parsed.mandate,
    sectors: parsed.protocols,
    poolIds: parsed.poolIds,
    rawProtocolRules: [],
    protocolConstraints: [],
    yieldProjections: [],
    synthesisRuns: 0,
    readjustmentDecisions: [],
    riskAssessment: { replanNeeded: false, reasons: [], suspiciousProjections: [] },
    replanCount: 0,
    audit: [],
  });
  return finalState as V01State;
}
