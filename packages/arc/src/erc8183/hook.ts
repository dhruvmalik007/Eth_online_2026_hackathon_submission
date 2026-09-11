/**
 * RiskEvaluatorHook — IACPHook whose beforeAction(`complete`) re-runs the
 * deliverable's key figures through the EMS fixed-income math before letting
 * the job complete. Trustless QA of agent output: if the numbers don't
 * reproduce, the completion reverts and escrow stays locked.
 *
 * Deployed alongside the ACP kernel (Foundry, §7 Phase B of the integration
 * plan); this module exposes the binding + the policy inputs it enforces.
 */
import { parseAbi, type Address } from "viem";
import { ERC8183_ABI } from "./kernel.js";

export interface DeliverableExpectation {
  /** The report commit the provider must have submitted (bytes32). */
  deliverableHash: `0x${string}`;
  /** Key figures that must reproduce (USDC-normalized). */
  figures: Record<string, number>;
  /** Tolerance for float reproduction (default 1e-6 relative). */
  tolerance?: number;
}

export const RISK_EVALUATOR_HOOK_ABI = parseAbi([
  "function setExpectation(uint256 jobId, bytes32 deliverableHash, bytes calldata figuresEncoded) external",
  "function verify(uint256 jobId, bytes32 deliverable, bytes calldata figuresEncoded) view returns (bool ok, string memory reason)",
]);

/**
 * Client-side helper: encode the expectation the evaluator hook will enforce.
 * The on-chain hook stores the commitment at creation/setBudget and verifies
 * against it in beforeAction(`complete`).
 */
export function encodeExpectation(e: DeliverableExpectation): `0x${string}` {
  const entries = Object.entries(e.figures);
  const encoded = entries.map(([k, v]) => `${k}=${v}`).join("|");
  const payload = `${e.deliverableHash}::${encoded}::${e.tolerance ?? 1e-6}`;
  return hexlifyString(payload);
}

/** Deploy-time note: the hook is set at createJob — hooks are client-trusted
 * (EIP-8183 §Hook security) and MUST NOT be upgradeable mid-job. */
export function riskEvaluatorHookAddress(): Address | null {
  const addr = process.env.ARC_RISK_EVALUATOR_HOOK;
  return (addr as Address) ?? null;
}

function hexlifyString(s: string): `0x${string}` {
  const bytes = new TextEncoder().encode(s);
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out as `0x${string}`;
}

export { ERC8183_ABI };
