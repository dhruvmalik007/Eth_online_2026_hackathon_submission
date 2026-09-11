import { END, START, StateGraph } from '@langchain/langgraph';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  FORECAST_QUANTILE_COLUMNS,
  type ForecastRepository,
  type MetricName,
  type PerformanceRepository,
  type TimeseriesClient,
  type VectorRepository,
} from '@ethonline2026/timeseries';
import type { TimesFM3Client, TimesFMForecast } from '../../services/timesfm3/index.js';
import type { RiskProfileReader } from '@ethonline2026/risk-analysis-data-pipeline';
import { perStepChangeCovariate } from '../../services/timesfm3/covariates.js';
import { loadProtocolRules } from './corpus.js';
import { assessRisk, validateRetrievalEvidence } from './guardrails.js';
import { buildRiskContext } from './riskContext.js';
import { parseProtocolRules, type StructuredLlm } from './ruleParser.js';
import { generateReadjustment, synthesize } from './synthesis.js';
import {
  V01Annotation,
  CalibrationSliceSchema,
  RetrievalEvidenceSchema,
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
 *   3. Temporal Yield Prediction (TimesFM-3, deterministic → persisted)
 *   4. Quant Synthesis        (LLM over pre-computed risk + retrieved evidence)
 *   5. Readjustment Engine    (LLM → deterministic execution matrix)
 *
 * Cyclical: node 5's deterministic risk gate can force one re-plan cycle
 * (bounded by replanCount) back through synthesis; the LLM never signs,
 * never builds calldata, never executes.
 *
 * The two models never hand each other prose. TimesFM-3 writes a ledger row
 * and the state carries its `forecastRunId`; retrieval returns chunks tagged
 * with the row ids they were rendered from. Every number the LLM sees is
 * therefore traceable to a stored row, and anything without provenance is
 * dropped before it can enter the prompt.
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
  /** When present, node 3 persists runs and node 5 reads calibration. */
  readonly forecastRepo?: ForecastRepository;
  readonly performanceRepo?: PerformanceRepository;
  /** When present, node 5 retrieves historical context for synthesis. */
  readonly vectorRepo?: VectorRepository;
  /**
   * Resolves the risk snapshot reader on first use, or `undefined` when no store
   * is configured. A thunk rather than the reader itself so the GCS SDK is not
   * loaded for a run that never needs a risk context.
   */
  readonly resolveRiskReader?: () => Promise<RiskProfileReader | undefined>;
}

const IngestInputSchema = z.object({
  mandate: z.string().min(1),
  protocols: z.array(z.string()).min(1),
  poolIds: z.array(z.string()).min(1),
  horizonDays: z.number().int().positive().max(365).default(30),
  /** Optional chain slug; when given, chain-level risk is derived for synthesis. */
  chain: z.string().min(1).optional(),
});

export type V01Input = z.infer<typeof IngestInputSchema>;

/**
 * Persist a TimesFM-3 forecast as a ledger run and return its id.
 *
 * Target timestamps are derived from the issue time plus the step offset, so a
 * stored step lines up with the realized metric row it will later be scored
 * against. Returns null (with a reason) when persistence is unavailable or
 * rejected — the caller records that in the audit rather than failing the run,
 * because a forecast is still useful for reasoning even unpersisted.
 */
