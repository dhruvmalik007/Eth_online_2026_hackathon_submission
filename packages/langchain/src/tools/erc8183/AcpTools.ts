/**
 * ERC-8183 Agentic Commerce — FULL job lifecycle as LangChain tools.
 * State machine (EIP-8183): Open → Funded → Submitted → Completed | Rejected | Expired.
 *
 * Each tool validates args (zod), calls ONE `@ethonline2026/arc-client` method,
 * and returns shaped JSON. The LLM never signs, encodes, or does arithmetic.
 *
 * Grounding rules (system prompt §ID GROUNDING apply): jobId/budget values come
 * from tool results, never invented.
 */
import { tool } from "@langchain/core/tools";
import * as z from "zod";
import { createArcClient, type ArcClientEnv, JOB_STATUS } from "@ethonline2026/arc-client";

function arcEnv(): ArcClientEnv {
  return process.env as ArcClientEnv;
}

function client() {
  return createArcClient(arcEnv());
}

const usdc = (n: number) => BigInt(Math.round(n * 1e6)); // USDC 6dp

/** createJob — agent as client (provider may be unset → setProvider later). */
export const acpCreateJobTool = tool(
  async ({ provider, evaluator, expiresInHours, description }) => {
    try {
      const arc = client();
      const expiredAt = Math.floor(Date.now() / 1000) + expiresInHours * 3600;
      const providerHex = provider as `0x${string}` | undefined;
      const jobId = await arc.acp().createJob({
        ...(providerHex !== undefined ? { provider: providerHex } : {}),
        evaluator: evaluator as `0x${string}`,
        expiredAt,
        description,
      });
      return JSON.stringify({
        jobId: jobId.toString(),
        state: "Open",
        nextActions: ["acp_set_provider (if unset)", "acp_set_budget", "acp_fund_job"],
        evaluator: evaluator ?? null,
        budgetUsdcSet: false,
      });
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  },
  {
    name: "acp_create_job",
    description:
      "ERC-8183: create an agentic-commerce job (state Open). Escrow is funded later via acp_fund_job after set_budget.",
    schema: z.object({
      provider: z.string().optional().describe("Provider agent address (0x…); omit for open assignment"),
      evaluator: z.string().describe("Evaluator address — may be the risk-evaluator contract or the client itself"),
      budgetUsdc: z.number().positive().describe("Planned escrow in USDC"),
      expiresInHours: z.number().positive().describe("Job expiry window in hours"),
      description: z.string().describe("Job brief / scope reference"),
    }),
  },
);

export const acpSetProviderTool = tool(
  async ({ jobId, provider }) => {
    try {
      const arc = client();
      await arc.acp().setProvider(BigInt(jobId), provider as `0x${string}`);
      return JSON.stringify({ jobId, provider, state: "Open", next: ["acp_set_budget", "acp_fund_job"] });
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  },
  {
    name: "acp_set_provider",
    description: "ERC-8183: assign the provider on an Open job created without one (client-only, before funding).",
    schema: z.object({
      jobId: z.string().describe("Numeric job id from acp_create_job"),
      provider: z.string().describe("Provider agent address (0x…)"),
    }),
  },
);

export const acpSetBudgetTool = tool(
  async ({ jobId, budgetUsdc }) => {
    try {
      const arc = client();
      await arc.acp().setBudget(BigInt(jobId), usdc(budgetUsdc));
      return JSON.stringify({ jobId, budgetUsdc, state: "Open", next: ["acp_fund_job"] });
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  },
  {
    name: "acp_set_budget",
    description: "ERC-8183: set/agree the job budget in USDC (client or provider; Open state only).",
    schema: z.object({
      jobId: z.string(),
      budgetUsdc: z.number().positive(),
    }),
  },
);

export const acpFundJobTool = tool(
  async ({ jobId, expectedBudgetUsdc }) => {
    try {
      const arc = client();
      const kernel = arc.acp();
      const token = await kernel.paymentToken();
      await kernel.approveUsdc(usdc(expectedBudgetUsdc), token);
      await kernel.fund(BigInt(jobId), usdc(expectedBudgetUsdc), "0x0000000000000000000000000000000000000000");
      return JSON.stringify({
        jobId,
        state: "Funded",
        escrowUsdc: expectedBudgetUsdc,
        note: "Escrowed. Provider may submit; only the evaluator can complete/reject after submission.",
      });
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  },
  {
    name: "acp_fund_job",
    description:
      "ERC-8183: fund the escrow with USDC (client). Moves the job Open → Funded. expectedBudget must equal the agreed budget (front-running guard).",
    schema: z.object({
      jobId: z.string(),
      expectedBudgetUsdc: z.number().positive().describe("Must equal the budget set via acp_set_budget"),
    }),
  },
);

export const acpSubmitJobTool = tool(
  async ({ jobId, deliverableHash }) => {
    try {
      const arc = client();
      const deliverable = (deliverableHash.startsWith("0x") ? deliverableHash : `0x${deliverableHash}`) as `0x${string}`;
      await arc.acp().submit(BigInt(jobId), deliverable as `0x${string}`);
      return JSON.stringify({ jobId, state: "Submitted", deliverable: deliverable, note: "Awaiting evaluator complete/reject." });
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  },
  {
    name: "acp_submit_job",
    description:
      "ERC-8183 (provider): submit work — deliverable is a bytes32 reference (keccak256 of the off-chain artifact / IPFS CID). Funded → Submitted.",
    schema: z.object({
      jobId: z.string(),
      deliverableHash: z.string().describe("bytes32 commitment, 0x… (e.g. keccak256 of the report at its IPFS CID)"),
    }),
  },
);

export const acpCompleteJobTool = tool(
  async ({ jobId, reasonHash }) => {
    try {
      const arc = client();
      const reason = (reasonHash.startsWith("0x") ? reasonHash : `0x${reasonHash}`) as `0x${string}`;
      await arc.acp().complete(BigInt(jobId), reason as `0x${string}`);
      return JSON.stringify({ jobId, state: "Completed", note: "Escrow released to provider (minus fees)." });
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  },
  {
    name: "acp_complete_job",
    description:
      "ERC-8183 (evaluator only): attest completion — releases escrow to the provider. reason is an attestation commitment (bytes32).",
    schema: z.object({
      jobId: z.string(),
      reasonHash: z.string().describe("bytes32 attestation hash (e.g. keccak256 of the evidence bundle)"),
    }),
  },
);

export const acpRejectJobTool = tool(
  async ({ jobId, reason }) => {
    try {
      const arc = client();
      const reasonHash = reason
        ? undefined
        : undefined;
      void reasonHash;
      const reasonBytes = (reason ? `0x${Buffer.from(reason).toString("hex")}` : "0x0") as `0x${string}`;
      await arc.acp().reject(BigInt(jobId), reasonBytes as `0x${string}`);
      return JSON.stringify({ jobId, state: "Rejected", note: "Escrow refunded to client (if Funded/Submitted)." });
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  },
  {
    name: "acp_reject_job",
    description:
      "ERC-8183: reject — client (while Open) or evaluator (Funded/Submitted). Refunds escrow when funded. Terminal.",
    schema: z.object({
      jobId: z.string(),
      reason: z.string().optional().describe("Human-readable rejection reason (hashed on-chain)"),
    }),
  },
);

export const acpClaimRefundTool = tool(
  async ({ jobId }) => {
    try {
      const arc = client();
      await arc.acp().claimRefund(BigInt(jobId));
      return JSON.stringify({ jobId, state: "Expired", note: "Escrow refunded to client. Permissionless after expiry." });
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  },
  {
    name: "acp_claim_refund",
    description: "ERC-8183: permissionless refund once the job is past expiry (Funded/Submitted → Expired).",
    schema: z.object({ jobId: z.string() }),
  },
);

export const acpJobStatusTool = tool(
  async ({ jobId }) => {
    try {
      const arc = client();
      const job = await arc.acp().getJob(BigInt(jobId));
      return JSON.stringify({
        jobId: job.jobId.toString(),
        client: job.client,
        provider: job.provider,
        evaluator: job.evaluator,
        state: job.status,
        states: JOB_STATUS,
        budgetUsdc: from6(job.budget),
        expiresAt: Number(job.expiredAt),
        description: job.description,
        hook: job.hook,
      });
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  },
  {
    name: "acp_job_status",
    description: "Read the on-chain ERC-8183 job: state machine position, parties, escrow, expiry.",
    schema: z.object({ jobId: z.string() }),
  },
);

function from6(b: bigint): number {
  return Number(b) / 1e6;
}

/** The full lifecycle tool group. */
export function createAcpTools() {
  return [
    acpCreateJobTool,
    acpSetProviderTool,
    acpSetBudgetTool,
    acpFundJobTool,
    acpSubmitJobTool,
    acpCompleteJobTool,
    acpRejectJobTool,
    acpClaimRefundTool,
    acpJobStatusTool,
  ];
}
