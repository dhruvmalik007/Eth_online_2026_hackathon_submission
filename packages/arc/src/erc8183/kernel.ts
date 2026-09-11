/**
 * LOW-LEVEL ERC-8183 Agentic Commerce kernel bindings (viem).
 *
 * ABI mirrors the reference implementation in EIP-8183 (AgenticCommerce.sol):
 * https://eips.ethereum.org/EIPS/eip-8183 — six-state machine
 * Open → Funded → Submitted → Completed | Rejected | Expired.
 *
 * This file contains NO policy. The RiskEvaluatorHook (hook.ts) is where the
 * EMS re-runs deliverable figures via fixedIncomeMath.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";

export const ERC8183_ABI = parseAbi([
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256 jobId)",
  "function setProvider(uint256 jobId, address provider)",
  "function setBudget(uint256 jobId, uint256 amount, bytes optParams)",
  "function fund(uint256 jobId, bytes optParams)",
  "function submit(uint256 jobId, bytes32 deliverable, bytes calldata optParams)",
  "function complete(uint256 jobId, bytes32 reason, bytes calldata optParams)",
  "function reject(uint256 jobId, bytes32 reason, bytes calldata optParams)",
  "function claimRefund(uint256 jobId)",
  "function getJob(uint256 jobId) view returns ((uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook))",
  "function paymentToken() view returns (address)",
  "function jobCounter() view returns (uint256)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
  "event BudgetSet(uint256 indexed jobId, uint256 amount)",
  "event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount)",
  "event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable)",
  "event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason)",
  "event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason)",
  "event JobExpired(uint256 indexed jobId)",
  "event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount)",
  "event Refunded(uint256 indexed jobId, address indexed client, uint256 amount)",
]);

export const JOB_STATUS = [
  "Open",
  "Funded",
  "Submitted",
  "Completed",
  "Rejected",
  "Expired",
] as const;

export type JobStatus = (typeof JOB_STATUS)[number];

export interface AcpJob {
  jobId: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  description: string;
  budget: bigint; // USDC, 6 decimals
  expiredAt: bigint;
  status: JobStatus;
  hook: Address;
}

export class AcpKernel {
  private readonly walletClient: WalletClient;
  private readonly publicClient: PublicClient;

  constructor(
    private readonly kernelAddress: Address,
    rpcUrl: string,
    private readonly chain: Chain,
    private readonly account: Address,
  ) {
    this.publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    this.walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  }

  get address(): Address {
    return this.kernelAddress;
  }

  /** Client creates a job. provider may be address(0) → set later via setProvider. */
  async createJob(p: {
    provider?: Address;
    evaluator: Address;
    expiredAt: Date | number;
    description: string;
    hook?: Address;
  }): Promise<bigint> {
    const expiredAt = BigInt(
      typeof p.expiredAt === "number" ? p.expiredAt : Math.floor(p.expiredAt.getTime() / 1000),
    );
    const hash = await this.walletClient.writeContract({
      address: this.kernelAddress,
      abi: ERC8183_ABI,
      account: this.account,
      functionName: "createJob",
      chain: this.chain,
      args: [p.provider ?? "0x0000000000000000000000000000000000000000", p.evaluator, expiredAt, p.description, p.hook ?? "0x0000000000000000000000000000000000000000"],
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    const created = receipt.logs
      .map((l) => {
        try {
          const parsed = this.decodeEvent(l);
          return parsed?.jobId;
        } catch {
          return undefined;
        }
      })
      .find((id) => id !== undefined);
    return created ?? 0n;
  }

  async setProvider(jobId: bigint, provider: Address): Promise<void> {
    await this.write("setProvider", [jobId, provider]);
  }

  async setBudget(jobId: bigint, amount: bigint): Promise<void> {
    await this.write("setBudget", [jobId, amount, "0x"]);
  }

  /** Client funds escrow (pulls `budget` USDC). expectedBudget guards front-running. */
  async fund(jobId: bigint, expectedBudget: bigint, usdc: Address): Promise<void> {
    // ERC-20 pull — approve the kernel first (idempotent-style: approve exact).
    const erc20 = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
    await this.walletClient.writeContract({
      address: usdc,
      abi: erc20,
      chain: this.chain,
      account: this.account,
      functionName: "approve",
      args: [this.kernelAddress, expectedBudget],
    });
    await this.write("fund", [jobId, "0x"]);
  }

  async submit(jobId: bigint, deliverable: `0x${string}`): Promise<void> {
    await this.write("submit", [jobId, deliverable, "0x"]);
  }

  async complete(jobId: bigint, reason: `0x${string}`): Promise<void> {
    await this.write("complete", [jobId, reason, "0x"]);
  }

  async reject(jobId: bigint, reason: `0x${string}`): Promise<void> {
    await this.write("reject", [jobId, reason, "0x"]);
  }

  async claimRefund(jobId: bigint): Promise<void> {
    await this.write("claimRefund", [jobId]);
  }

  async getJob(jobId: bigint): Promise<AcpJob> {
    const job = await this.publicClient.readContract({
      address: this.kernelAddress,
      abi: ERC8183_ABI,
      functionName: "getJob",
      args: [jobId],
    });
    return {
      jobId: job.id,
      client: job.client,
      provider: job.provider,
      evaluator: job.evaluator,
      description: job.description,
      budget: job.budget,
      expiredAt: job.expiredAt,
      status: JOB_STATUS[job.status] ?? "Open",
      hook: job.hook,
    };
  }

  async jobCounter(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.kernelAddress,
      abi: ERC8183_ABI,
      functionName: "jobCounter",
    });
  }

  async paymentToken(): Promise<Address> {
    return this.publicClient.readContract({
      address: this.kernelAddress,
      abi: ERC8183_ABI,
      functionName: "paymentToken",
    });
  }

  /** Approve the kernel to pull USDC for a job escrow (needed before fund). */
  async approveUsdc(amount: bigint, usdc: Address): Promise<void> {
    const erc20 = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
    await this.walletClient.writeContract({
      address: usdc,
      abi: erc20,
      chain: this.chain,
      account: this.account,
      functionName: "approve",
      args: [this.kernelAddress, amount],
    });
  }

  private async write(fn: string, args: readonly unknown[]): Promise<void> {
    const hash = await this.walletClient.writeContract({
      address: this.kernelAddress,
      abi: ERC8183_ABI,
      chain: this.chain,
      account: this.account,
      functionName: fn as never,
      args: args as never,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
  }

  private decodeEvent(log: { topics: string[]; data: `0x${string}` }): { jobId?: bigint } | undefined {
    // JobCreated topic0 — parse jobId from topics[1].
    if (log.topics[0] && log.topics[1]) {
      return { jobId: BigInt(log.topics[1]) };
    }
    return undefined;
  }
}