async function persistForecastRun(input: {
  readonly repo: ForecastRepository | undefined;
  readonly poolId: string;
  readonly metric: MetricName;
  readonly forecast: TimesFMForecast;
  readonly issuedAt: Date;
  readonly contextHash: string;
}): Promise<{ runId: string; stepCount: number } | { error: string }> {
  if (input.repo === undefined) return { error: 'forecast ledger not configured' };

  const runId = randomUUID();
  try {
    const written = await input.repo.saveRun({
      runId,
      poolId: input.poolId,
      metric: input.metric,
      issuedAt: input.issuedAt,
      modelVersion: input.forecast.model,
      contextHash: input.contextHash,
      latencyMs: input.forecast.latencyMs,
      steps: input.forecast.steps.map((step) => {
        // Widen the client's triple to the ledger's nine-level vector using the
        // shared column catalog, so the two packages cannot drift on ordering.
        const quantiles = Object.fromEntries(
          FORECAST_QUANTILE_COLUMNS.map((column, level) => [column, step.quantiles[level]!]),
        ) as Record<(typeof FORECAST_QUANTILE_COLUMNS)[number], number>;
        return {
          targetTs: new Date(input.issuedAt.getTime() + (step.index + 1) * 86_400_000),
          horizonStep: step.index + 1,
          point: step.q50,
          quantiles,
        };
      }),
    });
    return { runId, stepCount: written };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * Retrieval step for node 4 (synthesis).
 *
 * Kept as a helper rather than its own graph node so the machine stays the
 * five-node architecture from docs/timeseries-model-architecture.md. The
 * synthesis core is the consumer of this context, so gathering it at the top
 * of that node is where it belongs.
 *
 * Both sources are optional: an unconfigured or unavailable vector layer
 * degrades to "no evidence" and says so in the audit, never silently.
 */
async function retrieveContext(deps: V01Deps, state: V01State): Promise<{
  evidence: V01State['evidence'];
  calibration: V01State['calibration'];
  riskProfile: V01State['riskProfile'];
  audit: V01State['audit'];
}> {
  const audit: V01State['audit'] = [];
  const poolId = state.poolIds[0];

  let calibration: V01State['calibration'] = null;
  if (deps.performanceRepo !== undefined && poolId !== undefined) {
    const to = new Date();
    const from = new Date(to.getTime() - 180 * 86_400_000);
    const summaries = await deps.performanceRepo.getCalibrationSummary(poolId, { from, to });
    const first = summaries[0];
    if (first !== undefined) {
      calibration = CalibrationSliceSchema.parse({
        poolId: first.poolId,
        metric: first.metric,
        samples: first.samples,
        coverage: first.coverage,
        meanPinballLoss: first.meanPinballLoss,
        meanAbsoluteError: first.meanAbsoluteError,
        meanAbsolutePercentageError: first.meanAbsolutePercentageError,
      });
      audit.push({
        at: new Date().toISOString(),
        node: 'synthesis',
        detail: `calibration for ${poolId}/${first.metric}: coverage=${first.coverage.toFixed(3)} samples=${first.samples}`,
      });
    }
  }

  let evidence: V01State['evidence'] = [];
  if (deps.vectorRepo !== undefined) {
    const query =
      `yield performance and forecast history for ${poolId ?? 'the portfolio'}: ${state.mandate}`;
    try {
      const hits = await deps.vectorRepo.searchTemporal(
        poolId === undefined ? { query, k: 6 } : { query, poolId, k: 6 },
      );
      const mapped = hits.map((hit) =>
        RetrievalEvidenceSchema.parse({
          id: hit.id,
          poolId: hit.poolId,
          kind: hit.kind,
          tsStart: hit.tsStart.toISOString(),
          tsEnd: hit.tsEnd.toISOString(),
          score: hit.score,
          sourceIds: [...hit.sourceIds],
          content: hit.content,
        }),
      );
      // Guard before admission: unverifiable chunks never reach the prompt.
      const { admitted, rejected } = validateRetrievalEvidence(mapped);
      evidence = admitted;
      audit.push({
        at: new Date().toISOString(),
        node: 'synthesis',
        detail:
          `retrieved ${hits.length} chunk(s); admitted ${admitted.length}` +
          (rejected.length > 0 ? `; rejected ${rejected.length} (${rejected.join('; ')})` : ''),
      });
    } catch (err) {
      audit.push({
        at: new Date().toISOString(),
        node: 'synthesis',
        detail: `vector retrieval unavailable: ${(err as Error).message}`,
      });
    }
  }

  // Chain-level risk, derived deterministically before the model sees anything.
  // The LLM is given these parameters; it never computes them, and a decision
  // that cites the context is checked against the id set here.
  let riskProfile: V01State['riskProfile'] = null;
  const chainSlug = state.chain;
  const reader = await deps.resolveRiskReader?.();
  if (reader !== undefined && chainSlug !== null) {
    try {
      const chain = await reader.chain(chainSlug);
      if (chain === null) {
        audit.push({
          at: new Date().toISOString(),
          node: 'synthesis',
          detail: `no risk snapshot for chain '${chainSlug}'; synthesis runs without macro risk`,
        });
      } else {
        riskProfile = await buildRiskContext({
          chain: chain.value,
          // `sectors` carries the protocol identifiers the mandate named (the
          // ingestion node feeds it to the rule corpus), so it is the protocol
          // list here.
          protocols: state.sectors,
          readers: reader,
        });
        audit.push({
          at: new Date().toISOString(),
          node: 'synthesis',
          detail:
            `risk context ${riskProfile.id}: volatility=${riskProfile.adjustment.volatility.toFixed(4)} ` +
            `(${riskProfile.volatilitySource}) haircut=${riskProfile.adjustment.collateralHaircut.toFixed(4)} ` +
            `pdLoad=${riskProfile.adjustment.pdLoad.toFixed(4)}`,
        });
      }
    } catch (err) {
      audit.push({
        at: new Date().toISOString(),
        node: 'synthesis',
        detail: `risk snapshots unavailable: ${(err as Error).message}`,
      });
    }
  }

  return { evidence, calibration, riskProfile, audit };
}

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
      let lastRunId: string | null = null;

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
        // Past covariate: realized per-step volatility of the same window,
        // aligned to the series length (a short covariate makes the service 500).
        const diffs = perStepChangeCovariate(window.values);
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

        // Persist before anything downstream can cite it: the returned run id
        // is the anchor that makes the projection traceable to stored rows.
        const issuedAt = new Date();
        const contextHash = `${poolId}:apy:${window.values.length}pts:${horizonDays}d`;
        const persisted = await persistForecastRun({
          repo: deps.forecastRepo,
          poolId,
          metric: 'apy',
          forecast,
          issuedAt,
          contextHash,
        });
        if ('runId' in persisted) lastRunId = persisted.runId;

        projections.push(
          YieldProjectionSchema.parse({
            id: `proj-${poolId}-apy`,
            poolId,
            target: 'apy',
            horizonDays,
            steps: forecast.steps.map((s) => ({ day: s.index + 1, q10: s.q10, q50: s.q50, q90: s.q90 })),
            model: forecast.model,
            inputsHash: contextHash,
            suspicious,
            ...('runId' in persisted ? { forecastRunId: persisted.runId } : {}),
          }),
        );

        audit.push({
          at: new Date().toISOString(),
          node: 'yieldPrediction',
          detail:
            `${poolId}: ${forecast.horizon}-step forecast (model=${forecast.model}, ` +
            `latency=${Math.round(forecast.latencyMs)}ms, suspicious=${suspicious}, ` +
            `ledger=${'runId' in persisted ? `run ${persisted.runId} (${persisted.stepCount} rows)` : `not persisted: ${persisted.error}`})`,
        });
      }

      return {
        yieldProjections: projections,
        forecastRunId: lastRunId,
        audit: [...state.audit, ...audit],
      };
    })
    // ── node 4: Quant Synthesis (LLM over pre-computed risk + evidence) ────
    // Retrieval happens here (not as its own node) so the machine stays the
    // documented five-node architecture: the reasoning core is the consumer of
    // historical context, so it gathers it before prompting.
    .addNode('synthesis', async (state: V01State) => {
      const context = await retrieveContext(deps, state);
      const synthesis = await synthesize({
        constraints: state.protocolConstraints,
        projections: state.yieldProjections,
        evidence: context.evidence,
        calibration: context.calibration,
        riskProfile: context.riskProfile,
        llm: deps.synthesisLlm,
      });
      return {
        synthesisPayload: synthesis,
        evidence: context.evidence,
        calibration: context.calibration,
        riskProfile: context.riskProfile,
        synthesisRuns: state.synthesisRuns + 1,
        audit: [
          ...state.audit,
          ...context.audit,
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
        evidence: state.evidence,
        riskProfile: state.riskProfile,
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
    // (synthesisRuns is incremented by the synthesis node; ≤ 2 cycles total).
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
    chain: parsed.chain ?? null,
    sectors: parsed.protocols,
    poolIds: parsed.poolIds,
    rawProtocolRules: [],
    protocolConstraints: [],
    yieldProjections: [],
    forecastRunId: null,
    evidence: [],
    calibration: null,
    riskProfile: null,
    synthesisRuns: 0,
    readjustmentDecisions: [],
    riskAssessment: { replanNeeded: false, reasons: [], suspiciousProjections: [] },
    replanCount: 0,
    audit: [],
  });
  return finalState as V01State;
}
