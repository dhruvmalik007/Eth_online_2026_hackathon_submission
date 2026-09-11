/**
 * Probe Arc testnet: chain id, block, wallet native-USDC balance (gas) + USDC
 * balanceOf via the verified 0x3600…0000 token. Run: pnpm tsx scripts/probe.ts
 */
import { createPublicClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network";
const USDC = (process.env.ARC_TESTNET_USDC ?? "0x3600000000000000000000000000000000000000") as `0x${string}`;
const pk = (process.env.ARC_PRIVATE_KEY ??
  "0xae4de1d4d157ad553df529a397b54280edf4e839acd97cae6340570e082d85d2") as `0x${string}`;

async function main() {
  const account = privateKeyToAccount(pk);
  console.log("wallet:", account.address);
  const client = createPublicClient({ transport: http(RPC) });
  const chainId = await client.getChainId();
  const block = await client.getBlockNumber();
  const native = await client.getBalance({ address: account.address });
  const erc20Abi = [
    {
      type: "function",
      name: "balanceOf",
      stateMutability: "view",
      inputs: [{ name: "owner", type: "address" }],
      outputs: [{ name: "", type: "uint256" }],
    },
  ] as const;
  const usdcBal = await client.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log("chainId:", chainId, "· block:", block);
  console.log("native USDC (gas):", formatUnits(native, 18));
  console.log("USDC.balanceOf:", formatUnits(usdcBal, 18));
}

main().catch((e) => {
  console.error("probe failed:", e.message ?? e);
  process.exit(1);
});
