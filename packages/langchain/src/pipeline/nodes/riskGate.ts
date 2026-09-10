/**
 * riskGate — code-level APR / vega / concentration / stress checks (NO AI). Pure
 * function over a StrategyResult + a leg-lookup so it is unit-testable offline.
 *
 * Mirrors the desk-session riskGuardian semantics (plan §3.4 / §9.2): an allocation
 * that breaches the mandate's constraints is rejected with reasons; the pipeline then
 * renders an abort report explaining *why* the mandate is infeasible (a feature).
 */
import type { StrategyResult, StrategyLeg } from "../../tools/fixedIncomeMath.js";

export interface RiskGateInput {
  strategy: StrategyResult;
  legs: StrategyLeg[]; // the pre-allocation legs (carry sigma/leverage/feeApy/etc + poolId)
  minAprPercent: number;
  vegaBudget: number;
  maxConcentrationPct?: number; // default 50%
}

export function evaluateRiskGate(input: RiskGateInput): { passed: boolean; reasons: string[] } {
  const { strategy, legs, minAprPercent, vegaBudget } = input;
  const maxConcentrationPct = input.maxConcentrationPct ?? 50;
  const byId = new Map(legs.map((l) => [l.poolId, l]));
  const reasons: string[] = [];

  const achievedAprPct = strategy.achievedApr * 100;
  if (achievedAprPct < minAprPercent) {
    reasons.push(`achieved APR ${achievedAprPct.toFixed(2)}% below mandate ${minAprPercent}%`);
  }

  if (Math.abs(strategy.portfolioVega) > vegaBudget) {
    reasons.push(`portfolio vega ${strategy.portfolioVega.toFixed(3)} exceeds budget ${vegaBudget}`);
  }

  if (strategy.maxConcentration * 100 > maxConcentrationPct) {
    reasons.push(`max concentration ${(strategy.maxConcentration * 100).toFixed(1)}% exceeds ${maxConcentrationPct}% cap`);
  }

  // Stress: re-run netAPY at σ×1.5 per leg; the weighted portfolio must stay >= 0
  // (the fixed-income floor). fee leg scales with sigma (k·sigma), LVR scales with sigma².
  let stressedNetApr = 0;
  let totalWeight = 0;
  for (const leg of strategy.legs) {
    const src = byId.get(leg.poolId);
    if (!src) continue;
    const stressedSigma = src.sigma * 1.5;
    const lvrStress = (src.leverage ** 2 * stressedSigma ** 2) / 8;
    const feeLeg = src.feeApy + src.feeSlopeK * (stressedSigma - src.sigma);
    const net = (1 - src.idleFraction) * feeLeg + src.idleFraction * src.lendingApy - lvrStress;
    stressedNetApr += net * leg.weight;
    totalWeight += leg.weight;
  }
  if (totalWeight > 0 && stressedNetApr * 100 < 0) {
    reasons.push(`stress (σ×1.5) drives portfolio net APY negative (${(stressedNetApr * 100).toFixed(2)}%)`);
  }

  return { passed: reasons.length === 0, reasons };
}
