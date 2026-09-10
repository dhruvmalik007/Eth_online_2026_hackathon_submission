/**
 * StrategyState — LangGraph channels for the deterministic execution pipeline.
 *
 * Topology (see graph.ts):
 *   START → parseMandate → fetchMarketData → computeStrategy → riskGate
 *      riskGate.fail → renderReport → END        (abort: mandate infeasible)
 *      riskGate.pass → buildExecutionPlan → executeLegs → verifyResults → renderReport → END
 *
 * Fail-soft: every node try/catches into `errors`; only `executeLegs` in live mode
 * hard-fails after recording which legs succeeded (rollback notes in the report).
 */
import type { MarketSnapshot } from "./marketData.js";
import type { StrategyResult } from "../tools/fixedIncomeMath.js";

export type ExecutionMode = "dry" | "live";

export type LegKind = "arc-bridge" | "oneinch-swap" | "v4-mint";

export interface MandateIntent {
  sizeUsd: number;
  minAprPercent: number;
  vegaBudget: number;
  chains: string[];
  hookedOnly: boolean;
  asset: string;
  maxCandidates: number;
  leverageStable: number;
  leverageVolatile: number;
  idleFractionHooked: number;
  minVolumeUsd: number;
  feeSlopeMode: "estimated" | "static";
}

export interface ExecutionLeg {
  seq: number;
  kind: LegKind;
  label: string;
  chain: string;
  // v4 leg
  poolId?: string;
  pair?: string;
  notionalUsd?: number;
  // bridge leg
  fromChain?: string;
  toChain?: "arc";
  bridgeAmountUsdc?: number;
  // swap leg
  fromToken?: string;
  toToken?: string;
  swapAmountUsdc?: number;
}

export interface LegResult {
  seq: number;
  kind: LegKind;
  label: string;
  simulated: boolean; // true in dry mode (or degraded live)
  reason?: string; // why simulated (e.g. 'dry-mode' | 'no-api-key')
  to?: string;
  data?: string; // encoded calldata (dry) 
  value?: string;
  txHash?: string; // live only
  explorerUrl?: string;
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface StrategyState {
  mandate: string;
  mode: ExecutionMode;
  intent?: MandateIntent;
  market?: MarketSnapshot;
  strategy?: StrategyResult;
  gate?: { passed: boolean; reasons: string[] };
  plan: ExecutionLeg[];
  results: LegResult[];
  verification: { checks: VerificationCheck[]; passed: boolean };
  report?: string;
  errors: string[];
}

export const initialStrategyState = (mandate: string, mode: ExecutionMode): StrategyState => ({
  mandate,
  mode,
  plan: [],
  results: [],
  verification: { checks: [], passed: false },
  errors: [],
});
