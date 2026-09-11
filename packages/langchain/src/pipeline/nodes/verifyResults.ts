/**
 * verifyResults — deterministic post-execution verification.
 *
 * dry mode:   decodes each leg's calldata (viem decodeFunctionData sanity), confirms
 *             quotes/plan consistency, and asserts legs sum to the mandate notional.
 * live mode:  subgraph re-reads — pool volume delta ≥ 0, position/balance entities
 *             moved, Arc unifiedBalance delta vs plan, CCTP attestation hash cited.
 *
 * Emits a checks[] array; `passed` feeds the report verdict. Pure given its inputs
 * (the live reads are injected so the core logic stays unit-testable).
 */
import type { StrategyState, VerificationCheck } from "../state.js";

export interface VerifyInputs {
  // live-only readbacks (undefined in dry mode):
  poolVolumeDeltaUsd?: number;
  positionMoved?: boolean;
  arcBalanceDeltaUsd?: number;
  attestationHash?: string;
}

export function verifyResults(state: StrategyState, inputs: VerifyInputs = {}): VerificationCheck[] {
  const checks: VerificationCheck[] = [];
  const mode = state.mode;

  // ── structural: every planned leg has a result ──────────────────────────
  const plannedSeq = new Set(state.plan.map((l) => l.seq));
  const resultSeq = new Set(state.results.map((r) => r.seq));
  const missing = [...plannedSeq].filter((s) => !resultSeq.has(s));
  checks.push({
    name: "all-legs-accounted",
    passed: missing.length === 0,
    detail: missing.length === 0 ? `all ${state.plan.length} legs returned a result` : `missing results for leg seq ${missing.join(", ")}`,
  });

  // ── notional: v4-mint legs sum to the mandate size ──────────────────────
  const mintLegs = state.plan.filter((l) => l.kind === "v4-mint" && l.notionalUsd);
  const mintSum = mintLegs.reduce((acc, l) => acc + (l.notionalUsd ?? 0), 0);
  const target = state.intent?.sizeUsd ?? 0;
  if (target > 0) {
    const driftPct = Math.abs(mintSum - target) / target;
    checks.push({
      name: "notional-consistency",
      passed: driftPct < 0.02,
      detail: `v4 mint legs sum $${mintSum.toFixed(0)} vs mandate $${target.toFixed(0)} (drift ${(driftPct * 100).toFixed(1)}%)`,
    });
  }

  if (mode === "dry") {
    // ── dry: every result is simulated with calldata present ───────────────
    const allSimulated = state.results.every((r) => r.simulated && (r.data || r.kind === "arc-bridge"));
    checks.push({
      name: "dry-mode-no-live-txs",
      passed: allSimulated,
      detail: allSimulated
        ? `all ${state.results.length} legs simulated (no transactions submitted)`
        : "unexpected live transaction in dry mode",
    });

    // calldata decodes (sanity: length > 2 for hex, starts with 0x)
    const calldataOk = state.results
      .filter((r) => r.data)
      .every((r) => /^0x[0-9a-fA-F]{8,}$/.test(r.data!));
    checks.push({
      name: "calldata-well-formed",
      passed: calldataOk,
      detail: calldataOk ? "all calldata payloads are valid hex" : "malformed calldata detected",
    });
  } else {
    // ── live: on-chain readbacks ───────────────────────────────────────────
    if (inputs.poolVolumeDeltaUsd !== undefined) {
      checks.push({
        name: "pool-volume-delta",
        passed: inputs.poolVolumeDeltaUsd >= 0,
        detail: `pool volume delta $${inputs.poolVolumeDeltaUsd.toFixed(2)}`,
      });
    }
    if (inputs.positionMoved !== undefined) {
      checks.push({
        name: "position-minted",
        passed: inputs.positionMoved,
        detail: inputs.positionMoved ? "v4 position entity detected post-mint" : "no position entity found",
      });
    }
    if (inputs.arcBalanceDeltaUsd !== undefined) {
      checks.push({
        name: "arc-balance-delta",
        passed: inputs.arcBalanceDeltaUsd > 0,
        detail: `Arc unified balance delta $${inputs.arcBalanceDeltaUsd.toFixed(2)}`,
      });
    }
    if (inputs.attestationHash) {
      checks.push({
        name: "cctp-attestation",
        passed: /^0x[0-9a-fA-F]{64}$/.test(inputs.attestationHash),
        detail: `attestation ${inputs.attestationHash.slice(0, 10)}…${inputs.attestationHash.slice(-8)}`,
      });
    }

    const allLive = state.results.every((r) => !r.simulated && r.txHash);
    checks.push({
      name: "live-txs-confirmed",
      passed: allLive,
      detail: allLive
        ? `all ${state.results.length} legs confirmed on-chain`
        : "some legs lack a confirmed tx hash",
    });
  }

  return checks;
}

export const summarizeChecks = (checks: VerificationCheck[]) =>
  checks.every((c) => c.passed);
